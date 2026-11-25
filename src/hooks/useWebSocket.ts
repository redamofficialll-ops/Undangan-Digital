import { useEffect, useRef } from 'react';
import { WsEvent } from '../types';

export function useWeddingWebSocket(
  onEvent: (event: WsEvent) => void,
  enabled = true
) {
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let unmounted = false;
    let openedOnce = false;
    let unopenedFailures = 0;

    const connect = () => {
      if (unmounted) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/ws`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        openedOnce = true;
        unopenedFailures = 0;
      };

      ws.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as WsEvent;
          onEventRef.current(parsed);
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        if (!openedOnce) {
          unopenedFailures += 1;
          if (unopenedFailures >= 2) {
            return;
          }
        }
        reconnectTimer = window.setTimeout(connect, 2500);
      };

      ws.onerror = () => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (ws) {
        ws.onopen = null;
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        } else if (ws.readyState === WebSocket.CONNECTING) {
          const socketToClose = ws;
          socketToClose.onopen = () => {
            socketToClose.close();
          };
        }
      }
    };
  }, [enabled]);
}
