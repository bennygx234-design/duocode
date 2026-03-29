import { useRef, useState, useCallback } from 'react';
import type { AgentStreamEvent, ToolCallRecord } from 'duocode-shared';

interface UseSSEOptions {
  onToken?: (text: string) => void;
  onToolCall?: (toolCall: ToolCallRecord) => void;
  onToolResult?: (toolCall: ToolCallRecord) => void;
  onDone?: () => void;
  onError?: (error: string) => void;
}

export interface UseSSEReturn {
  streaming: boolean;
  startStream: (message: string, sessionId?: string) => void;
  abortStream: () => void;
}

export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const abortStream = useCallback(() => {
    abortRef.current?.abort();
    setStreaming(false);
  }, []);

  const startStream = useCallback(
    async (message: string, sessionId?: string) => {
      if (streaming) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStreaming(true);

      try {
        const res = await fetch('/api/agent/message', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
          body: JSON.stringify({ message, session_id: sessionId }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => 'Unknown error');
          options.onError?.(errText);
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim();
              if (!raw || raw === '[DONE]') continue;
              try {
                const event = JSON.parse(raw) as AgentStreamEvent;
                handleEvent(event);
              } catch {
                // Malformed SSE line; skip
              }
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== 'AbortError') {
          options.onError?.(err.message);
        }
      } finally {
        setStreaming(false);
        options.onDone?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming]
  );

  function handleEvent(event: AgentStreamEvent) {
    switch (event.type) {
      case 'text_delta':
        if (event.content) options.onToken?.(event.content);
        break;
      case 'tool_call_start':
        if (event.tool_call) options.onToolCall?.(event.tool_call);
        break;
      case 'tool_call_result':
        if (event.tool_call) options.onToolResult?.(event.tool_call);
        break;
      case 'message_complete':
        // done handled in finally
        break;
      case 'error':
        if (event.error) options.onError?.(event.error);
        break;
    }
  }

  return { streaming, startStream, abortStream };
}
