import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "VibexCorp LinkedIn Outreach",
    description: "Extensão Thin Client para captura contextual e acompanhamento de cadência no LinkedIn.",
    version: "1.0.0",
    // "alarms" é OBRIGATÓRIO: o background usa chrome.alarms como keepalive
    // MV3 (service worker dorme ~30s parado). Sem ela, o polling pára
    // silenciosamente e a automação "não acontece nada na tela".
    permissions: ["storage", "activeTab", "tabs", "scripting", "cookies", "alarms"],
    host_permissions: [
      "*://*.linkedin.com/*",
      "http://localhost:8080/*",
      "http://localhost:3001/*"
    ],
    action: {
      default_title: "VibexCorp Outreach",
    },
  },
});
