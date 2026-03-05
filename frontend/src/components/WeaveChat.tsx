'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { buildWsUrl } from '../utils/wsUrl';
import {
  listWeaveSkills, listWeaveAgents, listWeaveModels, listWeaveChats, listWeaveFolders,
  deleteWeaveChat,
  type WeaveSkill, type WeaveModel, type WeaveChat as WeaveChatMeta,
} from '../api/client';
import '../styles/weave-chat.css';

/* ── Types ───────────────────────────────────────────────────────────────── */

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

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString();
}

function folderName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/* ── Autocomplete ────────────────────────────────────────────────────────── */

interface AutocompleteItem { trigger: string; name: string; description: string; }

const BUILTIN_COMMANDS: AutocompleteItem[] = [
  { trigger: '/clear', name: 'clear', description: 'Clear the conversation context' },
  { trigger: '/compact', name: 'compact', description: 'Summarize conversation to save context' },
  { trigger: '/help', name: 'help', description: 'Show available commands and skills' },
  { trigger: '/skills', name: 'skills', description: 'List available skills' },
  { trigger: '/agents', name: 'agents', description: 'List available agents' },
];

/* ── Icons ───────────────────────────────────────────────────────────────── */

const ArrowUpIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
  </svg>
);

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2v11z" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);

const SidebarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

/* ── Main Component ──────────────────────────────────────────────────────── */

