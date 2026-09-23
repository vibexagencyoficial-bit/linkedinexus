"use client";

import { useEffect, useRef } from "react";

// Painel AO VIVO: o backend publica eventos (message.queued, message.sent,
// reply.detected, extension.*, campaign.*) no SSE /events/stream. EventSource
// não envia headers — o middleware aceita access_token na query.
const EVENTS_URL =
  process.env.NEXT_PUBLIC_EVENTS_URL || "http://localhost:8080/api/v1/events/stream";

const LISTENED_EVENTS = [
  "connected",
  "message.queued",
  "message.sent",
  "reply.detected",
  "extension.paired",
  "extension.heartbeat",
  "integration.updated",
  "contact.created",
  "contacts.synced",
  "campaign.created",
  "campaign.started",
  "campaign.paused",
  "campaign.resumed",
  "settings.updated",
] as const;

/**
 * Assina o stream de eventos do backend e chama onEvent por tipo. Reconecta
 * sozinho (EventSource nativo); token nulo = sem conexão (página pública).
 */
export function useLiveEvents(
  token: string | null | undefined,
  onEvent: (type: string, payload: Record<string, unknown> | null) => void,
  deps: unknown[] = []
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!token || typeof window === "undefined") return;
    const es = new EventSource(`${EVENTS_URL}?access_token=${encodeURIComponent(token)}`);
    const listeners: Array<[string, EventListener]> = [];
    for (const name of LISTENED_EVENTS) {
      const listener: EventListener = (ev: Event) => {
        let payload: Record<string, unknown> | null = null;
        try {
          payload = JSON.parse((ev as MessageEvent).data);
        } catch {
          payload = null;
        }
        handlerRef.current(name, payload);
      };
      es.addEventListener(name, listener);
      listeners.push([name, listener]);
    }
    return () => {
      for (const [name, listener] of listeners) es.removeEventListener(name, listener);
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, ...deps]);
}
