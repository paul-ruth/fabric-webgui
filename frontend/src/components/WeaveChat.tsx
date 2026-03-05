'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { buildWsUrl } from '../utils/wsUrl';
import '../styles/weave-chat.css';

interface TextMsg {
  kind: 'user' | 'assistant' | 'error';
  text: string;
  turnId: number;
}

interface ToolMsg {
  kind: 'tool';
  name: string;
  args: Record<string, unknown>;
  summary: string;
  result?: string;
  expanded: boolean;
  turnId: number;
}

type ChatItem = TextMsg | ToolMsg;

const TOOL_ICONS: Record<string, string> = {
  read_file: '\u{1F4C4}',
  write_file: '\u{1F4DD}',
  edit_file: '\u{270F}\uFE0F',
  list_directory: '\u{1F4C1}',
  search_files: '\u{1F50D}',
  glob_files: '\u{1F50E}',
  run_command: '\u{1F4BB}',
};

function toolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': return String(args.path || '');
    case 'write_file': return String(args.path || '');
    case 'edit_file': return String(args.path || '');
    case 'list_directory': return String(args.path || '.');
    case 'search_files': return `${args.pattern || ''} in ${args.path || '.'}`;
    case 'glob_files': return String(args.pattern || '');
    case 'run_command': return String(args.command || '');
    default: return '';
  }
}

/** Minimal markdown: code blocks, inline code, bold */
function renderMarkdown(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      parts.push(
        <pre key={parts.length}>
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    } else {
      parts.push(<span key={parts.length}>{renderInline(lines[i])}{'\n'}</span>);
      i++;
    }
  }
  return parts;
}