export default function WeaveChat() {
  // Chat state
  const [items, setItems] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  // Session state
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('');
  const [chatList, setChatList] = useState<WeaveChatMeta[]>([]);

  // Model & folder state
  const [models, setModels] = useState<WeaveModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [selectedFolder, setSelectedFolder] = useState('');
  const [folderInput, setFolderInput] = useState('');
  const [showFolderInput, setShowFolderInput] = useState(false);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Autocomplete
  const [autocompleteItems, setAutocompleteItems] = useState<AutocompleteItem[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [selectedAutocomplete, setSelectedAutocomplete] = useState(0);
  const [allSkills, setAllSkills] = useState<AutocompleteItem[]>([]);
  const [allAgents, setAllAgents] = useState<AutocompleteItem[]>([]);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentAssistantRef = useRef<string>('');
  const turnIdRef = useRef(0);

  // ── Load data on mount ──
  useEffect(() => {
    listWeaveSkills()
      .then(skills => setAllSkills(skills.map(s => ({ trigger: `/${s.name}`, name: s.name, description: s.description }))))
      .catch(() => {});
    listWeaveAgents()
      .then(agents => setAllAgents(agents.map(a => ({ trigger: `@${a.name}`, name: a.name, description: a.description }))))
      .catch(() => {});
    listWeaveModels()
      .then(data => { setModels(data.models); setSelectedModel(data.default); })
      .catch(() => {});
    listWeaveFolders()
      .then(data => { setFolders(data.folders); setSelectedFolder(data.default); setFolderInput(data.default); })
      .catch(() => {});
    refreshChatList();
  }, []);

  const refreshChatList = useCallback(() => {
    listWeaveChats().then(setChatList).catch(() => {});
  }, []);

  // ── Scroll ──
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [items, status, scrollToBottom]);

  // ── WebSocket ──
  useEffect(() => {
    const url = buildWsUrl('/ws/weave');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'ready':
          break;

        case 'session_loaded': {
          setSessionId(data.session_id);
          setSessionTitle(data.title || 'New Chat');
          setSelectedFolder(data.folder || '');
          setFolderInput(data.folder || '');
          if (data.model) setSelectedModel(data.model);
          // Restore items
          const restored: ChatItem[] = (data.items || []).map((it: any) => {
            if (it.kind === 'tool') return { ...it, expanded: false };
            return it;
          });
          setItems(restored);
          turnIdRef.current = Math.max(0, ...restored.map((it: ChatItem) => it.turnId));
          setStreaming(false);
          setStatus('');
          break;
        }

        case 'session_updated':
          setSessionTitle(data.title || '');
          if (data.session_id) setSessionId(data.session_id);
          refreshChatList();
          break;

        case 'session_deleted':
          refreshChatList();
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
          refreshChatList();
          break;

        case 'stopped':
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

    ws.onerror = () => {
      setConnected(false);
      setItems(prev => [...prev, { kind: 'error', text: 'WebSocket connection error.', turnId: turnIdRef.current }]);
    };

    ws.onclose = () => setConnected(false);

    return () => { ws.close(); };
  }, [refreshChatList]);

  // ── Actions ──
  const newChat = useCallback((folder?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const f = folder || selectedFolder;
    setSelectedFolder(f);
    setFolderInput(f);
    ws.send(JSON.stringify({ type: 'new_session', folder: f, model: selectedModel }));
  }, [selectedFolder, selectedModel]);

  const loadChat = useCallback((id: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'load_session', session_id: id }));
  }, []);

  const deleteChatById = useCallback((id: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'delete_session', session_id: id }));
    if (sessionId === id) {
      setSessionId(null);
      setItems([]);
      setSessionTitle('');
    }
  }, [sessionId]);

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
    setShowAutocomplete(false);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, selectedModel]);

  const stopGeneration = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'stop' }));
  }, []);

  const clearChat = useCallback(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'clear' }));
  }, []);

  // ── Autocomplete ──
  const updateAutocomplete = useCallback((value: string) => {
    if (value.startsWith('/')) {
      const q = value.slice(1).toLowerCase();
      const m = [...BUILTIN_COMMANDS, ...allSkills].filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
      setAutocompleteItems(m); setShowAutocomplete(m.length > 0); setSelectedAutocomplete(0);
    } else if (value.startsWith('@')) {
      const q = value.slice(1).toLowerCase();
      const m = allAgents.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);
      setAutocompleteItems(m); setShowAutocomplete(m.length > 0); setSelectedAutocomplete(0);
    } else {
      setShowAutocomplete(false);
    }
  }, [allSkills, allAgents]);

  const applyAutocomplete = useCallback((item: AutocompleteItem) => {
    setInput(item.trigger + ' ');
    setShowAutocomplete(false);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showAutocomplete && autocompleteItems.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedAutocomplete(p => Math.min(p + 1, autocompleteItems.length - 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedAutocomplete(p => Math.max(p - 1, 0)); return; }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        if (!input.includes(' ')) { e.preventDefault(); applyAutocomplete(autocompleteItems[selectedAutocomplete]); return; }
      }
      if (e.key === 'Escape') { e.preventDefault(); setShowAutocomplete(false); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }, [sendMessage, showAutocomplete, autocompleteItems, selectedAutocomplete, input, applyAutocomplete]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    const trimmed = value.trim();
    if ((trimmed.startsWith('/') || trimmed.startsWith('@')) && !trimmed.includes(' '))
      updateAutocomplete(trimmed);
    else setShowAutocomplete(false);
  }, [updateAutocomplete]);

  const handleHintClick = useCallback((hint: string) => {
    setInput(hint + ' ');
    textareaRef.current?.focus();
  }, []);

  const toggleTool = useCallback((index: number) => {
    setItems(prev => {
      const updated = [...prev];
      const item = updated[index];
      if (item.kind === 'tool') updated[index] = { ...item, expanded: !item.expanded };
      return updated;
    });
  }, []);

  const handleFolderSubmit = useCallback(() => {
    const f = folderInput.trim();
    if (f) {
      setSelectedFolder(f);
      setShowFolderInput(false);
      newChat(f);
    }
  }, [folderInput, newChat]);

  // ── Render helpers ──
  const showWelcome = items.length === 0 && !streaming && !status;

  const renderItems = () => {
    const elements: JSX.Element[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const prevItem = i > 0 ? items[i - 1] : null;
      const isContinuation = item.kind !== 'user' && prevItem && prevItem.kind !== 'user';

      if (item.kind === 'tool') {
        elements.push(
          <div className={`weave-tool-card${isContinuation ? ' continuation' : ''}`} key={i}>
            <div className="weave-tool-header" onClick={() => toggleTool(i)}>
              <span className="weave-tool-icon">{TOOL_ICONS[item.name] || '\u2699\uFE0F'}</span>
              <span className="weave-tool-name">{item.name}</span>
              <span className="weave-tool-summary">{item.summary}</span>
              <span className="weave-tool-toggle">{item.expanded ? '\u25B2' : '\u25BC'}</span>
            </div>
            {item.expanded && (
              <>
                <div className="weave-tool-body"><pre>{JSON.stringify(item.args, null, 2)}</pre></div>
                {item.result && <div className="weave-tool-result"><pre>{item.result}</pre></div>}
              </>
            )}
          </div>
        );
      } else {
        const isLastAssistant = item.kind === 'assistant' && streaming && i === items.length - 1;
        elements.push(
          <div className={`weave-msg ${item.kind}${isContinuation ? ' continuation' : ''}`} key={i}>
            {item.kind === 'assistant' ? renderMarkdown(item.text) : item.text}
            {isLastAssistant && <span className="weave-streaming" />}
          </div>
        );
      }
    }
    return elements;
  };

  return (
    <div className="weave-layout">
      {/* ── Sidebar ── */}
      <div className={`weave-sidebar${sidebarOpen ? '' : ' collapsed'}`}>
        <div className="weave-sidebar-header">
          <button className="weave-new-chat-btn" onClick={() => newChat()} title="New Chat" disabled={!connected}>
            <PlusIcon />
            <span>New Chat</span>
          </button>
          <button className="weave-sidebar-toggle" onClick={() => setSidebarOpen(false)} title="Close sidebar">
            <SidebarIcon />
          </button>
        </div>

        {/* Folder selector */}
        <div className="weave-sidebar-folder">
          <div className="weave-folder-label">
            <FolderIcon />
            <span title={selectedFolder}>{folderName(selectedFolder)}</span>
          </div>
          {showFolderInput ? (
            <div className="weave-folder-input-row">
              <input
                className="weave-folder-input"
                value={folderInput}
                onChange={e => setFolderInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleFolderSubmit(); if (e.key === 'Escape') setShowFolderInput(false); }}
                placeholder="/path/to/folder"
                autoFocus
              />
              <button className="weave-folder-go" onClick={handleFolderSubmit}>Go</button>
            </div>
          ) : (
            <select
              className="weave-folder-select"
              value={selectedFolder}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '__custom__') {
                  setShowFolderInput(true);
                } else {
                  setSelectedFolder(v);
                  setFolderInput(v);
                }
              }}
            >
              {folders.map(f => <option key={f} value={f}>{folderName(f)}</option>)}
              <option value="__custom__">Custom path...</option>
            </select>
          )}
        </div>

        {/* Chat list */}
        <div className="weave-chat-list">
          {chatList.map(chat => (
            <div
              key={chat.id}
              className={`weave-chat-item${sessionId === chat.id ? ' active' : ''}`}
              onClick={() => loadChat(chat.id)}
            >
              <div className="weave-chat-item-icon"><ChatIcon /></div>
              <div className="weave-chat-item-info">
                <div className="weave-chat-item-title">{chat.title}</div>
                <div className="weave-chat-item-meta">
                  <span>{folderName(chat.folder)}</span>
                  <span>{timeAgo(chat.updated_at)}</span>
                </div>
              </div>
              <button
                className="weave-chat-item-delete"
                onClick={(e) => { e.stopPropagation(); deleteChatById(chat.id); }}
                title="Delete chat"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          {chatList.length === 0 && (
            <div className="weave-chat-list-empty">No previous chats</div>
          )}
        </div>
      </div>

      {/* ── Main chat area ── */}
      <div className="weave-main">
        {/* Toggle sidebar button when collapsed */}
        {!sidebarOpen && (
          <button className="weave-sidebar-open" onClick={() => setSidebarOpen(true)} title="Open sidebar">
            <SidebarIcon />
          </button>
        )}

        <div className="weave-connection">
          <span className={`weave-connection-dot${connected ? ' connected' : ''}`} />
          <span>{connected ? (sessionTitle || 'Weave') : 'Disconnected'}</span>
        </div>

        {showWelcome ? (
          <div className="weave-welcome">
            <div className="weave-welcome-icon">W</div>
            <h3>Weave</h3>
            <p>
              FABRIC AI coding assistant. Read and edit files, run commands,
              search code, and manage experiments on the FABRIC testbed.
            </p>
            <div className="weave-welcome-commands">
              <span className="weave-cmd-hint" onClick={() => handleHintClick('/help')}>/help</span>
              <span className="weave-cmd-hint" onClick={() => handleHintClick('/create-slice')}>/create-slice</span>
              <span className="weave-cmd-hint" onClick={() => handleHintClick('/fablib')}>/fablib</span>
              <span className="weave-cmd-hint" onClick={() => handleHintClick('/debug')}>/debug</span>
              <span className="weave-cmd-hint" onClick={() => handleHintClick('@template-builder')}>@template-builder</span>
            </div>
          </div>
        ) : (
          <div className="weave-messages">
            <div className="weave-messages-inner">
              {renderItems()}
              {status && (
                <div className="weave-status">
                  <div className="weave-status-spinner" />
                  <span>{status}</span>
                </div>
              )}
            </div>
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* ── Input area ── */}
        <div className="weave-input-area">
          {showAutocomplete && autocompleteItems.length > 0 && (
            <div className="weave-autocomplete">
              {autocompleteItems.map((item, idx) => (
                <div
                  key={item.trigger}
                  className={`weave-autocomplete-item${idx === selectedAutocomplete ? ' selected' : ''}`}
                  onClick={() => applyAutocomplete(item)}
                  onMouseEnter={() => setSelectedAutocomplete(idx)}
                >
                  <span className="weave-ac-trigger">{item.trigger}</span>
                  <span className="weave-ac-desc">{item.description}</span>
                </div>
              ))}
            </div>
          )}
          <div className={`weave-input-box${inputFocused ? ' focused' : ''}`}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              onFocus={() => setInputFocused(true)}
              onBlur={() => setInputFocused(false)}
              placeholder={connected ? 'Ask Weave anything... (/ for commands, @ for agents)' : 'Connecting...'}
              disabled={!connected || streaming}
              rows={1}
            />
            <div className="weave-input-footer">
              {models.length > 0 && (
                <select
                  className="weave-model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  title="Select AI model"
                >
                  {models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
              <div className="weave-input-spacer" />
              {items.length > 0 && (
                <button className="weave-clear-btn" onClick={clearChat} title="Clear conversation" disabled={!connected}>
                  {'\u{1F5D1}'}
                </button>
              )}
              {streaming ? (
                <button
                  className="weave-stop-btn"
                  onClick={stopGeneration}
                  title="Stop generation"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  className="weave-send-btn"
                  onClick={sendMessage}
                  disabled={!connected || !input.trim()}
                  title="Send message"
                >
                  <ArrowUpIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
