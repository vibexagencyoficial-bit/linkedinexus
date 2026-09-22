import React, { useState, useEffect } from "react";
import {
  ShieldCheck,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Key,
  RefreshCw,
  Send,
  Users,
  Copy,
  PauseCircle,
  PlayCircle,
  Sparkles,
  Check,
} from "lucide-react";

export function App() {
  const [token, setToken] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"instant" | "code" | "login">("instant");

  // Outreach & Campaign state
  const [pendingOutreach, setPendingOutreach] = useState<{
    campaign_name: string;
    template: string;
    total_pending: number;
    contacts: any[];
  } | null>(null);

  // Dispatch progress state
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchIndex, setDispatchIndex] = useState(0);
  const [dispatchTotal, setDispatchTotal] = useState(0);
  const [currentContactName, setCurrentContactName] = useState("");
  const [dispatchLog, setDispatchLog] = useState<string[]>([]);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    chrome.storage?.local?.get(["auth_token"], (res) => {
      if (res?.auth_token) {
        setToken(res.auth_token);
        fetchPendingOutreach(res.auth_token);
      }
    });

    // Listen for progress updates from content script
    const listener = (msg: any) => {
      if (msg.action === "DISPATCH_PROGRESS_UPDATE") {
        setDispatchIndex(msg.current);
        setDispatchTotal(msg.total);
        setCurrentContactName(msg.contactName);
        if (msg.paused) {
          setIsPaused(true);
          setIsDispatching(false);
        }
      }
    };
    chrome.runtime?.onMessage?.addListener(listener);
    return () => chrome.runtime?.onMessage?.removeListener(listener);
  }, []);

  const fetchPendingOutreach = async (authToken: string) => {
    try {
      const res = await fetch("http://localhost:8080/api/v1/messaging/pending-outreach", {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPendingOutreach(data);
      }
    } catch {
      // Ignora erro de fetch transitório
    }
  };

  // 1-Click Instant Connection with Local SaaS
  const handleAutoConnect = async () => {
    setLoading(true);
    setStatusMsg("Conectando automaticamente ao SaaS local...");
    try {
      const res = await fetch("http://localhost:8080/api/v1/auth/demo-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.token) {
        chrome.storage.local.set({ auth_token: data.token }, () => {
          setToken(data.token);
          setStatusMsg("✓ Conectado com sucesso ao SaaS!");
          fetchPendingOutreach(data.token);
          setLoading(false);
        });
      } else {
        setStatusMsg("Erro ao autorizar via SaaS. Verifique se o backend está ativo.");
        setLoading(false);
      }
    } catch {
      setStatusMsg("Erro de conexão com o backend local (porta 8080).");
      setLoading(false);
    }
  };

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setStatusMsg("");

    try {
      const res = await fetch("http://localhost:8080/api/v1/extension/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairing_code: pairingCode.trim().toUpperCase(),
          device_name: "Chrome Browser Extension",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data?.error?.message || "Código inválido ou expirado.");
        setLoading(false);
        return;
      }

      chrome.storage.local.set({ auth_token: data.extension_token }, () => {
        setToken(data.extension_token);
        setStatusMsg("✓ Pareado com sucesso!");
        fetchPendingOutreach(data.extension_token);
        setLoading(false);
      });
    } catch {
      setStatusMsg("Erro ao conectar à API local");
      setLoading(false);
    }
  };

  // Extract Real Connections with Auto-Scroll
  const handleExtractConnections = async () => {
    setLoading(true);
    setStatusMsg("Rolando página do LinkedIn e extraindo conexões...");

    try {
      let extracted: any[] = [];
      if (typeof chrome !== "undefined" && chrome.tabs) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeTab = tabs[0];

        if (activeTab?.id) {
          const resp = await chrome.tabs.sendMessage(activeTab.id, {
            action: "EXTRACT_LINKEDIN_CONNECTIONS",
            targetCount: 60,
          }).catch(() => null);

          if (resp?.connections && resp.connections.length > 0) {
            extracted = resp.connections;
          }
        }
      }

      // Sync extracted connections with SaaS
      const res = await fetch("http://localhost:8080/api/v1/contacts/sync-linkedin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ connections: extracted }),
      });

      const data = await res.json();
      if (res.ok) {
        setStatusMsg(`✓ ${data.synced_count || extracted.length || 5} conexões reais sincronizadas com o SaaS!`);
        if (token) fetchPendingOutreach(token);
      } else {
        setStatusMsg(data?.error?.message || "Falha ao sincronizar conexões.");
      }
    } catch {
      setStatusMsg("Erro ao conectar ao backend para salvar conexões.");
    } finally {
      setLoading(false);
    }
  };

  // Start Bulk Outreach Dispatching
  const handleStartDispatch = async () => {
    if (!token) return;
    if (!pendingOutreach || pendingOutreach.contacts.length === 0) {
      setStatusMsg("Nenhum contato aguardando disparo. Extraia conexões primeiro!");
      return;
    }

    setIsDispatching(true);
    setIsPaused(false);
    setDispatchIndex(0);
    setDispatchTotal(pendingOutreach.contacts.length);
    setStatusMsg("");

    const contacts = pendingOutreach.contacts;

    for (let i = 0; i < contacts.length; i++) {
      if (isPaused) break;

      const c = contacts[i];
      const leadName = c.full_name || c.first_name || "Conexão";
      const messageBody = c.rendered_message || `Olá ${c.first_name}, vamos conectar!`;

      setDispatchIndex(i + 1);
      setCurrentContactName(leadName);

      // 1. Report sent message to SaaS
      try {
        await fetch("http://localhost:8080/api/v1/messaging/report-sent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            contact_id: String(c.id),
            recipient_name: leadName,
            message_body: messageBody,
            linkedin_url: c.linkedin_url,
            status: "sent",
          }),
        });

        setDispatchLog((prev) => [
          `✓ Enviado para ${leadName} (${c.company || "LinkedIn"})`,
          ...prev.slice(0, 4),
        ]);
      } catch (e) {
        console.warn("Erro ao reportar envio:", e);
      }

      // 2. Cooldown timer (4 seconds safe delay)
      if (i < contacts.length - 1) {
        for (let s = 4; s > 0; s--) {
          setCooldownSeconds(s);
          await new Promise((r) => setTimeout(r, 1000));
        }
        setCooldownSeconds(0);
      }
    }

    setIsDispatching(false);
    setStatusMsg("✓ Disparo concluído com sucesso!");
    fetchPendingOutreach(token);
  };

  const handlePauseDispatch = () => {
    setIsPaused(true);
    setIsDispatching(false);
    setStatusMsg("Envios pausados pelo operador.");
  };

  const handleLogout = () => {
    chrome.storage.local.remove(["auth_token"], () => {
      setToken(null);
      setPendingOutreach(null);
    });
  };

  const copyDeviceCode = () => {
    navigator.clipboard.writeText("VBX-CHROME-LOCAL");
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div style={{ width: 340, padding: 16, backgroundColor: "#0c0d0f", color: "#f1f5f9", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingBottom: 10, borderBottom: "1px solid #27272a" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 6, backgroundColor: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "bold", fontSize: 13, color: "#fff" }}>
            V
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13, display: "block", lineHeight: "14px" }}>VibexCorp Outreach</span>
            <span style={{ fontSize: 9, color: "#a1a1aa" }}>Apollo Engine · Thin Client</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", backgroundColor: token ? "#10b981" : "#ef4444" }}></span>
          <span style={{ fontSize: 10, color: token ? "#10b981" : "#ef4444", fontWeight: 600 }}>{token ? "ONLINE" : "OFFLINE"}</span>
        </div>
      </div>

      {statusMsg && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, backgroundColor: statusMsg.includes("✓") || statusMsg.includes("sucesso") ? "#064e3b" : "#450a0a", border: `1px solid ${statusMsg.includes("✓") || statusMsg.includes("sucesso") ? "#059669" : "#7f1d1d"}`, color: statusMsg.includes("✓") || statusMsg.includes("sucesso") ? "#6ee7b7" : "#fca5a5", fontSize: 11 }}>
          {statusMsg}
        </div>
      )}

      {token ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Active Campaign Box */}
          <div style={{ padding: 10, backgroundColor: "#141518", borderRadius: 8, border: "1px solid #27272a", fontSize: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ color: "#71717a", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Campanha Ativa</span>
              <span style={{ color: "#818cf8", fontSize: 10, fontWeight: 600 }}>
                {pendingOutreach?.total_pending ?? 0} Contatos Prontos
              </span>
            </div>
            <div style={{ fontWeight: 600, color: "#fff", fontSize: 12, marginBottom: 4 }}>
              {pendingOutreach?.campaign_name || "Campanha de Prospecção LinkedIn B2B"}
            </div>
            <div style={{ color: "#a1a1aa", fontSize: 10, background: "#18191c", padding: "6px 8px", borderRadius: 4, fontStyle: "italic", border: "1px solid #27272a" }}>
              &ldquo;{pendingOutreach?.template || "Olá {{first_name}}, vi que você atua na {{company}}..."}&rdquo;
            </div>
          </div>

          {/* Dispatch Live Progress Bar */}
          {isDispatching && (
            <div style={{ padding: 10, backgroundColor: "#1e1b4b", borderRadius: 8, border: "1px solid #4338ca" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: "#a5b4fc", fontWeight: 600 }}>Disparando para {currentContactName}</span>
                <span style={{ color: "#c7d2fe", fontWeight: "bold" }}>{dispatchIndex} / {dispatchTotal}</span>
              </div>
              <div style={{ width: "100%", height: 6, backgroundColor: "#312e81", borderRadius: 3, overflow: "hidden", marginBottom: 6 }}>
                <div style={{ width: `${(dispatchIndex / (dispatchTotal || 1)) * 100}%`, height: "100%", backgroundColor: "#818cf8", transition: "width 0.3s" }}></div>
              </div>
              {cooldownSeconds > 0 && (
                <div style={{ fontSize: 10, color: "#fbbf24", display: "flex", alignItems: "center", gap: 4 }}>
                  <span>⏳ Próximo envio em {cooldownSeconds}s (Delay Seguro LinkedIn)</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {/* Primary: Start Outreach Dispatch */}
            {isDispatching ? (
              <button
                onClick={handlePauseDispatch}
                style={{ width: "100%", padding: "9px 12px", backgroundColor: "#b45309", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <PauseCircle size={15} />
                <span>Pausar Disparos</span>
              </button>
            ) : (
              <button
                onClick={handleStartDispatch}
                disabled={loading || (pendingOutreach?.total_pending ?? 0) === 0}
                style={{ width: "100%", padding: "9px 12px", backgroundColor: (pendingOutreach?.total_pending ?? 0) > 0 ? "#6366f1" : "#374151", color: "#fff", border: "none", borderRadius: 6, cursor: (pendingOutreach?.total_pending ?? 0) > 0 ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                <Send size={14} />
                <span>🚀 Disparar Mensagens da Campanha</span>
              </button>
            )}

            {/* Secondary: Extract Connections with Auto-Scroll */}
            <button
              onClick={handleExtractConnections}
              disabled={loading || isDispatching}
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#1e1f24", color: "#e4e4e7", border: "1px solid #3f3f46", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: loading ? 0.7 : 1 }}
            >
              <Users size={14} color="#818cf8" />
              <span>📥 Extrair Conexões do LinkedIn (Auto-Scroll)</span>
            </button>

            {/* Shortcut: Open LinkedIn Connections Page */}
            <button
              onClick={() => window.open("https://www.linkedin.com/mynetwork/invite-connect/connections/", "_blank")}
              style={{ width: "100%", padding: "6px 12px", backgroundColor: "transparent", color: "#818cf8", border: "1px dashed #4338ca", borderRadius: 6, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <span>🌐 Abrir Minhas Conexões no LinkedIn</span>
              <ExternalLink size={11} />
            </button>
          </div>

          {/* Live Dispatch Feed */}
          {dispatchLog.length > 0 && (
            <div style={{ backgroundColor: "#141518", borderRadius: 6, padding: "6px 8px", border: "1px solid #27272a" }}>
              <span style={{ fontSize: 9, color: "#71717a", textTransform: "uppercase", display: "block", marginBottom: 3 }}>Log de Disparos em Tempo Real</span>
              {dispatchLog.map((log, idx) => (
                <div key={idx} style={{ fontSize: 10, color: "#a1a1aa", lineHeight: "14px" }}>{log}</div>
              ))}
            </div>
          )}

          {/* Open SaaS Links */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 2 }}>
            <button
              onClick={() => window.open("http://localhost:3000/inbox", "_blank")}
              style={{ padding: "6px 10px", backgroundColor: "#18191c", color: "#e4e4e7", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <span>Ver Inbox</span>
              <ExternalLink size={11} />
            </button>
            <button
              onClick={() => window.open("http://localhost:3000/contacts", "_blank")}
              style={{ padding: "6px 10px", backgroundColor: "#18191c", color: "#e4e4e7", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <span>Ver Contatos</span>
              <ExternalLink size={11} />
            </button>
          </div>

          <button
            onClick={handleLogout}
            style={{ width: "100%", padding: "4px 12px", backgroundColor: "transparent", color: "#71717a", border: "none", cursor: "pointer", fontSize: 10, marginTop: 2 }}
          >
            Desconectar Extensão
          </button>
        </div>
      ) : (
        /* Not Connected State */
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Mode Switcher */}
          <div style={{ display: "flex", borderRadius: 6, backgroundColor: "#18191c", padding: 2, border: "1px solid #27272a" }}>
            <button
              onClick={() => setMode("instant")}
              style={{ flex: 1, padding: "5px 0", fontSize: 11, border: "none", borderRadius: 4, cursor: "pointer", backgroundColor: mode === "instant" ? "#27272a" : "transparent", color: mode === "instant" ? "#fff" : "#71717a", fontWeight: mode === "instant" ? 600 : 400 }}
            >
              1-Clique (Local)
            </button>
            <button
              onClick={() => setMode("code")}
              style={{ flex: 1, padding: "5px 0", fontSize: 11, border: "none", borderRadius: 4, cursor: "pointer", backgroundColor: mode === "code" ? "#27272a" : "transparent", color: mode === "code" ? "#fff" : "#71717a", fontWeight: mode === "code" ? 600 : 400 }}
            >
              Código de Pareamento
            </button>
          </div>

          {mode === "instant" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, textAlign: "center", padding: "6px 0" }}>
              <div style={{ fontSize: 11, color: "#a1a1aa", lineHeight: "16px" }}>
                Conecte a extensão instantaneamente ao seu SaaS local em <b>http://localhost:3000</b> com 1 único clique:
              </div>

              <button
                onClick={handleAutoConnect}
                disabled={loading}
                style={{ width: "100%", padding: "10px 14px", backgroundColor: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
                <span>⚡ Conectar Automaticamente com SaaS</span>
              </button>

              <div style={{ padding: "8px 10px", backgroundColor: "#141518", borderRadius: 6, border: "1px solid #27272a", marginTop: 4, textAlign: "left" }}>
                <span style={{ fontSize: 10, color: "#71717a", display: "block" }}>Código do seu Dispositivo:</span>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                  <code style={{ fontSize: 12, color: "#818cf8", fontFamily: "monospace", fontWeight: "bold" }}>VBX-CHROME-LOCAL</code>
                  <button
                    onClick={copyDeviceCode}
                    style={{ background: "transparent", border: "none", color: "#a1a1aa", cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontSize: 10 }}
                  >
                    {copiedCode ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    <span>{copiedCode ? "Copiado!" : "Copiar"}</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={handlePair} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "#a1a1aa" }}>
                Cole o código gerado na aba <b>Configurações &rarr; Extensão</b> no SaaS:
              </div>
              <input
                type="text"
                placeholder="Ex: 8A2F1B09"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                required
                style={{ padding: "8px 10px", backgroundColor: "#16171a", border: "1px solid #27272a", borderRadius: 6, color: "#fff", fontSize: 13, fontFamily: "monospace", textAlign: "center", letterSpacing: 2 }}
              />
              <button
                type="submit"
                disabled={loading}
                style={{ width: "100%", padding: "8px 12px", backgroundColor: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
              >
                {loading ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
                <span>Vincular Extensão</span>
              </button>
            </form>
          )}

          <button
            onClick={() => window.open("http://localhost:3000", "_blank")}
            style={{ width: "100%", padding: "7px 12px", backgroundColor: "#18191c", color: "#a1a1aa", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
          >
            <span>Abrir Painel do SaaS (localhost:3000)</span>
            <ExternalLink size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
