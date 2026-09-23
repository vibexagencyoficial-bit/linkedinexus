import React, { useState, useEffect } from "react";
import { UserCheck, Upload, AlertCircle, CheckCircle2, Target } from "lucide-react";

export function App() {
  const [profile, setProfile] = useState<any>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Request profile context from current active tab content script
    chrome.tabs?.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab?.id) {
        chrome.tabs.sendMessage(activeTab.id, { action: "GET_PROFILE_CONTEXT" }, (res) => {
          if (res?.profile) {
            setProfile(res.profile);
          }
        });
      }
    });
  }, []);

  const handleCaptureLead = () => {
    if (!profile) return;
    setSaving(true);
    setStatusMsg("");

    chrome.runtime.sendMessage(
      {
        action: "CAPTURE_LEAD",
        payload: {
          first_name: profile.first_name,
          last_name: profile.last_name,
          full_name: profile.full_name,
          company: profile.company,
          job_title: profile.job_title,
          linkedin_url: profile.linkedin_url,
        },
      },
      (res) => {
        setSaving(false);
        if (res?.success) {
          setStatusMsg("Contato cadastrado e deduplicado com sucesso!");
        } else {
          setStatusMsg(res?.error || "Erro ao capturar contato");
        }
      }
    );
  };

  return (
    <div style={{ width: "100%", minHeight: "100vh", padding: 16, backgroundColor: "#090d16", color: "#f1f5f9", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid #1e293b" }}>
        <h2 style={{ fontSize: 14, fontWeight: "bold", margin: 0 }}>Sidepanel Lead Capture</h2>
        <span style={{ fontSize: 10, color: "#10b981", fontFamily: "monospace" }}>THIN CLIENT</span>
      </div>

      {profile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ padding: 12, backgroundColor: "#0f172a", borderRadius: 8, border: "1px solid #1e293b" }}>
            <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: "bold" }}>Perfil Detectado:</div>
            <div style={{ fontSize: 14, fontWeight: "bold", color: "#fff", marginTop: 4 }}>{profile.full_name}</div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>{profile.job_title}</div>
            <div style={{ fontSize: 12, color: "#38bdf8", fontWeight: "bold", marginTop: 2 }}>{profile.company}</div>
          </div>

          <button
            onClick={handleCaptureLead}
            disabled={saving}
            style={{
              padding: "10px 14px",
              backgroundColor: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontWeight: "bold",
              fontSize: 12,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <UserCheck size={16} />
            <span>{saving ? "Deduplicando & Salvando..." : "Capturar para VibexCorp"}</span>
          </button>

          {statusMsg && (
            <div style={{ padding: 10, backgroundColor: "#064e3b", color: "#6ee7b7", borderRadius: 6, fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
              <CheckCircle2 size={14} />
              <span>{statusMsg}</span>
            </div>
          )}
        </div>
      ) : (
        <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 12 }}>
          Navegue até um perfil do LinkedIn para carregar o contexto automaticamente.
        </div>
      )}
    </div>
  );
}
