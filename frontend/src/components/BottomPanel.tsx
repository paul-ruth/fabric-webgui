import { useState, useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import '../styles/bottom-panel.css';
import type { ValidationIssue } from '../types/fabric';

export interface TerminalTab {
  id: string;
  label: string;
  sliceName: string;
  nodeName: string;
  managementIp: string;
}

interface BottomPanelProps {
  terminals: TerminalTab[];
  onCloseTerminal: (id: string) => void;
  validationIssues: ValidationIssue[];
  validationValid: boolean;
  sliceState: string;
  dirty: boolean;
}

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
  yellow: '#ffb74d',
  brightYellow: '#ffd180',
  blue: '#6db3d6',
  brightBlue: '#8ac9ef',
  magenta: '#ba68c8',
  brightMagenta: '#ce93d8',
  cyan: '#4dd0b8',
  brightCyan: '#80e8d0',
  white: '#e0e0e0',
  brightWhite: '#ffffff',
};

export default function BottomPanel({ terminals, onCloseTerminal, validationIssues, validationValid, sliceState, dirty }: BottomPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('validation');

  // Auto-expand and switch to new terminal tab when one is added
  const prevCountRef = useRef(terminals.length);
  useEffect(() => {
    if (terminals.length > prevCountRef.current) {
      const newest = terminals[terminals.length - 1];
      setActiveTab(newest.id);
      setExpanded(true);
    }
    prevCountRef.current = terminals.length;
  }, [terminals.length]);

  // If active tab was closed, switch to validation
  useEffect(() => {
    if (activeTab !== 'log' && activeTab !== 'validation' && !terminals.find((t) => t.id === activeTab)) {
      setActiveTab('validation');
    }
  }, [terminals, activeTab]);

  const termCount = terminals.length;
  const errorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warnCount = validationIssues.filter((i) => i.severity === 'warning').length;

  if (!expanded) {
    return (
      <div className="bottom-panel-collapsed" onClick={() => setExpanded(true)}>
        <span className="bottom-panel-collapsed-label">
          ▲ Console
          <span className={`bottom-panel-badge ${errorCount > 0 ? 'warn' : 'ok'}`}>{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
          {warnCount > 0 && <span className="bottom-panel-badge warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
          {termCount > 0 && <span className="bottom-panel-badge">{termCount} terminal{termCount !== 1 ? 's' : ''}</span>}
        </span>
      </div>
    );
  }

  return (
    <div className="bottom-panel">
      <div className="bottom-panel-tabs">
        <button
          className={`bp-tab ${activeTab === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('validation')}
        >
          Validation
          {!validationValid && <span className="bp-tab-indicator error" />}
          {validationValid && validationIssues.length === 0 && <span className="bp-tab-indicator ok" />}
          {validationValid && warnCount > 0 && <span className="bp-tab-indicator warn" />}
        </button>
        <button
          className={`bp-tab ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => setActiveTab('log')}
        >
          Log
        </button>
        {terminals.map((t) => (
          <button
            key={t.id}
            className={`bp-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
            <span
              className="bp-tab-close"
              onClick={(e) => { e.stopPropagation(); onCloseTerminal(t.id); }}
            >
              ✕
            </span>
          </button>
        ))}
        <div className="bp-tab-spacer" />
        <button className="bp-collapse-btn" onClick={() => setExpanded(false)} title="Collapse panel">▼</button>
      </div>
      <div className="bottom-panel-content">
        <div style={{ display: activeTab === 'validation' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <ValidationView issues={validationIssues} valid={validationValid} sliceState={sliceState} dirty={dirty} />
        </div>
        <div style={{ display: activeTab === 'log' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <LogView />
        </div>
        {terminals.map((t) => (
          <div key={t.id} style={{ display: activeTab === t.id ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <TerminalView sliceName={t.sliceName} nodeName={t.nodeName} managementIp={t.managementIp} />
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Validation View ---
function ValidationView({ issues, valid, sliceState, dirty }: { issues: ValidationIssue[]; valid: boolean; sliceState: string; dirty: boolean }) {
  if (!sliceState) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-empty">
          No slice loaded.
        </div>
      </div>
    );
  }

  if (issues.length === 0 && valid && !dirty) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-info">
          Slice is in state <strong>{sliceState}</strong> — draft is unmodified.
        </div>
      </div>
    );
  }

  if (issues.length === 0 && valid && dirty) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-ok">
          ✓ Slice is valid and ready to submit.
        </div>
      </div>
    );
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <div className="bp-validation-container">
      {errors.length > 0 && (
        <div className="bp-validation-section">
          <div className="bp-validation-header error">
            ✕ {errors.length} Error{errors.length !== 1 ? 's' : ''} — slice cannot be submitted
          </div>
          {errors.map((issue, i) => (
            <div key={i} className="bp-validation-item error">
              <div className="bp-validation-message">{issue.message}</div>
              <div className="bp-validation-remedy">→ {issue.remedy}</div>
            </div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="bp-validation-section">
          <div className="bp-validation-header warn">
            ⚠ {warnings.length} Warning{warnings.length !== 1 ? 's' : ''}
          </div>
          {warnings.map((issue, i) => (
            <div key={i} className="bp-validation-item warn">
              <div className="bp-validation-message">{issue.message}</div>
              <div className="bp-validation-remedy">→ {issue.remedy}</div>
            </div>
          ))}
        </div>
      )}
      {valid && (
        <div className="bp-validation-ok" style={{ marginTop: 8 }}>
          ✓ Slice is valid and can be submitted (warnings are non-blocking).
        </div>
      )}
    </div>
  );
}

// --- Log View ---
function LogView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 12,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: { ...TERM_THEME },
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();
    termRef.current = term;

    term.writeln('\x1b[36m[log] Connecting to log stream...\x1b[0m');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/logs`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onerror = () => {
      term.writeln('\x1b[31m[log] WebSocket error.\x1b[0m');
    };

    ws.onclose = () => {
      term.writeln('\x1b[33m[log] Connection closed.\x1b[0m');
    };

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  return <div className="bp-terminal-container" ref={containerRef} />;
}

// --- Terminal View ---
function TerminalView({ sliceName, nodeName, managementIp }: { sliceName: string; nodeName: string; managementIp: string }) {
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

    term.writeln(`\x1b[36m[terminal] Opening session to ${nodeName} (${managementIp})...\x1b[0m`);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}`;
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
  }, [sliceName, nodeName, managementIp]);

  return <div className="bp-terminal-container" ref={containerRef} />;
}
