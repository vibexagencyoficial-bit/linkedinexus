import { defineContentScript } from "wxt/sandbox";

export default defineContentScript({
  matches: ["*://*.linkedin.com/*"],
  main() {
    let isDispatching = false;
    let abortDispatch = false;

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
          // Link selector
          const linkEl = card.querySelector('a[href*="/in/"], a[href*="/messaging/thread/"]') as HTMLAnchorElement;
          let href = linkEl?.href ? linkEl.href.split("?")[0] : "";
          if (!href) return;

          // Normalize thread link to profile if available
          if (seen.has(href)) return;
          seen.add(href);

          // Name selectors with multiple fallbacks
          const nameEl = card.querySelector(
            ".mn-connection-card__name, .entity-result__title-text, .artdeco-entity-lockup__title, .msg-conversation-listitem__participant-names, span[aria-hidden='true']"
          );
          let fullName = nameEl ? nameEl.textContent?.trim() || "" : "";
          fullName = fullName.split("\n")[0].trim();
          if (!fullName || fullName.length < 2) return;

          // Occupation / Headline selector
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
        // Just extract what's on the page
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

        // Scroll down smoothly
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

    // --- Dispatch Outreach Messages Directly Through Extension ---
    async function dispatchMessages(
      token: string,
      contacts: any[],
      onProgress: (status: { current: number; total: number; contactName: string; paused: boolean }) => void
    ) {
      if (isDispatching) return;
      isDispatching = true;
      abortDispatch = false;

      for (let i = 0; i < contacts.length; i++) {
        if (abortDispatch) {
          onProgress({ current: i, total: contacts.length, contactName: "Disparos pausados pelo operador", paused: true });
          break;
        }

        const contact = contacts[i];
        const contactName = contact.full_name || contact.first_name || "Conexão";
        const messageBody = contact.rendered_message || `Olá ${contact.first_name}, vamos conectar!`;

        onProgress({
          current: i + 1,
          total: contacts.length,
          contactName: contactName,
          paused: false
        });

        // 1. Report to SaaS backend in real time
        try {
          await fetch("http://localhost:8080/api/v1/messaging/report-sent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({
              contact_id: String(contact.id),
              recipient_name: contactName,
              message_body: messageBody,
              linkedin_url: contact.linkedin_url,
              status: "sent"
            })
          });
        } catch (e) {
          console.warn("[VibexCorp] Erro ao reportar mensagem enviada:", e);
        }

        // 2. Humanized platform safety delay (4.5s countdown between messages)
        if (i < contacts.length - 1) {
          for (let s = 4; s > 0; s--) {
            if (abortDispatch) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      isDispatching = false;
    }

    // --- Message Listeners from Popup / Background ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "GET_PROFILE_CONTEXT") {
        const data = extractProfileData();
        sendResponse({ profile: data });
        return true;
      }

      if (message.action === "EXTRACT_LINKEDIN_CONNECTIONS") {
        extractAllConnectionsWithAutoScroll(message.targetCount || 50).then((conns) => {
          sendResponse({ connections: conns, count: conns.length });
        });
        return true;
      }

      if (message.action === "START_OUTREACH_DISPATCH") {
        dispatchMessages(message.token, message.contacts, (status) => {
          chrome.runtime.sendMessage({ action: "DISPATCH_PROGRESS_UPDATE", ...status }).catch(() => {});
        }).then(() => {
          sendResponse({ completed: true });
        });
        return true;
      }

      if (message.action === "PAUSE_OUTREACH_DISPATCH") {
        abortDispatch = true;
        isDispatching = false;
        sendResponse({ paused: true });
        return true;
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
            ⚡ Abrir SaaS
          </button>
        </div>
      `;

      document.body.appendChild(bar);

      document.getElementById("vbx-quick-sync")?.addEventListener("click", async () => {
        const btn = document.getElementById("vbx-quick-sync") as HTMLButtonElement;
        if (btn) btn.innerText = "⏳ Extraindo...";
        const conns = await extractAllConnectionsWithAutoScroll(60);

        // Fetch token from storage
        chrome.storage?.local?.get(["auth_token"], async (res) => {
          const tok = res?.auth_token;
          if (tok) {
            try {
              const apiRes = await fetch("http://localhost:8080/api/v1/contacts/sync-linkedin", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${tok}`
                },
                body: JSON.stringify({ connections: conns })
              });
              const data = await apiRes.json();
              if (btn) btn.innerText = `✓ ${data.synced_count || conns.length} salvas!`;
            } catch {
              if (btn) btn.innerText = "✓ Conexões lidas";
            }
          } else {
            if (btn) btn.innerText = `✓ ${conns.length} lidas (conecte ao SaaS)`;
          }
          setTimeout(() => {
            if (btn) btn.innerText = "📥 Extrair Conexões";
          }, 3500);
        });
      });

      document.getElementById("vbx-open-saas")?.addEventListener("click", () => {
        window.open("http://localhost:3000", "_blank");
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
