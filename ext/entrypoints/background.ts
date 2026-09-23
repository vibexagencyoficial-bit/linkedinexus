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
  const JOB_TIMEOUT_MS = 300_000; // digitação em aba de fundo é mais lenta (clamp de timer)
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
    // Carimbo do último ciclo (ocioso ou não): o popup prova que o SW está
    // vivo mesmo sem job — "nada acontecendo" vira diagnóstico legível.
    last_cycle_at: string;
    // Métricas de latência do Jev no último disparo (medidor do algoritmo):
    // jev_ms = HTTP Typesafe (backend), assist_total_ms = handler completo,
    // roundtrip_ms = ida+volta extensão→API (medido aqui).
    last_jev_ms: number;
    last_assist_total_ms: number;
    last_roundtrip_ms: number;
    last_assist_source: string;
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
    last_cycle_at: "",
    last_jev_ms: 0,
    last_assist_total_ms: 0,
    last_roundtrip_ms: 0,
    last_assist_source: "",
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

  function clearPairing() {
    return new Promise<void>((resolve) =>
      chrome.storage.local.remove(
        ["extension_token", "api_jwt", "device_id", "automation_tab_id"],
        () => resolve()
      )
    );
  }

  async function sendHeartbeat() {
    const { extension_token } = await getAuth();
    if (!extension_token) return;
    const { ok, status } = await apiFetch(
      "/extension/heartbeat",
      { method: "POST" },
      extension_token
    );
    if (!ok) {
      // 401 = device revogado/expirado no banco: unpair honesto (a badge
      // volta a SEM PAREAMENTO e o usuário re-vincula). Outros erros = só
      // registrar (rede/5xx não invalidam o pareamento).
      if (status === 401) {
        await clearPairing();
        await recordError("Pareamento revogado no servidor — vincule a extensão novamente.");
        state.paired = false;
        await publishState();
        return;
      }
      await recordError("heartbeat falhou (API indisponível?) — re-pareie se persistir");
    } else {
      state.paired = true;
      state.last_error = "";
      await publishState();
    }
  }

  // Renova o api_jwt curto (60min) usando o extension_token (device, 30d).
  // Retorna o novo JWT ou null se o device também estiver inválido (→ unpair).
  async function renewApiJwt(): Promise<string | null> {
    const { extension_token } = await getAuth();
    if (!extension_token) return null;
    const { ok, status, data } = await apiFetch(
      "/extension/token",
      { method: "POST" },
      extension_token
    );
    if (ok && data?.api_jwt) {
      await chrome.storage.local.set({ api_jwt: data.api_jwt });
      return data.api_jwt as string;
    }
    if (status === 401) {
      await clearPairing();
      await recordError("Pareamento revogado no servidor — vincule a extensão novamente.");
      state.paired = false;
      await publishState();
    }
    return null;
  }

  async function fetchPending(apiJwt: string): Promise<{ ok: boolean; status: number; data: any }> {
    const { ok, status, data } = await apiFetch(
      "/messaging/pending-outreach",
      { method: "GET" },
      apiJwt
    );
    return { ok, status, data };
  }

  async function reportSent(apiJwt: string, body: Record<string, any>) {
    return apiFetch("/messaging/report-sent", {
      method: "POST",
      body: JSON.stringify(body),
    }, apiJwt);
  }

  // Assist Jev (Typesafe via proxy do backend): parâmetros humanos para a
  // automação. Qualquer falha → defaults locais honestos (nunca bloqueia).
  // Mede o round-trip (ida+volta até /assist/humanize) — medidor do
  // algoritmo junto com jev_ms/assist_total_ms vindos do backend.
  async function assistHumanize(apiJwt: string, job: StoredJob) {
    const defaults = {
      assist_available: false,
      source: "fallback",
      confidence: 0,
      page_state: "",
      pacing_level: "",
      jev_ms: 0,
      assist_total_ms: 0,
      roundtrip_ms: 0,
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
      const t0 = Date.now();
      const { ok, data } = await apiFetch("/assist/humanize", {
        method: "POST",
        body: JSON.stringify({
          action: "send_message",
          page_fingerprint: `profile:${job.contact_id}`,
          language: "pt-BR",
          // Seletores canônicos: o Jev escolhe o alvo correto da ação.
          selectors: [
            "button[aria-label*='Message']",
            ".msg-form__contenteditable",
            ".msg-form__send-button",
          ],
        }),
      }, apiJwt);
      const roundtrip = Date.now() - t0;
      if (!ok || !data) return { ...defaults, roundtrip_ms: roundtrip };
      return {
        assist_available: !!data.assist_available,
        source: data.source ?? defaults.source,
        confidence: data.confidence ?? 0,
        page_state: data.page_state ?? "",
        pacing_level: data.pacing_level ?? "",
        jev_ms: data.jev_ms ?? 0,
        assist_total_ms: data.assist_total_ms ?? 0,
        roundtrip_ms: roundtrip,
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

  // Aba de automação DEDICADA: criada em background (active:false) e
  // rastreada por id no storage. NUNCA usamos a aba que o usuário está
  // vendo — a automação roda sem dominar o browser.
  async function getAutomationTab(): Promise<chrome.tabs.Tab | null> {
    const { automation_tab_id } = await chrome.storage.local.get("automation_tab_id");
    if (automation_tab_id != null) {
      try {
        const tab = await chrome.tabs.get(automation_tab_id);
        if (tab?.id != null && tab.url?.includes("linkedin.com")) return tab;
      } catch {
        // aba foi fechada — cai no re-criar abaixo
      }
    }
    const created = await chrome.tabs.create({
      url: "https://www.linkedin.com/feed/",
      active: false,
    });
    await chrome.storage.local.set({ automation_tab_id: created.id });
    return created;
  }

  async function ensureLinkedInTab(): Promise<chrome.tabs.Tab | null> {
    return getAutomationTab();
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
    // Trava ANTI-DUPLO-DESPACHO persistida no storage (sobrevive ao restart
    // do service worker — a variável `dispatching` em memória zera quando o
    // SW dorme/acorda, e dois ciclos podiam pegar o mesmo perfil).
    const lockKey = "dispatch_lock";
    const now = Date.now();
    const lock = await new Promise<any>((resolve) =>
      chrome.storage.local.get([lockKey], (res) => resolve(res?.[lockKey]))
    );
    // Lock vivo = outro ciclo ainda trabalhando (TTL = JOB_TIMEOUT + folga).
    if (lock && now - (lock.since ?? 0) < JOB_TIMEOUT_MS + 60_000) return;
    if (dispatching) return;
    dispatching = true;
    await new Promise<void>((resolve) =>
      chrome.storage.local.set({ [lockKey]: { since: now } }, () => resolve())
    );
    const { api_jwt, outreach_paused } = await getAuth();
    state.paused = !!outreach_paused;
    if (!api_jwt || outreach_paused) {
      dispatching = false;
      await new Promise<void>((resolve) =>
        chrome.storage.local.remove([lockKey], () => resolve())
      );
      // Motivo VISÍVEL no popup: ciclo parado por falta de pareamento/pausa
      // (não é "nada acontecendo", é parado por motivo).
      await publishState();
      return;
    }
    let activeJwt = api_jwt;

    await publishState();

    try {
      let pending = await fetchPending(api_jwt);
      if (pending.status === 401) {
        // api_jwt temporário venceu: renova com o extension_token e tenta 1x.
        const renewed = await renewApiJwt();
        if (renewed) {
          activeJwt = renewed;
          pending = await fetchPending(activeJwt);
        }
      }
      if (!pending.ok || !pending.data) {
        await recordError("API inacessível — verifique o painel (scripts/local/start.ps1)");
        return;
      }
      const data = pending.data;
      state.campaign_name = data.has_campaign ? data.campaign_name : "";
      state.queue_remaining = data.queue_remaining ?? 0;
      state.daily_remaining = data.daily_remaining ?? -1;
      await publishState();
      // Sem campanha/job: registra o MOTIVO no estado (visível no popup) e
      // libera o lock — ciclo ocioso honesto, não "travado".
      if (!data.has_campaign || !data.job) {
        state.last_cycle_at = new Date().toISOString();
        await publishState();
        return;
      }

      const job: StoredJob = data.job;
      const recipient = job.full_name || job.first_name || "Conexão";
      const humanize = await assistHumanize(activeJwt, job);

      const tab = await ensureLinkedInTab();
      if (!tab || tab.id == null) throw new Error("NO_TAB");

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
        // Métricas de latência do Jev viajam no report: o painel exibe ms
        // por disparo (medidor do algoritmo) junto com a auditoria.
        state.last_jev_ms = humanize.jev_ms ?? 0;
        state.last_assist_total_ms = humanize.assist_total_ms ?? 0;
        state.last_roundtrip_ms = humanize.roundtrip_ms ?? 0;
        state.last_assist_source = humanize.assist_available ? humanize.source : "fallback";
        await reportSent(activeJwt, {
          job_id: job.job_id,
          contact_id: job.contact_id,
          recipient_name: recipient,
          message_body: result.message_body || job.rendered_message,
          linkedin_url: job.linkedin_url,
          status: "sent",
          // Auditoria de quem guiou a automação (Jev/Typesafe vs fallback).
          assist_source: humanize.assist_available ? humanize.source : "fallback",
          assist_confidence: humanize.confidence ?? 0,
          assist_page_state: humanize.page_state ?? "",
          jev_ms: humanize.jev_ms ?? 0,
          assist_total_ms: humanize.assist_total_ms ?? 0,
          assist_roundtrip_ms: humanize.roundtrip_ms ?? 0,
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
        await reportSent(activeJwt, {
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
      state.last_cycle_at = new Date().toISOString();
      await new Promise<void>((resolve) =>
        chrome.storage.local.remove([lockKey], () => resolve())
      );
      await publishState();
    }
  }

  // ---------- keepalive MV3 (docs Chrome via Context7:
  // developer.chrome.com/docs/extensions/reference/api/alarms +
  // .../develop/concepts/service-workers/lifecycle) ----------
  // Regras aplicadas:
  //   1. "alarms" declarada no manifest (wxt.config.ts) — sem ela a API não
  //      opera e o polling morre silenciosamente.
  //   2. persistAcrossSessions: true explícito (default só no Chrome 150+).
  //   3. checkAlarmState no boot: o SW acorda frio e o alarme pode não
  //      existir — recria se chrome.alarms.get retornar vazio.
  //   4. setInterval é SÓ redundância: o SW é encerrado após ~30s de
  //      inatividade e intervals morrem com ele; alarmes reacordam o SW.

  async function ensureAlarm(): Promise<void> {
    try {
      const existing = await chrome.alarms.get(KEEPALIVE_ALARM);
      if (!existing) {
        await chrome.alarms.create(KEEPALIVE_ALARM, {
          delayInMinutes: 1,
          periodInMinutes: 1,
          persistAcrossSessions: true,
        });
        console.log("[VibexCorp] keepalive recriado (estava ausente).");
      }
    } catch (e: any) {
      console.warn("[VibexCorp] falha ao garantir keepalive:", e?.message);
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarm();
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureAlarm();
  });

  void ensureAlarm();

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === KEEPALIVE_ALARM) {
      // Ciclo CANÔNICO: heartbeat + dispatch vivem no alarm (sobrevive ao
      // sleep do SW). O ensureAlarm aqui cobre o caso do alarme ter sido
      // limpo pelo browser entre ciclos.
      void ensureAlarm();
      sendHeartbeat();
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
