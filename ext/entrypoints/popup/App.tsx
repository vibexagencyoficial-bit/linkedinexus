import React, { useCallback, useEffect, useState } from "react";
import {
  ShieldCheck,
  ExternalLink,
  AlertCircle,
  Key,
  RefreshCw,
  Users,
  PauseCircle,
  PlayCircle,
  Send,
} from "lucide-react";

const API_BASE_URL = "http://localhost:8080/api/v1";
const PANEL_URL = "http://localhost:3001";

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

const EMPTY_STATE: BgState = {
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

// NOTA Fase D: o único caminho de pareamento é o Código de Pareamento
// (device + token_hash). Sem botão fake de disparo: o envio é automático —
// o background faz polling em /messaging/pending-outreach e a automação
// humana roda no LinkedIn quando o painel ativa a campanha.
export function App() {
  const [state, setState] = useState<BgState>(EMPTY_STATE);
  const [hasExtensionToken, setHasExtensionToken] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [pairing, setPairing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(() => {
    chrome.runtime.sendMessage({ action: "GET_STATE" }, (res) => {
      if (chrome.runtime.lastError || !res) return;
      setState(res.state ?? EMPTY_STATE);
      setHasExtensionToken(!!res.has_extension_token);
    });
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [refresh]);

  const handlePair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairing(true);
    setStatusMsg("");

    try {
      const res = await fetch(`${API_BASE_URL}/extension/pair`, {
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
        setPairing(false);
        return;
      }

      chrome.storage.local.set(
        {
          extension_token: data.extension_token,
          api_jwt: data.api_jwt ?? "",
          device_id: data.device_id ?? "",
        },
        () => {
          setStatusMsg("✓ Pareado! A campanha ativa no painel passa a rodar aqui.");
          setPairingCode("");
          refresh();
          setPairing(false);
        }
      );
    } catch {
      setStatusMsg("Erro ao conectar à API local (suba o painel com scripts/local/start.ps1).");
      setPairing(false);
    }
  };

  const handleTogglePause = () => {
    chrome.runtime.sendMessage(
      { action: "TOGGLE_PAUSE", paused: !state.paused },
      () => setTimeout(refresh, 200)
    );
  };

  const handleExtractConnections = async () => {
    setSyncing(true);
    setStatusMsg("");
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id || !activeTab.url?.includes("linkedin.com")) {
        setStatusMsg("Abra uma página do LinkedIn para extrair conexões.");
        setSyncing(false);
        return;
      }

      const resp = await chrome.tabs
        .sendMessage(activeTab.id, { action: "EXTRACT_LINKEDIN_CONNECTIONS", targetCount: 60 })
        .catch(() => null);
      const extracted: any[] = resp?.connections ?? [];
      if (extracted.length === 0) {
        setStatusMsg("Nenhuma conexão encontrada na página atual (abra Minhas Conexões).");
        setSyncing(false);
        return;
      }

      chrome.runtime.sendMessage(
        { action: "SYNC_CONNECTIONS", payload: extracted },
        (res: any) => {
          setSyncing(false);
          if (chrome.runtime.lastError || !res?.ok) {
            setStatusMsg(res?.error || "Falha ao sincronizar com o painel.");
            return;
          }
          setStatusMsg(`✓ ${res.data?.synced ?? extracted.length} conexões sincronizadas.`);
        }
      );
    } catch {
      setStatusMsg("Erro ao extrair conexões.");
      setSyncing(false);
    }
  };

  const handleLogout = () => {
    chrome.storage.local.remove(
      ["extension_token", "api_jwt", "device_id", "auth_token", "bg_state", "outreach_paused"],
      () => refresh()
    );
  };

  const paired = state.paired || hasExtensionToken;
  const dailyText =
    state.daily_remaining >= 0 ? `${state.daily_remaining} restantes hoje` : "saldo desconhecido";

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
            <span style={{ fontSize: 9, color: "#a1a1aa" }}>Automação humana no LinkedIn</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", backgroundColor: paired ? "#10b981" : "#ef4444" }}></span>
          <span style={{ fontSize: 10, color: paired ? "#10b981" : "#ef4444", fontWeight: 600 }}>{paired ? "CONECTADA" : "SEM PAREAMENTO"}</span>
        </div>
      </div>

      {statusMsg && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, backgroundColor: statusMsg.includes("✓") ? "#064e3b" : "#450a0a", border: `1px solid ${statusMsg.includes("✓") ? "#059669" : "#7f1d1d"}`, color: statusMsg.includes("✓") ? "#6ee7b7" : "#fca5a5", fontSize: 11 }}>
          {statusMsg}
        </div>
      )}

      {state.last_error && !statusMsg && (
        <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 6, backgroundColor: "#3b2708", border: "1px solid #b45309", color: "#fcd34d", fontSize: 11, display: "flex", gap: 6, alignItems: "center" }}>
          <AlertCircle size={13} />
          <span>{state.last_error}</span>
        </div>
      )}

      {paired ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Campanha ativa — estado real do pipeline (pending-outreach) */}
          <div style={{ padding: 10, backgroundColor: "#141518", borderRadius: 8, border: "1px solid #27272a", fontSize: 11 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ color: "#71717a", fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Campanha Ativa</span>
              <span style={{ color: "#818cf8", fontSize: 10, fontWeight: 600 }}>{state.queue_remaining} na fila</span>
            </div>
            <div style={{ fontWeight: 600, color: state.campaign_name ? "#fff" : "#71717a", fontSize: 12, marginBottom: 6 }}>
              {state.campaign_name || "Nenhuma campanha rodando no painel"}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#a1a1aa", fontSize: 10 }}>
              <span>{dailyText}</span>
              {state.last_sent_name && (
                <span>último: {state.last_sent_name}</span>
              )}
            </div>
          </div>

          {state.dispatching && (
            <div style={{ padding: 10, backgroundColor: "#1e1b4b", borderRadius: 8, border: "1px solid #4338ca", fontSize: 11, color: "#c7d2fe", display: "flex", alignItems: "center", gap: 6 }}>
              <Send size={13} />
              <span>Automação executando um envio no LinkedIn…</span>
            </div>
          )}

          {/* Pausar/retomar o ciclo local (o painel continua mandando jobs;
              aqui a extensão para de executá-los) */}
          <button
            onClick={handleTogglePause}
            style={{ width: "100%", padding: "9px 12px", backgroundColor: state.paused ? "#059669" : "#b45309", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            {state.paused ? <PlayCircle size={15} /> : <PauseCircle size={15} />}
            <span>{state.paused ? "Retomar automação" : "Pausar automação"}</span>
          </button>

          {/* Extração real de conexões (auto-scroll na página do LinkedIn) */}
          <button
            onClick={handleExtractConnections}
            disabled={syncing}
            style={{ width: "100%", padding: "8px 12px", backgroundColor: "#1e1f24", color: "#e4e4e7", border: "1px solid #3f3f46", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: syncing ? 0.7 : 1 }}
          >
            {syncing ? <RefreshCw size={14} className="animate-spin" color="#818cf8" /> : <Users size={14} color="#818cf8" />}
            <span>📥 Extrair Conexões do LinkedIn (Auto-Scroll)</span>
          </button>

          <button
            onClick={() => window.open("https://www.linkedin.com/mynetwork/invite-connect/connections/", "_blank")}
            style={{ width: "100%", padding: "6px 12px", backgroundColor: "transparent", color: "#818cf8", border: "1px dashed #4338ca", borderRadius: 6, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
          >
            <span>🌐 Abrir Minhas Conexões no LinkedIn</span>
            <ExternalLink size={11} />
          </button>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 2 }}>
            <button
              onClick={() => window.open(`${PANEL_URL}/inbox`, "_blank")}
              style={{ padding: "6px 10px", backgroundColor: "#18191c", color: "#e4e4e7", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <span>Ver Inbox</span>
              <ExternalLink size={11} />
            </button>
            <button
              onClick={() => window.open(`${PANEL_URL}/extension`, "_blank")}
              style={{ padding: "6px 10px", backgroundColor: "#18191c", color: "#e4e4e7", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}
            >
              <ShieldCheck size={11} />
              <span>Página da Extensão</span>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <form onSubmit={handlePair} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: "#a1a1aa" }}>
              Cole o código gerado na aba <b>Extensão</b> no painel:
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
              disabled={pairing}
              style={{ width: "100%", padding: "8px 12px", backgroundColor: "#6366f1", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            >
              {pairing ? <RefreshCw size={14} className="animate-spin" /> : <Key size={14} />}
              <span>Vincular Extensão</span>
            </button>
          </form>

          <button
            onClick={() => window.open(`${PANEL_URL}/extension`, "_blank")}
            style={{ width: "100%", padding: "7px 12px", backgroundColor: "#18191c", color: "#a1a1aa", border: "1px solid #27272a", borderRadius: 6, cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
          >
            <span>Abrir página da Extensão no painel</span>
            <ExternalLink size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
