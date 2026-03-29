import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSSE } from '../hooks/useSSE';
import type { ToolCallRecord } from 'duocode-shared';
import './ChatPanel.css';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;           // streamed or final text
  toolCalls?: ToolCallRecord[];
  timestamp: Date;
  streaming?: boolean;
}

interface Props {
  sessionId: string | undefined;
  agentName: string;
}

// ── Tiny inline markdown renderer ────────────────────────────────────────────
function renderMarkdown(text: string): React.ReactNode[] {
  // Split by code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g);
  const nodes: React.ReactNode[] = [];

  segments.forEach((seg, i) => {
    if (seg.startsWith('```')) {
      const match = seg.match(/^```(\w*)\n?([\s\S]*?)```$/);
      const lang = match?.[1] ?? '';
      const code = match?.[2] ?? seg.slice(3, -3);
      nodes.push(
        <pre key={i} className="chat-code-block" data-lang={lang || undefined}>
          <code>{code}</code>
        </pre>
      );
    } else {
      // Process inline: bold, italic, inline code, line breaks
      const lines = seg.split('\n');
      lines.forEach((line, li) => {
        if (li > 0) nodes.push(<br key={`${i}-br-${li}`} />);
        // inline patterns
        const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
        parts.forEach((part, pi) => {
          if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
            nodes.push(<code key={`${i}-${li}-${pi}`} className="chat-inline-code">{part.slice(1, -1)}</code>);
          } else if (part.startsWith('**') && part.endsWith('**')) {
            nodes.push(<strong key={`${i}-${li}-${pi}`}>{part.slice(2, -2)}</strong>);
          } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
            nodes.push(<em key={`${i}-${li}-${pi}`}>{part.slice(1, -1)}</em>);
          } else {
            nodes.push(part);
          }
        });
      });
    }
  });

  return nodes;
}

// ── Tool call display labels ──────────────────────────────────────────────────
const TOOL_LABELS: Record<string, string> = {
  read_file: 'read',
  write_file: 'wrote',
  list_files: 'listed',
  search_code: 'searched',
  check_conflicts: 'checked conflicts in',
  merge_to_main: 'merged to main',
  create_pr: 'opened PR',
  get_pr_list: 'fetched PRs',
  comment_on_pr: 'commented on PR',
  get_diff: 'diffed',
  get_commit_log: 'fetched commits',
  get_collaborator_activity: 'checked collaborator',
  create_issue: 'created issue',
  get_issues: 'fetched issues',
  delete_file: 'deleted',
  rename_file: 'renamed',
};

function ToolCallBadge({ tc }: { tc: ToolCallRecord }) {
  const label = TOOL_LABELS[tc.name] ?? tc.name.replace(/_/g, ' ');
  const fileArg =
    (tc.input?.path as string) ||
    (tc.input?.file_path as string) ||
    (tc.input?.filename as string) ||
    '';
  const isError = tc.status === 'error';
  const isPending = tc.status === 'pending' || tc.status === 'running';

  return (
    <div className={`chat-tool-badge${isError ? ' error' : isPending ? ' pending' : ''}`}>
      <span className="chat-tool-icon">
        {isPending ? <SpinnerIcon /> : isError ? '!' : <ToolIcon name={tc.name} />}
      </span>
      <span className="chat-tool-text">
        {label}
        {fileArg && (
          <span className="chat-tool-file"> {fileArg}</span>
        )}
      </span>
      {isError && tc.result && (
        <span className="chat-tool-result-err">{tc.result.slice(0, 80)}</span>
      )}
    </div>
  );
}

function ToolIcon({ name }: { name: string }) {
  if (name.includes('merge')) return <>&#8644;</>;
  if (name.includes('conflict')) return <>&#9888;</>;
  if (name.includes('commit') || name.includes('log')) return <>&#10003;</>;
  if (name.includes('pr')) return <>&#8652;</>;
  if (name.includes('write') || name.includes('delete') || name.includes('rename')) return <>&#9998;</>;
  if (name.includes('read') || name.includes('list') || name.includes('search')) return <>&#128269;</>;
  return <>&#9679;</>;
}

