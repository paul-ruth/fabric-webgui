'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { buildWsUrl } from '../utils/wsUrl';
import { getConfig } from '../api/client';
import '../styles/ai-companion.css';

const TERM_THEME = {
  background: '#1a1a2e',
  foreground: '#e0e0e0',
  cursor: '#6db3d6',
  selectionBackground: '#3a5a7a',
  black: '#1a1a2e',
  brightBlack: '#4a4a6a',
  red: '#ef5350',
  brightRed: '#ff6b6b',
  green: '#4caf6a',
  brightGreen: '#66cc80',
  yellow: '#ffca28',
  brightYellow: '#ffd54f',
  blue: '#5798bc',
  brightBlue: '#6db3d6',
  magenta: '#ab47bc',
  brightMagenta: '#ce93d8',
  cyan: '#26c6da',
  brightCyan: '#4dd0e1',
  white: '#e0e0e0',
  brightWhite: '#ffffff',
};

interface ToolDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  iconClass: string;
  needsKey: boolean;
  warning?: string;
}

const TOOLS: ToolDef[] = [
  {
    id: 'fabchat',
    name: 'FabChat',
    desc: 'FABRIC-aware AI chat assistant. Ask about slice design, FABLib, networking, and troubleshooting.',
    icon: 'FC',
    iconClass: 'fabchat',
    needsKey: true,
  },
  {
    id: 'aider',
    name: 'Aider',
    desc: 'AI pair programming in your terminal. Edit code, generate scripts, and refactor with AI assistance.',
    icon: 'Ai',
    iconClass: 'aider',
    needsKey: true,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    desc: 'Terminal-based AI coding assistant. Interactive code generation and editing.',
    icon: 'OC',
    iconClass: 'opencode',
    needsKey: true,
  },
  {
    id: 'claude',
    name: 'Claude Code',
    desc: 'Anthropic\'s official CLI for Claude. Requires your own paid Anthropic account.',
    icon: 'CC',
    iconClass: 'claude',
    needsKey: false,
    warning: 'Claude Code requires a paid Anthropic account (Max or API). Charges will apply to your account. Continue?',
  },
];

interface TabState {
  id: string;
  toolId: string;
  label: string;
}

export default function AICompanionView() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState<ToolDef | null>(null);

  useEffect(() => {
    getConfig().then((s) => setHasKey(!!s.ai_api_key_set)).catch(() => setHasKey(false));
  }, []);

  const launchTool = useCallback((tool: ToolDef) => {
    const tabId = `${tool.id}-${Date.now()}`;
    const newTab: TabState = { id: tabId, toolId: tool.id, label: tool.name };
    setTabs((prev) => [...prev, newTab]);
    setActiveTab(tabId);
  }, []);

  const handleLaunch = useCallback((tool: ToolDef) => {
    if (tool.warning) {
      setShowWarning(tool);
    } else {
      launchTool(tool);
    }
  }, [launchTool]);

  const closeTab = useCallback((tabId: string) => {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (activeTab === tabId) {
        setActiveTab(next.length > 0 ? next[next.length - 1].id : null);
      }
      return next;
    });
  }, [activeTab]);

  const showCards = tabs.length === 0;

  return (
    <div className="ai-companion">
      {showWarning && (
        <div className="ai-modal-overlay" onClick={() => setShowWarning(null)}>
          <div className="ai-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{'\u26A0'} {showWarning.name}</h3>
            <p>{showWarning.warning}</p>
            <div className="ai-modal-actions">
              <button className="ai-modal-cancel" onClick={() => setShowWarning(null)}>Cancel</button>
              <button className="ai-modal-confirm" onClick={() => { launchTool(showWarning); setShowWarning(null); }}>
                Launch Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {showCards ? (
        <div className="ai-cards">
          {TOOLS.map((tool) => {
            const ready = tool.needsKey ? hasKey : true;
            const badge = tool.id === 'claude'
              ? { cls: 'your-account', text: 'Your Account' }
              : ready
                ? { cls: 'ready', text: 'Ready' }
                : { cls: 'key-required', text: 'Key Required' };

            return (
              <div className="ai-card" key={tool.id}>
                <div className="ai-card-header">
                  <div className={`ai-card-icon ${tool.iconClass}`}>{tool.icon}</div>
                  <div className="ai-card-name">{tool.name}</div>
                </div>
                <div className="ai-card-desc">{tool.desc}</div>
                <div className="ai-card-footer">
                  <span className={`ai-badge ${badge.cls}`}>{badge.text}</span>
                  <button
                    className="ai-launch-btn"
                    disabled={tool.needsKey && !ready}
                    onClick={() => handleLaunch(tool)}
                  >
                    Launch
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="ai-tabs-area">
          <div className="ai-tab-bar">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`ai-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                <button className="ai-tab-close" onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}>{'\u2715'}</button>
              </div>
            ))}
            <button className="ai-tab-new" onClick={() => setTabs([])} title="Back to launcher">{'\u2b12'}</button>
          </div>
          <div className="ai-terminal-pane">
            {tabs.map((tab) => (
              <div key={tab.id} style={{ width: '100%', height: '100%', display: activeTab === tab.id ? 'block' : 'none' }}>
                <AITerminalPane toolId={tab.toolId} tabId={tab.id} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AITerminalPane({ toolId, tabId }: { toolId: string; tabId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: { ...TERM_THEME },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    term.writeln(`\x1b[36m[ai] Launching ${toolId}...\x1b[0m`);

    const wsUrl = buildWsUrl(`/ws/terminal/ai/${encodeURIComponent(toolId)}`);
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31mWebSocket error.\x1b[0m');
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[33mConnection closed.\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, [toolId, tabId]);

  return <div className="ai-terminal-container" ref={containerRef} />;
}
