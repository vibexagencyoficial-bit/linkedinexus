import { defineBackground } from "wxt/sandbox";

export default defineBackground(() => {
  const API_BASE_URL = "http://localhost:8080/api/v1";

  console.log("[VibexCorp Extension] Thin Client Background Service Worker Initialized.");

  // Periodic heartbeat every 60 seconds (Spec Section 11)
  const sendHeartbeat = () => {
    chrome.storage?.local?.get(["auth_token"], async (result) => {
      if (!result?.auth_token) return;
      try {
        await fetch(`${API_BASE_URL}/extension/heartbeat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${result.auth_token}`,
          },
        });
      } catch {
        // Silent catch for network connectivity
      }
    });
  };

  setInterval(sendHeartbeat, 60000);
  sendHeartbeat();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "GET_AUTH_TOKEN") {
      chrome.storage.local.get(["auth_token", "user_profile"], (result) => {
        sendResponse({ token: result.auth_token, user: result.user_profile });
      });
      return true;
    }

    if (message.action === "CAPTURE_LEAD") {
      chrome.storage.local.get(["auth_token"], async (result) => {
        if (!result.auth_token) {
          sendResponse({ success: false, error: "Extensão não autenticada na API da VibexCorp." });
          return;
        }

        try {
          const response = await fetch(`${API_BASE_URL}/contacts`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${result.auth_token}`,
              "X-Request-ID": `ext-${Date.now()}`,
            },
            body: JSON.stringify(message.payload),
          });

          const data = await response.json();
          if (!response.ok) {
            sendResponse({ success: false, error: data.error || "Erro na API" });
            return;
          }

          sendResponse({ success: true, data });
        } catch (err: any) {
          sendResponse({ success: false, error: err.message });
        }
      });
      return true;
    }

    if (message.action === "SYNC_CONNECTIONS") {
      chrome.storage.local.get(["auth_token"], async (result) => {
        if (!result.auth_token) {
          sendResponse({ success: false, error: "Extensão não autenticada." });
          return;
        }

        try {
          const response = await fetch(`${API_BASE_URL}/contacts/sync-linkedin`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${result.auth_token}`,
            },
            body: JSON.stringify({ connections: message.payload }),
          });

          const data = await response.json();
          sendResponse({ success: response.ok, data });
        } catch (err: any) {
          sendResponse({ success: false, error: err.message });
        }
      });
      return true;
    }
  });
});
