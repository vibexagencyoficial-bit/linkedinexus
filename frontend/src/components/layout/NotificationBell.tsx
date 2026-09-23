"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  CheckCheck,
  Inbox as InboxIcon,
  RefreshCw,
  Send,
  Sparkles,
  UserCheck,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { ActivityEvent } from "@vibexcorp/api-client";

const relativeTimeFmt = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (Math.abs(minutes) < 60) return relativeTimeFmt.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relativeTimeFmt.format(-hours, "hour");
  const days = Math.round(hours / 24);
  return relativeTimeFmt.format(-days, "day");
}

function eventMeta(ev: ActivityEvent): { icon: typeof Send; label: string; tone: string } {
  if (ev.event_type === "message.queued")
    return { icon: Send, label: "Mensagem na fila", tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" };
  if (ev.event_type === "message.sent")
    return { icon: Send, label: "Mensagem enviada", tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" };
  if (ev.event_type.includes("message"))
    return { icon: Send, label: "Mensagem enviada", tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" };
  if (ev.event_type.includes("reply"))
    return { icon: Sparkles, label: "Resposta recebida", tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300" };
  if (ev.event_type.includes("synced") || ev.event_type.includes("contact"))
    return { icon: UserCheck, label: "Contato sincronizado", tone: "bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300" };
  if (ev.event_type.includes("kill") || ev.event_type.includes("security"))
    return { icon: ShieldCheck, label: "Evento de segurança", tone: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" };
  return { icon: InboxIcon, label: "Evento do sistema", tone: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300" };
}

function eventText(ev: ActivityEvent): string {
  const p =
    ev.payload && typeof ev.payload === "object"
      ? (ev.payload as Record<string, unknown>)
      : {};
  const quem = [p.contact_name, p.recipient_name].find((v) => typeof v === "string" && v);
  const camp = typeof p.campaign === "string" ? p.campaign : "";
  if (typeof p.message_body === "string" && p.message_body) return p.message_body;
  if (typeof p.reply_body === "string" && p.reply_body) return p.reply_body;
  if (ev.event_type === "message.queued") {
    return camp ? `Mensagem na fila de envio para ${quem || "o contato"} (campanha ${camp}).` : `Mensagem na fila de envio para ${quem || "o contato"}.`;
  }
  if (ev.event_type === "message.sent") {
    return `Mensagem entregue${quem ? ` a ${quem}` : ""} pela extensão.`;
  }
  if (ev.event_type === "reply.detected") {
    return `Resposta de ${quem || "um contato"} detectada.`;
  }
  return ev.description && ev.description !== ev.event_type ? ev.description : "Evento registrado pelo sistema.";
}

/**
 * Sino de notificações do header: eventos REAIS do sistema (listActivity),
 * badge de não lidas desde a última visita, "marcar todas como lidas",
 * fechar com clique fora ou Esc. Sem notificação inventada.
 */
export function NotificationBell() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadEvents = useCallback(async (withSpinner: boolean) => {
    if (withSpinner) setIsLoading(true);
    try {
      const res = await api.listActivity();
      setEvents((res.activity || []).slice(0, 12));
    } catch {
      // Erro transitório: mantém o que já está renderizado (badge honesto).
    } finally {
      if (withSpinner) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("vibex_notifications_last_seen");
      if (raw) setLastSeen(parseInt(raw, 10) || null);
    } catch {
      setLastSeen(null);
    }
    loadEvents(true);
    const interval = setInterval(() => loadEvents(false), 10000);
    return () => clearInterval(interval);
  }, [loadEvents]);

  // Fecha com clique fora ou Esc.
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside as unknown as EventListener);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClickOutside as unknown as EventListener);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const unreadCount = lastSeen
    ? events.filter((ev) => new Date(ev.created_at).getTime() > lastSeen).length
    : events.length;

  const markAllRead = () => {
    const now = Date.now();
    try {
      localStorage.setItem("vibex_notifications_last_seen", String(now));
    } catch {
      // Sem persistência: badge zera só nesta sessão.
    }
    setLastSeen(now);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-[#f4f5fa] hover:text-slate-700 dark:text-slate-400 dark:hover:bg-[#1a2132] dark:hover:text-slate-200"
        aria-label="Notificações"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-[#10141f]">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[380px] overflow-hidden rounded-2xl border border-[#e8eaf1] bg-white shadow-xl dark:border-[#232b3d] dark:bg-[#10141f]">
          <div className="flex items-center justify-between border-b border-[#eef0f6] px-4 py-3 dark:border-[#1b2231]">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Notificações</h3>
              <p className="text-xs text-slate-400">Eventos reais do sistema</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => loadEvents(true)}
                title="Atualizar"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-[#f4f5fa] hover:text-slate-600 dark:hover:bg-[#1a2132] dark:hover:text-slate-300"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              </button>
              <button
                onClick={markAllRead}
                disabled={unreadCount === 0}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-40 disabled:hover:bg-transparent dark:text-indigo-300 dark:hover:bg-indigo-500/10"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                <span>Marcar lidas</span>
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-y-auto">
            {events.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                <InboxIcon className="h-7 w-7 text-slate-300 dark:text-slate-600" />
                <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                  Nenhuma notificação
                </span>
                <p className="max-w-[260px] text-xs text-slate-400">
                  Assim que o sistema registrar eventos — envios, respostas, sincronizações — eles aparecerão aqui.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[#eef0f6] dark:divide-[#1b2231]">
                {events.map((ev) => {
                  const meta = eventMeta(ev);
                  const Icon = meta.icon;
                  const isUnread = !lastSeen || new Date(ev.created_at).getTime() > lastSeen;
                  return (
                    <li
                      key={ev.id}
                      className={`flex gap-3 px-4 py-3 transition hover:bg-[#f8f9fc] dark:hover:bg-[#141a29] ${
                        isUnread ? "bg-indigo-50/40 dark:bg-indigo-500/5" : ""
                      }`}
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {meta.label}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400">
                            {relativeTime(ev.created_at)}
                          </span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                          {eventText(ev)}
                        </p>
                      </div>
                      {isUnread && (
                        <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-indigo-500" aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