function renderInline(line: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match;
  while ((match = re.exec(line)) !== null) {
    if (match.index > last) parts.push(line.slice(last, match.index));
    const m = match[0];
    if (m.startsWith('`')) {
      parts.push(<code key={`i${match.index}`}>{m.slice(1, -1)}</code>);
    } else {
      parts.push(<strong key={`i${match.index}`}>{m.slice(2, -2)}</strong>);
    }
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export default function WeaveChat() {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentAssistantRef = useRef<string>('');
  const turnIdRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [items, status, scrollToBottom]);

  // WebSocket connection
  useEffect(() => {
    const url = buildWsUrl('/ws/weave');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const tid = turnIdRef.current;

      switch (data.type) {
        case 'status':
          setStatus(data.message || '');
          break;

        case 'assistant_start':
          currentAssistantRef.current = '';
          setStreaming(true);
          break;

        case 'text': {
          setStatus('');
          currentAssistantRef.current += data.content;
          const text = currentAssistantRef.current;
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last && last.kind === 'assistant' && last.turnId === tid) {
              return [...prev.slice(0, -1), { kind: 'assistant', text, turnId: tid }];
            }
            return [...prev, { kind: 'assistant', text, turnId: tid }];
          });
          break;
        }

        case 'text_done':
          break;

        case 'tool_call':
          setItems(prev => [
            ...prev,
            {
              kind: 'tool',
              name: data.name,
              args: data.args,
              summary: toolSummary(data.name, data.args),
              expanded: false,
              turnId: tid,
            },
          ]);
          break;

        case 'tool_result':
          setItems(prev => {
            const idx = [...prev].reverse().findIndex(
              it => it.kind === 'tool' && it.name === data.name && !(it as ToolMsg).result
            );
            if (idx === -1) return prev;
            const realIdx = prev.length - 1 - idx;
            const updated = [...prev];
            updated[realIdx] = { ...(updated[realIdx] as ToolMsg), result: data.result };
            return updated;
          });
          break;

        case 'turn_done':
          setStreaming(false);
          setStatus('');
          currentAssistantRef.current = '';
          break;

        case 'error':
          setStreaming(false);
          setStatus('');
          setItems(prev => [...prev, { kind: 'error', text: data.content, turnId: tid }]);
          break;

        case 'cleared':
          setItems([]);
          setStreaming(false);
          setStatus('');
          break;
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setStatus('');
      setItems(prev => [...prev, { kind: 'error', text: 'WebSocket connection error.', turnId: turnIdRef.current }]);
    };

    ws.onclose = () => {
      setConnected(false);
      setStatus('');
    };

    return () => {
      ws.close();
    };
  }, []);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    turnIdRef.current++;
    const tid = turnIdRef.current;
    setItems(prev => [...prev, { kind: 'user', text, turnId: tid }]);
    setStatus('Thinking...');
    wsRef.current.send(JSON.stringify({ type: 'message', content: text }));
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input]);

  const clearChat = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: 'clear' }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
  }, []);

  const toggleTool = useCallback((index: number) => {
    setItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (item.kind === 'tool') {
        updated[index] = { ...item, expanded: !item.expanded };
      }
      return updated;
    });
  }, []);

  const showWelcome = items.length === 0 && !streaming && !status;

  // Group items: user messages start a new visual group
  const renderItems = () => {
    const elements: JSX.Element[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prevItem = i > 0 ? items[i - 1] : null;
      // Add turn separator before user messages (except the first item)
      const isNewTurn = item.kind === 'user' && i > 0;
      // Tight spacing between non-user items in same turn
      const isContinuation = item.kind !== 'user' && prevItem && prevItem.kind !== 'user';

      if (item.kind === 'tool') {
        elements.push(
          <div className={`weave-tool-card${isNewTurn ? ' new-turn' : ''}${isContinuation ? ' continuation' : ''}`} key={i}>
            <div className="weave-tool-header" onClick={() => toggleTool(i)}>
              <span className="weave-tool-icon">{TOOL_ICONS[item.name] || '\u2699\uFE0F'}</span>
              <span className="weave-tool-name">{item.name}</span>
              <span className="weave-tool-summary">{item.summary}</span>
              <span className="weave-tool-toggle">{item.expanded ? '\u25B2' : '\u25BC'}</span>
            </div>
            {item.expanded && (
              <>
                <div className="weave-tool-body">
                  <pre>{JSON.stringify(item.args, null, 2)}</pre>
                </div>
                {item.result && (
                  <div className="weave-tool-result">
                    <pre>{item.result}</pre>
                  </div>
                )}
              </>
            )}
          </div>
        );
      } else {
        const isLastAssistant = item.kind === 'assistant' && streaming &&
          i === items.length - 1;
        elements.push(
          <div className={`weave-msg ${item.kind}${isNewTurn ? ' new-turn' : ''}${isContinuation ? ' continuation' : ''}`} key={i}>
            {item.kind === 'assistant' ? renderMarkdown(item.text) : item.text}
            {isLastAssistant && <span className="weave-streaming" />}
          </div>
        );
      }
    }
    return elements;
  };

  return (
    <div className="weave-chat">
      {showWelcome ? (
        <div className="weave-welcome">
          <div className="weave-welcome-icon">W</div>
          <h3>Weave</h3>
          <p>
            FABRIC AI coding assistant. I can read and edit files, run commands,
            search code, and help you manage experiments on the FABRIC testbed.
          </p>
        </div>
      ) : (
        <div className="weave-messages">
          {renderItems()}
          {status && (
            <div className="weave-status">
              <div className="weave-status-spinner" />
              <span>{status}</span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="weave-input-area">
        <button
          className="weave-clear-btn"
          onClick={clearChat}
          title="Clear conversation"
          disabled={!connected}
        >
          {'\u{1F5D1}'}
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={connected ? 'Ask Weave anything...' : 'Connecting...'}
          disabled={!connected || streaming}
          rows={1}
        />
        <button
          className="weave-send-btn"
          onClick={sendMessage}
          disabled={!connected || streaming || !input.trim()}
          title="Send message"
        >
          {'\u2191'}
        </button>
      </div>
    </div>
  );
}
