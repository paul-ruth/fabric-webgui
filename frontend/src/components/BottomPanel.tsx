import { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import '../styles/bottom-panel.css';
import type { ValidationIssue, SliceErrorMessage } from '../types/fabric';
import LogView from './LogView';

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
  errors: string[];
  onClearErrors: () => void;
  sliceErrors: SliceErrorMessage[];
  fullWidth?: boolean;
  onToggleFullWidth?: () => void;
  showWidthToggle?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  panelHeight: number;
  onPanelHeightChange: (height: number) => void;
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

export default function BottomPanel({ terminals, onCloseTerminal, validationIssues, validationValid, sliceState, dirty, errors, onClearErrors, sliceErrors, fullWidth = true, onToggleFullWidth, showWidthToggle = false, expanded, onExpandedChange, panelHeight, onPanelHeightChange }: BottomPanelProps) {
  const setExpanded = onExpandedChange;
  const setPanelHeight = onPanelHeightChange;
  const [activeTab, setActiveTab] = useState('validation');

  // Auto-expand and switch to new terminal tab when one is added
  const prevTermCount = useRef(terminals.length);
  useEffect(() => {
    if (terminals.length > prevTermCount.current) {
      const newest = terminals[terminals.length - 1];
      setActiveTab(newest.id);
      setExpanded(true);
    }
    prevTermCount.current = terminals.length;
  }, [terminals.length, setExpanded]);

  // Switch to Errors tab when new errors arrive (but don't auto-expand)
  const prevErrorCount = useRef(errors.length);
  useEffect(() => {
    if (errors.length > prevErrorCount.current) {
      setActiveTab('errors');
    }
    prevErrorCount.current = errors.length;
  }, [errors.length]);

  // Auto-switch to slice errors tab when slice errors arrive
  const prevSliceErrorCount = useRef(sliceErrors.length);
  useEffect(() => {
    if (sliceErrors.length > 0 && prevSliceErrorCount.current === 0) {
      setActiveTab('slice-errors');
      setExpanded(true);
    }
    prevSliceErrorCount.current = sliceErrors.length;
  }, [sliceErrors.length, setExpanded]);

  // If active tab was closed, switch to validation
  useEffect(() => {
    if (
      activeTab !== 'errors' &&
      activeTab !== 'log' &&
      activeTab !== 'validation' &&
      activeTab !== 'local-terminal' &&
      activeTab !== 'slice-errors' &&
      !terminals.find((t) => t.id === activeTab)
    ) {
      setActiveTab('validation');
    }
  }, [terminals, activeTab]);

  const [containerTermActive, setContainerTermActive] = useState(false);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startYRef.current = e.clientY;
    startHeightRef.current = panelHeight;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startYRef.current - ev.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight * 0.8, startHeightRef.current + delta));
      setPanelHeight(newHeight);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  const termCount = terminals.length;
  const validationErrorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warnCount = validationIssues.filter((i) => i.severity === 'warning').length;
  const apiErrorCount = errors.length;
  const sliceErrorCount = sliceErrors.length;

  if (!expanded) {
    return (
      <div className="bottom-panel-collapsed">
        <span className="bottom-panel-collapsed-label" onClick={() => setExpanded(true)}>
          ▲ Console
          {sliceErrorCount > 0 && <span className="bottom-panel-badge error">{sliceErrorCount} slice error{sliceErrorCount !== 1 ? 's' : ''}</span>}
          {apiErrorCount > 0 && <span className="bottom-panel-badge error">{apiErrorCount} error{apiErrorCount !== 1 ? 's' : ''}</span>}
          <span className={`bottom-panel-badge ${validationErrorCount > 0 ? 'warn' : 'ok'}`}>{validationErrorCount} validation</span>
          {warnCount > 0 && <span className="bottom-panel-badge warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
          {termCount > 0 && <span className="bottom-panel-badge">{termCount} terminal{termCount !== 1 ? 's' : ''}</span>}
          {containerTermActive && <span className="bottom-panel-badge">local</span>}
        </span>
        <span className="bottom-panel-collapsed-actions">
          {showWidthToggle && onToggleFullWidth && (
            <button
              className="bp-width-toggle"
              onClick={(e) => { e.stopPropagation(); onToggleFullWidth(); }}
              title={fullWidth ? 'Fit to canvas panel' : 'Span full window width'}
            >
              <span className={`bp-width-icon ${fullWidth ? 'full' : 'narrow'}`} />
            </button>
          )}
        </span>
      </div>
    );
  }

  return (
    <div className="bottom-panel" style={{ height: panelHeight }}>
      <div className="bp-resize-handle" onMouseDown={handleDragStart} />
      <div className="bottom-panel-tabs">
        {sliceErrorCount > 0 && (
          <button
            className={`bp-tab ${activeTab === 'slice-errors' ? 'active' : ''}`}
            onClick={() => setActiveTab('slice-errors')}
          >
            Slice Errors
            <span className="bp-tab-badge error">{sliceErrorCount}</span>
          </button>
        )}
        <button
          className={`bp-tab ${activeTab === 'errors' ? 'active' : ''}`}
          onClick={() => setActiveTab('errors')}
          data-help-id="bottom.errors"
        >
          Errors
          {apiErrorCount > 0 && <span className="bp-tab-badge error">{apiErrorCount}</span>}
        </button>
        <button
          className={`bp-tab ${activeTab === 'validation' ? 'active' : ''}`}
          onClick={() => setActiveTab('validation')}
          data-help-id="bottom.validation"
        >
          Validation
          {!validationValid && <span className="bp-tab-indicator error" />}
          {validationValid && validationIssues.length === 0 && <span className="bp-tab-indicator ok" />}
          {validationValid && warnCount > 0 && <span className="bp-tab-indicator warn" />}
        </button>
        <button
          className={`bp-tab ${activeTab === 'log' ? 'active' : ''}`}
          onClick={() => setActiveTab('log')}
          data-help-id="bottom.log"
        >
          Log
        </button>
        <button
          className={`bp-tab bp-tab-container ${activeTab === 'local-terminal' ? 'active' : ''}`}
          onClick={() => { setActiveTab('local-terminal'); setExpanded(true); setContainerTermActive(true); }}
          data-help-id="bottom.local-terminal"
        >
          Local
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
        {showWidthToggle && onToggleFullWidth && (
          <button
            className="bp-width-toggle"
            onClick={onToggleFullWidth}
            title={fullWidth ? 'Fit to canvas panel' : 'Span full window width'}
          >
            <span className={`bp-width-icon ${fullWidth ? 'full' : 'narrow'}`} />
          </button>
        )}
        <button className="bp-collapse-btn" onClick={() => setExpanded(false)} title="Collapse panel">▼</button>
      </div>
      <div className="bottom-panel-content">
        <div style={{ display: activeTab === 'slice-errors' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <SliceErrorsView errors={sliceErrors} />
        </div>
        <div style={{ display: activeTab === 'errors' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <div className="bp-errors-list">
            <div className="bp-errors-header">
              <span>{errors.length} error{errors.length !== 1 ? 's' : ''}</span>
              {errors.length > 0 && (
                <button className="bp-errors-clear" onClick={onClearErrors}>Clear All</button>
              )}
            </div>
            {errors.length === 0 && (
              <div className="bp-validation-empty">No errors.</div>
            )}
            {errors.map((msg, i) => (
              <div key={i} className="bp-error-entry">
                <span className="bp-error-message">{msg}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: activeTab === 'validation' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <ValidationView issues={validationIssues} valid={validationValid} sliceState={sliceState} dirty={dirty} />
        </div>
        <div style={{ display: activeTab === 'log' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          <LogView />
        </div>
        <div style={{ display: activeTab === 'local-terminal' ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
          {containerTermActive && <ContainerTerminalView />}
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

// --- Slice Errors View ---

interface ErrorDiagnosis {
  category: string;
  summary: string;
  remedy: string;
}

function diagnoseError(message: string): ErrorDiagnosis {
  const msg = message.toLowerCase();
  if (msg.includes('could not find image') || msg.includes('image not found')) {
    const match = message.match(/image\s+([\w_]+)/i);
    const imageName = match?.[1] || 'the requested image';
    return {
      category: 'Image Not Found',
      summary: `The image "${imageName}" is not available on the target site.`,
      remedy: 'Change the node image to one available on the target site (e.g. default_ubuntu_22, default_centos_9), or try a different site.',
    };
  }
  if (msg.includes('insufficient resources') || msg.includes('no hosts available')) {
    return {
      category: 'Insufficient Resources',
      summary: 'The target site does not have enough resources to provision this node.',
      remedy: 'Try a different site with more available resources, reduce the node size (cores/RAM/disk), or remove specialized components (GPUs, SmartNICs) that may have limited availability.',
    };
  }
  if (msg.includes('closing reservation due to failure in slice')) {
    return {
      category: 'Cascade Failure',
      summary: 'This resource was closed because another resource in the slice failed.',
      remedy: 'Fix the root-cause failure on the other node/network first, then resubmit.',
    };
  }
  if (msg.includes('predecessor reservation') && msg.includes('terminal state')) {
    return {
      category: 'Dependency Failure',
      summary: 'A network or dependent resource failed because its parent node failed first.',
      remedy: 'Fix the root-cause failure on the parent node, then resubmit.',
    };
  }
  if (msg.includes('expired') || msg.includes('lease')) {
    return {
      category: 'Lease Expired',
      summary: 'The slice lease expired and the resources were reclaimed.',
      remedy: 'Create a new slice. Use a longer lease period or renew the lease before it expires.',
    };
  }
  return {
    category: 'Error',
    summary: message.length > 200 ? message.slice(0, 200) + '...' : message,
    remedy: 'Review the error message for details. You may need to adjust the slice configuration and resubmit.',
  };
}

function SliceErrorsView({ errors }: { errors: SliceErrorMessage[] }) {
  if (!errors || errors.length === 0) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-empty">No slice errors.</div>
      </div>
    );
  }

  const seen = new Set<string>();
  const diagnosed: Array<{ sliver: string; diagnosis: ErrorDiagnosis; raw: string }> = [];
  for (const err of errors) {
    const key = err.message;
    if (seen.has(key)) continue;
    seen.add(key);
    diagnosed.push({ sliver: err.sliver, diagnosis: diagnoseError(err.message), raw: err.message });
  }

  return (
    <div className="bp-validation-container">
      <div className="bp-validation-header error">
        Slice Failed — {diagnosed.length} error{diagnosed.length !== 1 ? 's' : ''}
      </div>
      {diagnosed.map((d, i) => (
        <div key={i} className="bp-slice-error-entry">
          <div className="bp-slice-error-category">
            {d.diagnosis.category}
            {d.sliver && <span className="bp-slice-error-sliver"> — {d.sliver}</span>}
          </div>
          <div className="bp-slice-error-summary">{d.diagnosis.summary}</div>
          <div className="bp-slice-error-remedy">
            <strong>Suggested fix:</strong> {d.diagnosis.remedy}
          </div>
        </div>
      ))}
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

// --- Container Terminal View ---
function ContainerTerminalView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

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

    term.writeln('\x1b[36m[local] Opening shell...\x1b[0m');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal/container`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

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
      wsRef.current = null;
    };
  }, []);

  return <div className="bp-terminal-container" ref={containerRef} />;
}
