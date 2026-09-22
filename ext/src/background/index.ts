/**
 * VibexCorp Chrome Extension - Background Service Worker (Thin Client)
 * Manifest V3 - Exclusively passes events and communicates with the backend Go API.
 * NO schedulers, NO cadence logic, NO definitive state stored locally.
 */

const API_BASE_URL = "http://localhost:8080/api/v1";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VibexCorp Extension] Installed successfully as Thin Client.");
});

// Message Passing Router between Content Scripts / Popup and Backend API
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "GET_AUTH_TOKEN") {
    chrome.storage.local.get(["auth_token", "user_profile"], (result) => {
      sendResponse({ token: result.auth_token, user: result.user_profile });
    });
    return true; // Keep message channel open for async response
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
});
