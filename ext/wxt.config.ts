import { defineConfig } from "wxt";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "VibexCorp LinkedIn Outreach",
    description: "Extensão Thin Client para captura contextual e acompanhamento de cadência no LinkedIn.",
    version: "1.0.0",
    permissions: ["storage", "activeTab", "tabs", "scripting", "cookies"],
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
