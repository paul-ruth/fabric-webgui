'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { buildWsUrl } from '../utils/wsUrl';
import { listWeaveModels, type WeaveModel } from '../api/client';
import '../styles/weave-mini.css';

/* ── Types ───────────────────────────────────────────────────────────────── */

interface TextMsg { kind: 'user' | 'assistant' | 'error'; text: string; turnId: number; }
interface ToolMsg { kind: 'tool'; name: string; args: Record<string, unknown>; summary: string; result?: string; expanded: boolean; turnId: number; }
type ChatItem = TextMsg | ToolMsg;

/* ── Helpers ─────────────────────────────────────────────────────────────── */

const TOOL_ICONS: Record<string, string> = {
  read_file: '\u{1F4C4}', write_file: '\u{1F4DD}', edit_file: '\u{270F}\uFE0F',
  list_directory: '\u{1F4C1}', search_files: '\u{1F50D}', glob_files: '\u{1F50E}',
  run_command: '\u{1F4BB}',
};

function toolSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_file': case 'write_file': case 'edit_file': return String(args.path || '');
    case 'list_directory': return String(args.path || '.');
    case 'search_files': return `${args.pattern || ''} in ${args.path || '.'}`;
    case 'glob_files': return String(args.pattern || '');
    case 'run_command': return String(args.command || '');
    default: return '';
  }
}

function renderMarkdown(text: string): JSX.Element[] {
  const parts: JSX.Element[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      i++;
      parts.push(<pre key={parts.length}><code>{codeLines.join('\n')}</code></pre>);
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
    if (m.startsWith('`')) parts.push(<code key={`i${match.index}`}>{m.slice(1, -1)}</code>);
    else parts.push(<strong key={`i${match.index}`}>{m.slice(2, -2)}</strong>);
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

/* ── Icons ───────────────────────────────────────────────────────────────── */

const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
  </svg>
);

/* ── Props ───────────────────────────────────────────────────────────────── */

interface DragHandleProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

interface WeaveMiniChatProps {
  onCollapse?: () => void;
  dragHandleProps?: DragHandleProps;
  panelIcon?: string;
}

/* ── Component ──────────────────────────────────────────────────────────── */

export default function WeaveMiniChat({ onCollapse, dragHandleProps, panelIcon }: WeaveMiniChatProps) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [models, setModels] = useState<WeaveModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentAssistantRef = useRef('');
  const turnIdRef = useRef(0);

  // Load models
  useEffect(() => {
    listWeaveModels()
      .then(data => { setModels(data.models); setSelectedModel(data.default); })
      .catch(() => {});
  }, []);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [items, status, scrollToBottom]);

  // WebSocket
  useEffect(() => {
    const url = buildWsUrl('/ws/weave');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Auto-create a session for the mini chat
      ws.send(JSON.stringify({ type: 'new_session', folder: '/fabric_storage', model: selectedModel }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'ready':
        case 'session_loaded':
        case 'session_updated':
        case 'session_deleted':
          break;

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
          const tid = turnIdRef.current;
          setItems(prev => {
            const last = prev[prev.length - 1];
            if (last && last.kind === 'assistant' && last.turnId === tid)
              return [...prev.slice(0, -1), { kind: 'assistant', text, turnId: tid }];
            return [...prev, { kind: 'assistant', text, turnId: tid }];
          });
          break;
        }

        case 'text_done':
          break;

        case 'tool_call': {
          const tid = turnIdRef.current;
          setItems(prev => [...prev, {
            kind: 'tool', name: data.name, args: data.args,
            summary: toolSummary(data.name, data.args), expanded: false, turnId: tid,
          }]);
          break;
        }

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
          setItems(prev => [...prev, { kind: 'error', text: data.content, turnId: turnIdRef.current }]);
          break;

        case 'cleared':
          setItems([]);
          setStreaming(false);
          setStatus('');
          turnIdRef.current = 0;
          break;
      }
    };

    ws.onerror = () => setConnected(false);
    ws.onclose = () => setConnected(false);

    return () => { ws.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(() => {
    const text = input.trim();
    const ws = wsRef.current;
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    turnIdRef.current++;
    const tid = turnIdRef.current;
    setItems(prev => [...prev, { kind: 'user', text, turnId: tid }]);
    setStatus('Thinking...');
    ws.send(JSON.stringify({ type: 'message', content: text, model: selectedModel }));
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, selectedModel]);

  const clearChat = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clear' }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [sendMessage]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 100) + 'px';
  }, []);

  const toggleTool = useCallback((index: number) => {
    setItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (item.kind === 'tool') updated[index] = { ...item, expanded: !item.expanded };
      return updated;
    });
  }, []);

  const renderItems = () => {
    const elements: JSX.Element[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prevItem = i > 0 ? items[i - 1] : null;
      const isContinuation = item.kind !== 'user' && prevItem && prevItem.kind !== 'user';

      if (item.kind === 'tool') {
        elements.push(
          <div className={`wm-tool-card${isContinuation ? ' continuation' : ''}`} key={i}>
            <div className="wm-tool-header" onClick={() => toggleTool(i)}>
              <span className="wm-tool-icon">{TOOL_ICONS[item.name] || '\u2699\uFE0F'}</span>
              <span className="wm-tool-name">{item.name}</span>
              <span className="wm-tool-toggle">{item.expanded ? '\u25B2' : '\u25BC'}</span>
            </div>
            {item.expanded && (
              <>
                <div className="wm-tool-body"><pre>{JSON.stringify(item.args, null, 2)}</pre></div>
                {item.result && <div className="wm-tool-result"><pre>{item.result}</pre></div>}
              </>
            )}
          </div>
        );
      } else {
        const isLastAssistant = item.kind === 'assistant' && streaming && i === items.length - 1;
        elements.push(
          <div className={`wm-msg ${item.kind}${isContinuation ? ' continuation' : ''}`} key={i}>
            {item.kind === 'assistant' ? renderMarkdown(item.text) : item.text}
            {isLastAssistant && <span className="wm-streaming" />}
          </div>
        );
      }
    }
    return elements;
  };

  const showWelcome = items.length === 0 && !streaming && !status;

  return (
    <div className="wm-panel">
      {/* Panel header */}
      <div className="wm-header" {...(dragHandleProps || {})}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="panel-drag-handle">{'\u283F'}</span>
          <span className={`wm-connection-dot${connected ? ' connected' : ''}`} />
          Weave
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button className="wm-clear-btn" onClick={clearChat} title="Clear chat" disabled={items.length === 0}>
            {'\u2715'}
          </button>
          {onCollapse && (
            <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); onCollapse(); }} title="Collapse">
              {panelIcon || '\u2726'}
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="wm-messages">
        {showWelcome ? (
          <div className="wm-welcome">
            <div className="wm-welcome-icon">W</div>
            <p>Ask Weave to create, edit, or manage slices, templates, and experiments.</p>
          </div>
        ) : (
          <div className="wm-messages-inner">
            {renderItems()}
            {status && (
              <div className="wm-status">
                <div className="wm-status-spinner" />
                <span>{status}</span>
              </div>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="wm-input-area">
        <div className="wm-input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Ask Weave..."
            rows={1}
            disabled={!connected || streaming}
          />
          <button
            className="wm-send-btn"
            onClick={sendMessage}
            disabled={!input.trim() || !connected || streaming}
            title="Send"
          >
            <ArrowUpIcon />
          </button>
        </div>
        {models.length > 1 && (
          <select
            className="wm-model-select"
            value={selectedModel}
            onChange={e => setSelectedModel(e.target.value)}
          >
            {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}
