import { defineBackground } from "wxt/sandbox";

// Pipeline real (PRD extensão 100% funcional):
//   painel ativa campanha → worker enfileira message_jobs → esta extensão faz
//   polling em GET /messaging/pending-outreach (1 job por vez) → navega até o
//   perfil → content script faz a automação humana → POST /messaging/report-sent
//   com job_id confirma a entrega e avança a cadência no backend.
// TODAS as chamadas de API ficam aqui no service worker: o api_jwt nunca entra
// no contexto da página do LinkedIn (MV3 bloqueia fetch cross-origin de content
// script; e o token não pode vazar para a página de qualquer forma).
export default defineBackground(() => {
  const API_BASE_URL = "http://localhost:8080/api/v1";
  const POLL_INTERVAL_MS = 5000;
  const HEARTBEAT_INTERVAL_MS = 60_000;
  const NAV_TIMEOUT_MS = 45_000;
  const JOB_TIMEOUT_MS = 180_000;
  const KEEPALIVE_ALARM = "vibexcorp-keepalive";

  let dispatching = false;

  interface StoredJob {
    job_id: string;
    contact_id: string;
    first_name: string;
    last_name?: string;
    full_name?: string;
    company?: string;
    job_title?: string;
    linkedin_url: string;
    rendered_message: string;
  }

  interface BgState {
    paired: boolean;
    paused: boolean;
    dispatching: boolean;
    campaign_name: string;
    queue_remaining: number;
    daily_remaining: number;
    last_sent_name: string;
    last_sent_at: string;
    last_error: string;
  }

  const state: BgState = {
    paired: false,
    paused: false,
    dispatching: false,
    campaign_name: "",
    queue_remaining: 0,
    daily_remaining: -1,
    last_sent_name: "",
    last_sent_at: "",
    last_error: "",
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const randInt = (min: number, max: number) =>
    Math.floor(min + Math.random() * (max - min + 1));

  async function publishState() {
    state.dispatching = dispatching;
    await chrome.storage.local.set({ bg_state: state });
  }

  async function recordError(err: string) {
    state.last_error = err;
    console.warn("[VibexCorp] ", err);
    await publishState();
  }

  // ---------- storage / auth ----------

  function getAuth(): Promise<{
    extension_token?: string;
    api_jwt?: string;
    outreach_paused?: boolean;
  }> {
    return new Promise((resolve) =>
      chrome.storage.local.get(
        ["extension_token", "api_jwt", "outreach_paused"],
        (res) => resolve(res ?? {})
      )
    );
  }

  // ---------- API (sempre por aqui) ----------

  async function apiFetch(
    path: string,
    init: RequestInit,
    token: string
  ): Promise<{ ok: boolean; status: number; data: any }> {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } catch (e: any) {
      return { ok: false, status: 0, data: { error: { message: e?.message } } };
    }
  }

  async function sendHeartbeat() {
    const { extension_token } = await getAuth();
    if (!extension_token) return;
    const { ok } = await apiFetch(
      "/extension/heartbeat",
      { method: "POST" },
      extension_token
    );
    if (!ok) await recordError("heartbeat rejeitado — re-pareie a extensão");
  }

  async function fetchPending(apiJwt: string) {
    const { ok, data } = await apiFetch(
      "/messaging/pending-outreach",
      { method: "GET" },
      apiJwt
    );
    return ok ? data : null;
  }

  async function reportSent(apiJwt: string, body: Record<string, any>) {
    return apiFetch("/messaging/report-sent", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiJwt);
  }

  // Assist Jev (Typesafe via proxy do backend): parâmetros humanos para a
  // automação. Qualquer falha → defaults locais honestos (nunca bloqueia).
  async function assistHumanize(apiJwt: string, job: StoredJob) {
    const defaults = {
      assist_available: false,
      click_delay_ms: randInt(700, 1400),
      type_cps_min: 7,
      type_cps_max: 12,
      pause_every_min_chars: 25,
      pause_every_max_chars: 45,
      pause_ms_min: 400,
      pause_ms_max: 1200,
      scroll_dwell_ms: 800,
      suggested_selector: "",
    };
    try {
      const { ok, data } = await apiFetch("/assist/humanize", {
        method: "POST",
        body: JSON.stringify({
          action: "send_message",
          page_fingerprint: `profile:${job.contact_id}`,
          language: "pt-BR",
        }),
      }, apiJwt);
      if (!ok || !data) return defaults;
      return {
        assist_available: !!data.assist_available,
        click_delay_ms: data.click_delay_ms ?? defaults.click_delay_ms,
        type_cps_min: data.type_cps_min ?? defaults.type_cps_min,
        type_cps_max: data.type_cps_max ?? defaults.type_cps_max,
        pause_every_min_chars: data.pause_every_min_chars ?? defaults.pause_every_min_chars,
        pause_every_max_chars: data.pause_every_max_chars ?? defaults.pause_every_max_chars,
        pause_ms_min: data.pause_ms_min ?? defaults.pause_ms_min,
        pause_ms_max: data.pause_ms_max ?? defaults.pause_ms_max,
        scroll_dwell_ms: data.scroll_dwell_ms ?? defaults.scroll_dwell_ms,
        suggested_selector: data.suggested_selector ?? "",
      };
    } catch {
      return defaults;
    }
  }

  // ---------- navegação de aba ----------

  async function ensureLinkedInTab(): Promise<chrome.tabs.Tab> {
    const tabs = await chrome.tabs.query({ url: "*://*.linkedin.com/*" });
    if (tabs.length > 0 && tabs[0]?.id != null) return tabs[0];
    return chrome.tabs.create({
      url: "https://www.linkedin.com/feed/",
      active: true,
    });
  }

  function navigateAndWait(
    tabId: number,
    url: string,
    timeoutMs: number
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      }, timeoutMs);
      const listener = (
        updatedTabId: number,
        info: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && info.status === "complete") {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(true);
        }
      };
      // Listener registrado ANTES do tabs.update (padrão MV3 — nunca perder
      // o evento de navegação).
      chrome.tabs.onUpdated.addListener(listener);
      chrome.tabs.update(tabId, { url }).catch(() => {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve(false);
      });
    });
  }

  function sendMessageWithTimeout(
    tabId: number,
    message: any,
    timeoutMs: number
  ): Promise<any> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "JOB_TIMEOUT" }), timeoutMs);
      chrome.tabs.sendMessage(tabId, message, (res: any) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: `CONTENT_SCRIPT: ${chrome.runtime.lastError.message}` });
          return;
        }
        resolve(res ?? { ok: false, error: "NO_RESPONSE" });
      });
    });
  }

  // ---------- dispatch de um job ----------

  async function dispatchNextJob() {
    if (dispatching) return;
    const { api_jwt, outreach_paused } = await getAuth();
    state.paused = !!outreach_paused;
    if (!api_jwt || outreach_paused) return;

    dispatching = true;
    await publishState();

    try {
      const pending = await fetchPending(api_jwt);
      if (!pending) {
        await recordError("API inacessível — verifique o painel (scripts/local/start.ps1)");
        return;
      }
      state.campaign_name = pending.has_campaign ? pending.campaign_name : "";
      state.queue_remaining = pending.queue_remaining ?? 0;
      state.daily_remaining = pending.daily_remaining ?? -1;
      await publishState();
      if (!pending.has_campaign || !pending.job) return;

      const job: StoredJob = pending.job;
      const recipient = job.full_name || job.first_name || "Conexão";
      const humanize = await assistHumanize(api_jwt, job);

      const tab = await ensureLinkedInTab();
      if (tab.id == null) throw new Error("NO_TAB");

      // Navegação decidida aqui: a página do perfil é carregada de verdade e o
      // dispatch só segue depois do load completo (comportamento humano).
      const current = await chrome.tabs.get(tab.id);
      const target = job.linkedin_url.split("?")[0];
      if (!current.url || !current.url.startsWith(target)) {
        const loaded = await navigateAndWait(tab.id, job.linkedin_url, NAV_TIMEOUT_MS);
        if (!loaded) throw new Error("NAV_TIMEOUT");
        // LinkedIn hidrata o perfil depois do 'complete' — dwell humano.
        await sleep(randInt(1800, 3200) + (humanize.scroll_dwell_ms ?? 0));
      }

      const result = await sendMessageWithTimeout(
        tab.id,
        { action: "EXECUTE_OUTREACH_JOB", job, humanize },
        JOB_TIMEOUT_MS
      );

      if (result?.ok) {
        await reportSent(api_jwt, {
          job_id: job.job_id,
          contact_id: job.contact_id,
          recipient_name: recipient,
          message_body: result.message_body || job.rendered_message,
          linkedin_url: job.linkedin_url,
          status: "sent",
        });
        state.last_sent_name = recipient;
        state.last_sent_at = new Date().toISOString();
        state.last_error = "";
        if (typeof state.queue_remaining === "number" && state.queue_remaining > 0) {
          state.queue_remaining -= 1;
        }
      } else {
        const err = result?.error || "UNKNOWN_FAILURE";
        // Erro honesto para o backend: attempts++ e retry (3 → failed).
        await reportSent(api_jwt, {
          job_id: job.job_id,
          contact_id: job.contact_id,
          recipient_name: recipient,
          message_body: job.rendered_message,
          linkedin_url: job.linkedin_url,
          error: err,
        });
        await recordError(`Falha em ${recipient}: ${err}`);
      }
      await publishState();
    } catch (e: any) {
      await recordError(e?.message || "erro desconhecido no dispatch");
    } finally {
      dispatching = false;
      await publishState();
    }
  }

  // ---------- keepalive MV3 (docs Chrome: alarms recriados no
  // onInstalled/onStartup, listeners no top-level) ----------

  chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  });

  chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });
  });

  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 1 });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      sendHeartbeat();
      // Service worker pode ter dormido: o alarm reacorda o ciclo de polling.
      dispatchNextJob();
    }
  });

  // ---------- ciclos ----------

  setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
  setInterval(dispatchNextJob, POLL_INTERVAL_MS);
  sendHeartbeat();
  dispatchNextJob();

  // ---------- mensagens (popup / sidepanel / content script) ----------

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "GET_STATE") {
      getAuth().then(({ extension_token, api_jwt, outreach_paused }) => {
        state.paired = !!(extension_token && api_jwt);
        state.paused = !!outreach_paused;
        state.dispatching = dispatching;
        sendResponse({ state, has_extension_token: !!extension_token });
      });
      return true;
    }

    if (message.action === "TOGGLE_PAUSE") {
      chrome.storage.local.set({ outreach_paused: !!message.paused }, async () => {
        state.paused = !!message.paused;
        await publishState();
        sendResponse({ ok: true, paused: state.paused });
      });
      return true;
    }

    if (message.action === "SYNC_CONNECTIONS") {
      getAuth().then(async ({ api_jwt }) => {
        if (!api_jwt) {
          sendResponse({ ok: false, error: "Extensão não pareada." });
          return;
        }
        const { ok, data } = await apiFetch("/contacts/sync-linkedin", {
          method: "POST",
          body: JSON.stringify({ connections: message.payload ?? [] }),
        }, api_jwt);
        sendResponse({ ok, data });
      });
      return true;
    }

    if (message.action === "CAPTURE_LEAD") {
      getAuth().then(async ({ api_jwt }) => {
        if (!api_jwt) {
          sendResponse({ success: false, error: "Extensão não pareada." });
          return;
        }
        const { ok, data } = await apiFetch("/contacts", {
          method: "POST",
          body: JSON.stringify(message.payload),
        }, api_jwt);
        sendResponse({ success: ok, data });
      });
      return true;
    }

    if (message.action === "DISPATCH_NOW") {
      dispatchNextJob();
      sendResponse({ ok: true });
      return true;
    }

    // Compat: contexto antigo pedia o token direto (não usado pelo novo popup).
    if (message.action === "GET_AUTH_TOKEN") {
      chrome.storage.local.get(["extension_token", "api_jwt", "user_profile"], (res) => {
        sendResponse({ token: res?.extension_token, api_jwt: res?.api_jwt, user: res?.user_profile });
      });
      return true;
    }
  });

  console.log("[VibexCorp Extension] Background do pipeline real iniciado (polling 5s + keepalive alarm).");
});
