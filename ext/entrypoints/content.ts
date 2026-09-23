import { defineContentScript } from "wxt/sandbox";

// Content script: SOMENTE automação no DOM do LinkedIn. Nenhuma chamada de API
// daqui (MV3 bloqueia cross-origin fetch de content script; o api_jwt fica no
// background). O background navega até o perfil e manda EXECUTE_OUTREACH_JOB.
export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    // --- Profile Extractor ---
    function extractProfileData() {
      if (!window.location.hostname.includes("linkedin.com") || !window.location.pathname.startsWith("/in/")) {
        return null;
      }

      const nameEl = document.querySelector("h1, .text-heading-xlarge");
      const fullName = nameEl ? (nameEl as HTMLElement).innerText.trim() : "";

      const headlineEl = document.querySelector(".text-body-medium.break-words, .text-body-medium");
      const headline = headlineEl ? headlineEl.textContent?.trim() || "" : "";

      let company = "";
      let jobTitle = headline;
      if (headline.includes(" at ")) {
        const parts = headline.split(" at ");
        jobTitle = parts[0].trim();
        company = parts[1].trim();
      } else if (headline.includes(" na ")) {
        const parts = headline.split(" na ");
        jobTitle = parts[0].trim();
        company = parts[1].trim();
      } else if (headline.includes(" @ ")) {
        const parts = headline.split(" @ ");
        jobTitle = parts[0].trim();
        company = parts[1].trim();
      }

      const nameParts = fullName.split(" ");
      return {
        first_name: nameParts[0] || "",
        last_name: nameParts.slice(1).join(" ") || "",
        full_name: fullName,
        company: company,
        job_title: jobTitle,
        linkedin_url: window.location.origin + window.location.pathname,
      };
    }

    // --- Intelligent Connection Extractor with Multi-Selector Fallbacks ---
    function parseConnectionsFromDOM(): any[] {
      const connections: any[] = [];
      const seen = new Set<string>();

      // Selectors covering Connections Page (/mynetwork/invite-connect/connections/) and Messaging (/messaging/)
      const cardSelectors = [
        ".mn-connection-card",
        "li.mn-connection-card",
        ".artdeco-list__item",
        ".entity-result",
        ".msg-conversation-listitem",
        "li[data-member-id]",
        ".msg-conversation-card"
      ];

      for (const sel of cardSelectors) {
        const cards = document.querySelectorAll(sel);
        cards.forEach((card) => {
          const linkEl = card.querySelector('a[href*="/in/"], a[href*="/messaging/thread/"]') as HTMLAnchorElement;
          let href = linkEl?.href ? linkEl.href.split("?")[0] : "";
          if (!href) return;

          if (seen.has(href)) return;
          seen.add(href);

          const nameEl = card.querySelector(
            ".mn-connection-card__name, .entity-result__title-text, .artdeco-entity-lockup__title, .msg-conversation-listitem__participant-names, span[aria-hidden='true']"
          );
          let fullName = nameEl ? nameEl.textContent?.trim() || "" : "";
          fullName = fullName.split("\n")[0].trim();
          if (!fullName || fullName.length < 2) return;

          const occEl = card.querySelector(
            ".mn-connection-card__occupation, .entity-result__primary-subtitle, .artdeco-entity-lockup__subtitle, .msg-conversation-card__message-snippet-body"
          );
          const headline = occEl ? occEl.textContent?.trim() || "" : "";

          let company = "";
          let jobTitle = headline;
          if (headline.includes(" at ")) {
            const parts = headline.split(" at ");
            jobTitle = parts[0].trim();
            company = parts[1].trim();
          } else if (headline.includes(" na ")) {
            const parts = headline.split(" na ");
            jobTitle = parts[0].trim();
            company = parts[1].trim();
          } else if (headline.includes(" @ ")) {
            const parts = headline.split(" @ ");
            jobTitle = parts[0].trim();
            company = parts[1].trim();
          }

          const nameParts = fullName.split(" ");
          connections.push({
            first_name: nameParts[0] || "",
            last_name: nameParts.slice(1).join(" ") || "",
            full_name: fullName,
            company: company || "LinkedIn",
            job_title: jobTitle || "Conexão de 1º Grau",
            linkedin_url: href.startsWith("http") ? href : window.location.origin + href,
            metadata: { connection_degree: "1st", source: "linkedin_dom_extraction" },
          });
        });
      }

      return connections;
    }

    // --- Auto-Scroll Extraction for Large Connection Sets ---
    async function extractAllConnectionsWithAutoScroll(targetCount = 50, updateProgress?: (msg: string) => void): Promise<any[]> {
      const isConnectionsPage = window.location.pathname.includes("/mynetwork/invite-connect/connections") ||
                                window.location.pathname.includes("/connections");

      if (!isConnectionsPage && !window.location.pathname.includes("/messaging")) {
        return parseConnectionsFromDOM();
      }

      let previousHeight = 0;
      let attempts = 0;
      const maxScrolls = 8;

      if (updateProgress) updateProgress("Iniciando auto-scroll no LinkedIn...");

      for (let i = 0; i < maxScrolls; i++) {
        const currentConns = parseConnectionsFromDOM();
        if (updateProgress) {
          updateProgress(`Rolando página... ${currentConns.length} conexões carregadas`);
        }

        if (currentConns.length >= targetCount) {
          break;
        }

        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth"
        });

        await new Promise((r) => setTimeout(r, 600));

        if (document.body.scrollHeight === previousHeight) {
          attempts++;
          if (attempts >= 2) break; // End of list reached
        } else {
          attempts = 0;
        }
        previousHeight = document.body.scrollHeight;
      }

      const all = parseConnectionsFromDOM();
      return all;
    }

    // ================= Automação humana (pipeline real) =================

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    function randInt(min: number, max: number) {
      return Math.floor(min + Math.random() * (max - min + 1));
    }

    interface Humanize {
      click_delay_ms?: number;
      type_cps_min?: number;
      type_cps_max?: number;
      pause_every_min_chars?: number;
      pause_every_max_chars?: number;
      pause_ms_min?: number;
      pause_ms_max?: number;
      scroll_dwell_ms?: number;
      suggested_selector?: string;
    }

    function visible(el: Element): boolean {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    // Botão "Message"/"Mensagem" do perfil — multi-seletores + fallback por
    // aria-label (LinkedIn muda classes com frequência; o atributo é estável).
    function findMessageButton(suggested?: string): HTMLButtonElement | null {
      const candidates: HTMLButtonElement[] = [];

      if (suggested) {
        try {
          document.querySelectorAll(suggested).forEach((el) => {
            if (el instanceof HTMLButtonElement && visible(el)) candidates.push(el);
          });
        } catch {
          // seletor sugerido inválido — segue para os canônicos
        }
      }

      const selectorList = [
        "button[aria-label*='Message']",
        "button[aria-label*='mensagem']",
        "button[aria-label*='Mensagem']",
        ".pv-s-profile-actions button",
        ".pvs-profile-actions__action",
      ];
      for (const sel of selectorList) {
        document.querySelectorAll(sel).forEach((el) => {
          if (el instanceof HTMLButtonElement && visible(el)) candidates.push(el);
        });
      }

      for (const btn of candidates) {
        const label = `${btn.getAttribute("aria-label") ?? ""} ${btn.innerText ?? ""}`.toLowerCase();
        if (/message|mensagem/.test(label) && !btn.disabled) return btn;
      }
      return null;
    }

    function findComposer(): HTMLElement | null {
      const list = document.querySelectorAll<HTMLElement>(
        ".msg-form__contenteditable, div[contenteditable='true'][role='textbox']"
      );
      for (const el of list) {
        if (visible(el)) return el;
      }
      return null;
    }

    function findSendButton(): HTMLButtonElement | null {
      const list = document.querySelectorAll<HTMLButtonElement>(
        ".msg-form__send-button, form.msg-form button[type='submit']"
      );
      for (const btn of list) {
        const label = `${btn.getAttribute("aria-label") ?? ""} ${btn.innerText ?? ""}`.toLowerCase();
        if (/send|enviar/.test(label) && !btn.disabled && visible(btn)) return btn;
      }
      return null;
    }

    async function waitFor<T>(
      fn: () => T | null,
      timeoutMs: number,
      stepMs: number
    ): Promise<T | null> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const found = fn();
        if (found) return found;
        await sleep(stepMs);
      }
      return fn();
    }

    // Digitação humana: caractere a caractere com cadência variável e pausas
    // longas ocasionais (parâmetros vindos do assist Jev via background).
    // insertText dispara os eventos input que o editor do LinkedIn espera;
    // colagem instantânea seria detectável e não dispara os eventos do form.
    async function typeHumanly(composer: HTMLElement, text: string, humanize: Humanize) {
      composer.focus();
      const cpsMin = humanize.type_cps_min ?? 7;
      const cpsMax = humanize.type_cps_max ?? 12;
      const pauseEveryMin = humanize.pause_every_min_chars ?? 25;
      const pauseEveryMax = humanize.pause_every_max_chars ?? 45;
      const pauseMsMin = humanize.pause_ms_min ?? 400;
      const pauseMsMax = humanize.pause_ms_max ?? 1200;

      let nextPauseAt = randInt(pauseEveryMin, pauseEveryMax);
      for (let i = 0; i < text.length; i++) {
        document.execCommand("insertText", false, text[i]);

        if (i >= nextPauseAt) {
          await sleep(randInt(pauseMsMin, pauseMsMax));
          nextPauseAt = i + randInt(pauseEveryMin, pauseEveryMax);
        } else {
          const cps = cpsMin + Math.random() * (cpsMax - cpsMin);
          await sleep(1000 / cps + Math.random() * 60);
        }
      }
    }

    async function executeOutreachJob(
      job: { rendered_message: string },
      humanize: Humanize
    ): Promise<{ ok: boolean; error?: string; message_body?: string }> {
      if (!window.location.pathname.startsWith("/in/")) {
        return { ok: false, error: "NOT_ON_PROFILE" };
      }

      // 1. Botão Message (1º grau) — LinkedIn carrega as ações com atraso.
      const btn = await waitFor(() => findMessageButton(humanize.suggested_selector), 15_000, 500);
      if (!btn) return { ok: false, error: "MESSAGE_BUTTON_NOT_FOUND" };

      btn.scrollIntoView({ block: "center", behavior: "smooth" });
      await sleep(humanize.scroll_dwell_ms ?? 800);
      btn.click();
      await sleep((humanize.click_delay_ms ?? 1000) + randInt(200, 600));

      // 2. Composer do messaging.
      const composer = await waitFor(findComposer, 10_000, 300);
      if (!composer) {
        document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return { ok: false, error: "COMPOSER_NOT_FOUND" };
      }

      // 3. Digitação humana.
      await typeHumanly(composer, job.rendered_message, humanize);
      await sleep(randInt(500, 1200)); // revisão humana antes de enviar

      // 4. Enviar.
      const sendBtn = await waitFor(findSendButton, 8_000, 300);
      if (!sendBtn) return { ok: false, error: "SEND_BUTTON_NOT_FOUND" };
      sendBtn.click();

      // 5. Verificação best-effort: composer fecha/limpa após o envio.
      await sleep(1500);
      if (findComposer()) {
        // A confirmação visual não apareceu, mas o botão foi clicado — o
        // report-sent do backend é quem confirma a entrega do job.
        console.warn("[VibexCorp] composer ainda visível após clique em enviar");
      }
      return { ok: true, message_body: job.rendered_message };
    }

    // --- Message Listeners from Popup / Background ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "GET_PROFILE_CONTEXT") {
        sendResponse({ profile: extractProfileData() });
        return true;
      }

      if (message.action === "EXTRACT_LINKEDIN_CONNECTIONS") {
        extractAllConnectionsWithAutoScroll(message.targetCount || 50).then((conns) => {
          sendResponse({ connections: conns, count: conns.length });
        });
        return true;
      }

      if (message.action === "EXECUTE_OUTREACH_JOB") {
        executeOutreachJob(message.job ?? {}, message.humanize ?? {}).then((result) => {
          sendResponse(result);
        });
        return true; // resposta assíncrona
      }
    });

    // --- Apollo-Style Injected Floating Action Bar on LinkedIn ---
    function injectFloatingBar() {
      if (document.getElementById("vibexcorp-apollo-bar")) return;

      const bar = document.createElement("div");
      bar.id = "vibexcorp-apollo-bar";
      bar.innerHTML = `
        <div style="position: fixed; bottom: 20px; right: 20px; z-index: 999999; display: flex; align-items: center; gap: 8px; background: #0c0d0f; border: 1px solid #27272a; border-radius: 30px; padding: 6px 14px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #fff; font-size: 12px;">
          <div style="width: 22px; height: 22px; border-radius: 50%; background: #6366f1; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px;">
            V
          </div>
          <span style="font-weight: 600; color: #f1f5f9;">VibexCorp Outreach</span>
          <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #10b981;"></span>
          <button id="vbx-quick-sync" style="background: #18191c; border: 1px solid #3f3f46; color: #e4e4e7; border-radius: 14px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: 500;">
            📥 Extrair Conexões
          </button>
          <button id="vbx-open-saas" style="background: #6366f1; border: none; color: #fff; border-radius: 14px; padding: 4px 10px; font-size: 11px; cursor: pointer; font-weight: 600;">
            ⚡ Abrir Painel
          </button>
        </div>
      `;

      document.body.appendChild(bar);

      // Sync vai pelo background: content script não faz fetch cross-origin
      // no MV3 (e o api_jwt não pode vazar para a página).
      document.getElementById("vbx-quick-sync")?.addEventListener("click", async () => {
        const btn = document.getElementById("vbx-quick-sync") as HTMLButtonElement;
        if (btn) btn.innerText = "⏳ Extraindo...";

        const conns = await extractAllConnectionsWithAutoScroll(60);
        chrome.runtime.sendMessage(
          { action: "SYNC_CONNECTIONS", payload: conns },
          (res: any) => {
            if (chrome.runtime.lastError || !res?.ok) {
              if (btn) btn.innerText = `✓ ${conns.length} lidas (painel offline?)`;
            } else {
              const synced = res.data?.synced_count ?? res.data?.synced ?? conns.length;
              if (btn) btn.innerText = `✓ ${synced} sincronizadas!`;
            }
            setTimeout(() => {
              if (btn) btn.innerText = "📥 Extrair Conexões";
            }, 3500);
          }
        );
      });

      document.getElementById("vbx-open-saas")?.addEventListener("click", () => {
        window.open("http://localhost:3001", "_blank");
      });
    }

    // Inject floating widget when page finishes loading
    if (document.readyState === "complete" || document.readyState === "interactive") {
      injectFloatingBar();
    } else {
      window.addEventListener("DOMContentLoaded", injectFloatingBar);
    }
  },
});
