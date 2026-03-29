import { useEffect, useRef, useState, useCallback } from 'react';

export interface UseWebSocketReturn {
  lastMessage: MessageEvent | null;
  sendMessage: (data: string | object) => void;
  connected: boolean;
}

export function useWebSocket(url: string | null): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelay = useRef(1000);
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<MessageEvent | null>(null);
  const isMountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!url || !isMountedRef.current) return;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMountedRef.current) return;
      setConnected(true);
      reconnectDelay.current = 1000;
    };

    ws.onmessage = (evt) => {
      if (!isMountedRef.current) return;
      setLastMessage(evt);
    };

    ws.onclose = () => {
      if (!isMountedRef.current) return;
      setConnected(false);
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, 30000);
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    isMountedRef.current = true;
    connect();
    return () => {
      isMountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const sendMessage = useCallback((data: string | object) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payload = typeof data === 'string' ? data : JSON.stringify(data);
      wsRef.current.send(payload);
    }
  }, []);

  return { lastMessage, sendMessage, connected };
}