function SpinnerIcon() {
  return <span className="chat-spinner" aria-hidden="true" />;
}

function TypingIndicator() {
  return (
    <div className="chat-typing-indicator" aria-label="Agent is typing">
      <span /><span /><span />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const ChatPanel: React.FC<Props> = ({ sessionId, agentName }) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const streamMsgIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // SSE streaming callbacks
  const onToken = useCallback((text: string) => {
    setMessages((prev) => {
      if (!streamMsgIdRef.current) return prev;
      const id = streamMsgIdRef.current;
      return prev.map((m) => (m.id === id ? { ...m, content: m.content + text } : m));
    });
  }, []);

  const onToolCall = useCallback((tc: ToolCallRecord) => {
    setMessages((prev) => {
      if (!streamMsgIdRef.current) return prev;
      const id = streamMsgIdRef.current;
      return prev.map((m) => {
        if (m.id !== id) return m;
        const existing = m.toolCalls ?? [];
        return { ...m, toolCalls: [...existing, tc] };
      });
    });
  }, []);

  const onToolResult = useCallback((tc: ToolCallRecord) => {
    setMessages((prev) => {
      if (!streamMsgIdRef.current) return prev;
      const id = streamMsgIdRef.current;
      return prev.map((m) => {
        if (m.id !== id) return m;
        const updated = (m.toolCalls ?? []).map((t) => (t.id === tc.id ? tc : t));
        return { ...m, toolCalls: updated };
      });
    });
  }, []);

  const onDone = useCallback(() => {
    setMessages((prev) => {
      if (!streamMsgIdRef.current) return prev;
      const id = streamMsgIdRef.current;
      streamMsgIdRef.current = null;
      return prev.map((m) => (m.id === id ? { ...m, streaming: false } : m));
    });
  }, []);

  const onError = useCallback((err: string) => {
    setMessages((prev) => {
      if (!streamMsgIdRef.current) return prev;
      const id = streamMsgIdRef.current;
      streamMsgIdRef.current = null;
      return prev.map((m) =>
        m.id === id
          ? { ...m, streaming: false, content: m.content || `Error: ${err}` }
          : m
      );
    });
  }, []);

  const { streaming, startStream } = useSSE({ onToken, onToolCall, onToolResult, onDone, onError });

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;

    // Add user message
    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    // Add empty assistant message for streaming
    const assistantId = `asst-${Date.now()}`;
    streamMsgIdRef.current = assistantId;
    const assistantMsg: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      toolCalls: [],
      timestamp: new Date(),
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    startStream(text, sessionId);

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, streaming, startStream, sessionId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <div className="chat-panel">
      {/* Message thread */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">&#128172;</div>
            <p>Start a conversation with {agentName}.</p>
            <p className="chat-empty-hint">Ask it to read code, write files, create PRs, or check for conflicts.</p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`chat-msg chat-msg--${msg.role}`}>
            <div className="chat-msg-label">
              {msg.role === 'user' ? 'You' : agentName}
            </div>

            {/* Tool calls inline */}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div className="chat-tool-list">
                {msg.toolCalls.map((tc) => (
                  <ToolCallBadge key={tc.id} tc={tc} />
                ))}
              </div>
            )}

            {/* Message content */}
            <div className="chat-msg-bubble">
              {msg.content ? (
                <div className="chat-msg-content">
                  {renderMarkdown(msg.content)}
                </div>
              ) : msg.streaming ? (
                <TypingIndicator />
              ) : null}
            </div>

            <div className="chat-msg-time">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={streaming ? `${agentName} is working…` : `Message ${agentName}…`}
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={streaming}
          rows={1}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || streaming}
          type="button"
          aria-label="Send message"
        >
          {streaming ? <SpinnerIcon /> : <SendIcon />}
        </button>
      </div>
    </div>
  );
};

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M.5 1.163A1 1 0 011.97.28l12.868 6.837a1 1 0 010 1.766L1.969 15.72A1 1 0 01.5 14.836V10.33a1 1 0 01.816-.983L8.5 8 1.316 6.653A1 1 0 01.5 5.67V1.163z" />
    </svg>
  );
}

export default ChatPanel;
