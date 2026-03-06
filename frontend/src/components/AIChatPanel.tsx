'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import { getAiModels, getChatAgents, streamChat, stopChatStream, getConfig } from '../api/client';
import type { ChatAgent } from '../api/client';
import '../styles/ai-chat-panel.css';

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
  expanded?: boolean;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'tool-activity';
  content: string;
  toolCalls?: ToolCall[];
}

interface AIChatPanelProps {
  onCollapse: () => void;
  dragHandleProps?: Record<string, unknown>;
  panelIcon?: string;
  sliceContext?: string;
  /** Callback to refresh slice data after tool mutations */
  onSliceChanged?: () => void;
}

export default function AIChatPanel({ onCollapse, dragHandleProps, panelIcon, sliceContext, onSliceChanged }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [agents, setAgents] = useState<ChatAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState('');

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const didMutateRef = useRef(false);

  useEffect(() => {
    getConfig().then(s => setHasKey(!!s.ai_api_key_set)).catch(() => setHasKey(false));
    getAiModels().then(data => {
      setModels(data.models || []);
      setSelectedModel(data.default || data.models?.[0] || '');
    }).catch(() => {});
    getChatAgents().then(setAgents).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Tool names that modify slices (trigger refresh after)
  const MUTATING_TOOLS = new Set([
    'create_slice', 'add_node', 'add_component', 'add_network',
    'submit_slice', 'delete_slice', 'renew_slice', 'load_template',
    'save_as_template', 'remove_node', 'remove_network',
  ]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setError('');
    didMutateRef.current = false;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    const reqId = `chat-${Date.now()}`;
    requestIdRef.current = reqId;
    const controller = new AbortController();
    abortRef.current = controller;

    // Add empty assistant message to stream into
    setMessages(prev => [...prev, { role: 'assistant', content: '', toolCalls: [] }]);

    // Track tool calls for the current turn
    let currentToolCalls: ToolCall[] = [];

    try {
      const apiMessages = newMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as string, content: m.content }));

      for await (const chunk of streamChat(apiMessages, selectedModel, {
        agent: selectedAgent || undefined,
        sliceContext: sliceContext || undefined,
        requestId: reqId,
        signal: controller.signal,
      })) {
        if (chunk.error) {
          setError(chunk.error);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && !last.content && (!last.toolCalls || last.toolCalls.length === 0)) {
              return prev.slice(0, -1);
            }
            return prev;
          });
          break;
        }

        // Tool call notification
        if ((chunk as any).tool_call) {
          const tc = (chunk as any).tool_call;
          const newTc: ToolCall = { name: tc.name, arguments: tc.arguments };
          currentToolCalls = [...currentToolCalls, newTc];
          if (MUTATING_TOOLS.has(tc.name)) {
            didMutateRef.current = true;
          }
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, toolCalls: [...currentToolCalls] };
            }
            return updated;
          });
          continue;
        }

        // Tool result notification
        if ((chunk as any).tool_result) {
          const tr = (chunk as any).tool_result;
          currentToolCalls = currentToolCalls.map(tc =>
            tc.name === tr.name && !tc.result ? { ...tc, result: tr.result } : tc
          );
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, toolCalls: [...currentToolCalls] };
            }
            return updated;
          });
          continue;
        }

        // Regular content
        if (chunk.content) {
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + chunk.content };
            }
            return updated;
          });
        }

        if (chunk.done) break;
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Stream failed');
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && !last.content && (!last.toolCalls || last.toolCalls.length === 0)) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      requestIdRef.current = '';
      // Refresh slice data if tools mutated state
      if (didMutateRef.current && onSliceChanged) {
        onSliceChanged();
      }
    }
  }, [input, messages, streaming, selectedModel, selectedAgent, sliceContext, onSliceChanged]);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (requestIdRef.current) stopChatStream(requestIdRef.current).catch(() => {});
    setStreaming(false);
  }, []);

  const handleClear = useCallback(() => {
    if (streaming) handleStop();
    setMessages([]);
    setError('');
  }, [streaming, handleStop]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  }, []);

  const toggleToolExpanded = useCallback((msgIdx: number, toolIdx: number) => {
    setMessages(prev => {
      const updated = [...prev];
      const msg = updated[msgIdx];
      if (msg?.toolCalls) {
        const tcs = [...msg.toolCalls];
        tcs[toolIdx] = { ...tcs[toolIdx], expanded: !tcs[toolIdx].expanded };
        updated[msgIdx] = { ...msg, toolCalls: tcs };
      }
      return updated;
    });
  }, []);

  if (hasKey === false) {
    return (
      <div className="ai-chat-panel">
        <div className="ai-chat-header" {...dragHandleProps}>
          {panelIcon && <span style={{ cursor: 'grab' }}>{panelIcon}</span>}
          <span className="ai-chat-header-icon">AI</span>
          <span className="ai-chat-header-title">FABRIC AI</span>
          <button className="ai-chat-collapse-btn" onClick={onCollapse} title="Collapse">{'\u2715'}</button>
        </div>
        <div className="ai-chat-no-key">
          <span style={{ fontSize: 24 }}>{'\u26A0'}</span>
          <span>FABRIC API key required</span>
          <span style={{ fontSize: 11, opacity: 0.7 }}>Configure your API key in Settings to use AI chat</span>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-chat-panel" data-help-id="ai-chat.panel">
      <div className="ai-chat-header" data-help-id="ai-chat.panel" {...dragHandleProps}>
        {panelIcon && <span style={{ cursor: 'grab' }}>{panelIcon}</span>}
        <span className="ai-chat-header-icon">AI</span>
        <span className="ai-chat-header-title">FABRIC AI</span>
        <button className="ai-chat-new-btn" onClick={handleClear} title="New chat" data-help-id="ai-chat.clear">{'\u21BA'}</button>
        <button className="ai-chat-collapse-btn" onClick={onCollapse} title="Collapse">{'\u2715'}</button>
      </div>

      <div className="ai-chat-config">
        <select className="ai-chat-select" value={selectedModel} onChange={e => setSelectedModel(e.target.value)} title="Model" data-help-id="ai-chat.model" disabled={streaming}>
          {models.length === 0 && <option value="">Loading...</option>}
          {models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className="ai-chat-select" value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} title="Agent persona" data-help-id="ai-chat.agent" disabled={streaming}>
          <option value="">General</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="ai-chat-messages">
        {messages.length === 0 && !error && (
          <div className="ai-chat-empty">
            <div className="ai-chat-empty-icon">{'\u2728'}</div>
            <div className="ai-chat-empty-text">
              Ask about your slice, FABRIC resources, or tell me to create and deploy experiments.
              {sliceContext && <><br /><strong>Slice context active</strong> — I can see your topology.</>}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-chat-msg ${msg.role === 'user' ? 'user' : 'assistant'}`}>
            <span className="ai-chat-msg-role">{msg.role === 'user' ? 'You' : 'AI'}</span>
            <div className="ai-chat-msg-bubble">
              {/* Tool calls */}
              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div className="ai-chat-tools">
                  {msg.toolCalls.map((tc, ti) => (
                    <div key={ti} className="ai-chat-tool-card">
                      <button
                        className="ai-chat-tool-header"
                        onClick={() => toggleToolExpanded(i, ti)}
                      >
                        <span className="ai-chat-tool-icon">{tc.result ? '\u2713' : '\u25B6'}</span>
                        <span className="ai-chat-tool-name">{tc.name.replace(/_/g, ' ')}</span>
                        <span className="ai-chat-tool-toggle">{tc.expanded ? '\u25B4' : '\u25BE'}</span>
                      </button>
                      {tc.expanded && (
                        <div className="ai-chat-tool-detail">
                          <div className="ai-chat-tool-section">
                            <span className="ai-chat-tool-section-label">Args</span>
                            <pre>{JSON.stringify(tc.arguments, null, 2)}</pre>
                          </div>
                          {tc.result && (
                            <div className="ai-chat-tool-section">
                              <span className="ai-chat-tool-section-label">Result</span>
                              <pre>{(() => {
                                try { return JSON.stringify(JSON.parse(tc.result), null, 2); } catch { return tc.result; }
                              })()}</pre>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {/* Text content */}
              {msg.role === 'user' ? (
                msg.content
              ) : (
                <>
                  {msg.content && <ReactMarkdown>{msg.content}</ReactMarkdown>}
                  {streaming && i === messages.length - 1 && !msg.content && msg.toolCalls && msg.toolCalls.length > 0 && !msg.toolCalls[msg.toolCalls.length - 1].result && (
                    <div className="ai-chat-tool-running">Running tool...</div>
                  )}
                  {streaming && i === messages.length - 1 && (msg.content || (msg.toolCalls && msg.toolCalls.every(tc => tc.result))) && <span className="ai-chat-streaming" />}
                </>
              )}
            </div>
          </div>
        ))}
        {error && <div className="ai-chat-error">{error}</div>}
        <div ref={messagesEndRef} />
      </div>

      <div className="ai-chat-input-area">
        <textarea
          className="ai-chat-input"
          value={input}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={streaming ? 'Working...' : 'Ask about FABRIC...'}
          disabled={streaming}
          rows={1}
        />
        {streaming ? (
          <button className="ai-chat-stop-btn" onClick={handleStop} title="Stop" data-help-id="ai-chat.stop">{'\u25A0'}</button>
        ) : (
          <button className="ai-chat-send-btn" onClick={handleSend} disabled={!input.trim()} title="Send (Enter)" data-help-id="ai-chat.send">{'\u2191'}</button>
        )}
      </div>
    </div>
  );
}
