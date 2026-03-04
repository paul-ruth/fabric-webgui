'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import '../styles/bottom-panel.css';
import type { ValidationIssue, SliceErrorMessage } from '../types/fabric';
import LogView from './LogView';
import { buildWsUrl } from '../utils/wsUrl';

export interface TerminalTab {
  id: string;
  label: string;
  sliceName: string;
  nodeName: string;
  managementIp: string;
}

export interface BootConfigError {
  node: string;
  type: string;
  id: string;
  detail: string;
}

export interface RecipeConsoleLine {
  type: string;   // 'step' | 'output' | 'error'
  message: string;
}

export interface BootConsoleLine {
  type: string;   // 'node' | 'step' | 'output' | 'error'
  message: string;
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
  bootConfigErrors: BootConfigError[];
  onClearBootConfigErrors?: () => void;
  fullWidth?: boolean;
  onToggleFullWidth?: () => void;
  showWidthToggle?: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  panelHeight: number;
  onPanelHeightChange: (height: number) => void;
  statusMessage?: string;
  loading?: boolean;
  // Recipe console
  recipeConsole: RecipeConsoleLine[];
  recipeRunning: boolean;
  onClearRecipeConsole: () => void;
  // Boot config console
  bootConsole: BootConsoleLine[];
  bootRunning: boolean;
  onClearBootConsole: () => void;
}

// --- Types for pane layout ---
interface PaneState {
  id: string;
  tabIds: string[];
  activeTabId: string;
}

interface DragState {
  tabId: string;
  sourcePaneId: string;
  dropTarget: 'left' | 'right' | 'center' | null;
  targetPaneId: string | null;
}

// Fixed tab IDs (non-terminal)
const FIXED_TABS = ['slice-errors', 'errors', 'validation', 'log', 'recipes', 'boot-config', 'local-terminal'] as const;

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

let paneIdCounter = 0;
function nextPaneId() { return `pane-${++paneIdCounter}`; }

export default function BottomPanel({ terminals, onCloseTerminal, validationIssues, validationValid, sliceState, dirty, errors, onClearErrors, sliceErrors, bootConfigErrors, onClearBootConfigErrors, fullWidth = true, onToggleFullWidth, showWidthToggle = false, expanded, onExpandedChange, panelHeight, onPanelHeightChange, statusMessage, loading, recipeConsole, recipeRunning, onClearRecipeConsole, bootConsole, bootRunning, onClearBootConsole }: BottomPanelProps) {
  const setExpanded = onExpandedChange;
  const setPanelHeight = onPanelHeightChange;

  // --- Pane layout state ---
  const [panes, setPanes] = useState<PaneState[]>(() => [{
    id: nextPaneId(),
    tabIds: [...FIXED_TABS],
    activeTabId: 'validation',
  }]);
  const [paneWidths, setPaneWidths] = useState<number[]>([100]);
  const [dragState, setDragState] = useState<DragState | null>(null);

  // --- Tab metadata ---
  const termCount = terminals.length;
  const validationErrorCount = validationIssues.filter((i) => i.severity === 'error').length;
  const warnCount = validationIssues.filter((i) => i.severity === 'warning').length;
  const apiErrorCount = errors.length;
  const sliceErrorCount = sliceErrors.length;
  const bootErrorCount = bootConfigErrors.length;
  const totalSliceIssues = sliceErrorCount + bootErrorCount;

  const [containerTermActive, setContainerTermActive] = useState(false);

  // All tab IDs that should exist
  const allTabIds = useMemo(() => {
    const ids: string[] = [...FIXED_TABS];
    terminals.forEach(t => ids.push(t.id));
    return ids;
  }, [terminals]);

  // --- Sync terminal additions/removals into pane state ---
  const prevTermIds = useRef<string[]>([]);
  useEffect(() => {
    const currentTermIds = terminals.map(t => t.id);
    const prevIds = prevTermIds.current;

    // Find added terminals
    const added = currentTermIds.filter(id => !prevIds.includes(id));
    // Find removed terminals
    const removed = prevIds.filter(id => !currentTermIds.includes(id));

    if (added.length > 0 || removed.length > 0) {
      setPanes(prev => {
        let newPanes = prev.map(p => ({
          ...p,
          tabIds: p.tabIds.filter(tid => !removed.includes(tid)),
        }));

        // Add new terminals to the first pane
        if (added.length > 0 && newPanes.length > 0) {
          newPanes[0] = {
            ...newPanes[0],
            tabIds: [...newPanes[0].tabIds, ...added],
          };
        }

        // Clean up empty panes (except keep at least one)
        newPanes = newPanes.filter(p => p.tabIds.length > 0);
        if (newPanes.length === 0) {
          newPanes = [{ id: nextPaneId(), tabIds: [...FIXED_TABS], activeTabId: 'validation' }];
        }

        // Fix activeTabId if it was removed
        newPanes = newPanes.map(p => ({
          ...p,
          activeTabId: p.tabIds.includes(p.activeTabId) ? p.activeTabId : p.tabIds[0],
        }));

        return newPanes;
      });
    }

    prevTermIds.current = currentTermIds;
  }, [terminals]);

  // --- activateTab helper ---
  const activateTab = useCallback((tabId: string) => {
    setPanes(prev => {
      const pane = prev.find(p => p.tabIds.includes(tabId));
      if (!pane) return prev;
      if (pane.activeTabId === tabId) return prev;
      return prev.map(p => p.id === pane.id ? { ...p, activeTabId: tabId } : p);
    });
  }, []);

  // --- Auto-switch effects (same logic, using activateTab) ---

  // Auto-expand and switch to new terminal
  const prevTermCount = useRef(terminals.length);
  useEffect(() => {
    if (terminals.length > prevTermCount.current) {
      const newest = terminals[terminals.length - 1];
      activateTab(newest.id);
      setExpanded(true);
    }
    prevTermCount.current = terminals.length;
  }, [terminals.length, setExpanded, activateTab]);

  // Switch to Errors tab on new errors
  const prevErrorCount = useRef(errors.length);
  useEffect(() => {
    if (errors.length > prevErrorCount.current) {
      activateTab('errors');
    }
    prevErrorCount.current = errors.length;
  }, [errors.length, activateTab]);

  // Auto-switch to slice errors
  const prevSliceErrorCount = useRef(sliceErrors.length);
  const prevBootErrorCount = useRef(bootConfigErrors.length);
  useEffect(() => {
    if (sliceErrors.length > 0 && prevSliceErrorCount.current === 0) {
      activateTab('slice-errors');
      setExpanded(true);
    }
    prevSliceErrorCount.current = sliceErrors.length;
  }, [sliceErrors.length, setExpanded, activateTab]);
  useEffect(() => {
    if (bootConfigErrors.length > 0 && prevBootErrorCount.current === 0) {
      activateTab('slice-errors');
      setExpanded(true);
    }
    prevBootErrorCount.current = bootConfigErrors.length;
  }, [bootConfigErrors.length, setExpanded, activateTab]);

  // Auto-switch to recipes
  const prevRecipeRunning = useRef(recipeRunning);
  useEffect(() => {
    if (recipeRunning && !prevRecipeRunning.current) {
      activateTab('recipes');
      setExpanded(true);
    }
    prevRecipeRunning.current = recipeRunning;
  }, [recipeRunning, setExpanded, activateTab]);

  // Auto-switch to boot config
  const prevBootRunning = useRef(bootRunning);
  useEffect(() => {
    if (bootRunning && !prevBootRunning.current) {
      activateTab('boot-config');
      setExpanded(true);
    }
    prevBootRunning.current = bootRunning;
  }, [bootRunning, setExpanded, activateTab]);

  // Auto-scroll recipe console
  const recipeConsoleEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Check if any pane has recipes as active tab
    const recipesActive = panes.some(p => p.activeTabId === 'recipes');
    if (recipesActive) {
      recipeConsoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [recipeConsole, panes]);

  // Auto-scroll boot config console
  const bootConsoleEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bootActive = panes.some(p => p.activeTabId === 'boot-config');
    if (bootActive) {
      bootConsoleEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [bootConsole, panes]);

  // If active tab was closed, fix it
  useEffect(() => {
    setPanes(prev => {
      let changed = false;
      const updated = prev.map(p => {
        if (!allTabIds.includes(p.activeTabId)) {
          changed = true;
          return { ...p, activeTabId: p.tabIds[0] || 'validation' };
        }
        return p;
      });
      return changed ? updated : prev;
    });
  }, [allTabIds]);

  // --- Height resize (existing logic) ---
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const handleHeightDragStart = useCallback((e: React.MouseEvent) => {
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
  }, [panelHeight, setPanelHeight]);

  // --- Pane divider resize ---
  const paneDividerDragging = useRef(false);
  const paneDividerStartX = useRef(0);
  const paneDividerStartWidths = useRef<number[]>([]);
  const panesRowRef = useRef<HTMLDivElement>(null);

  const handlePaneDividerStart = useCallback((e: React.MouseEvent) => {
    if (panes.length < 2) return;
    e.preventDefault();
    paneDividerDragging.current = true;
    paneDividerStartX.current = e.clientX;
    paneDividerStartWidths.current = [...paneWidths];

    const containerWidth = panesRowRef.current?.offsetWidth || 1;

    const onMove = (ev: MouseEvent) => {
      if (!paneDividerDragging.current) return;
      const dx = ev.clientX - paneDividerStartX.current;
      const dPct = (dx / containerWidth) * 100;
      const w0 = Math.max(20, Math.min(80, paneDividerStartWidths.current[0] + dPct));
      const w1 = 100 - w0;
      if (w1 < 20) return;
      setPaneWidths([w0, w1]);
    };
    const onUp = () => {
      paneDividerDragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panes.length, paneWidths]);

  // --- Tab drag handlers ---
  const handleTabDragStart = useCallback((e: React.DragEvent, tabId: string, paneId: string) => {
    e.dataTransfer.setData('text/plain', tabId);
    e.dataTransfer.effectAllowed = 'move';
    setDragState({ tabId, sourcePaneId: paneId, dropTarget: null, targetPaneId: null });
  }, []);

  const handleTabDragEnd = useCallback(() => {
    setDragState(null);
  }, []);

  const handlePaneDragOver = useCallback((e: React.DragEvent, paneId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (!dragState) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const edgeThreshold = 60;

    let target: 'left' | 'right' | 'center';
    if (x < edgeThreshold && panes.length < 2) {
      target = 'left';
    } else if (x > rect.width - edgeThreshold && panes.length < 2) {
      target = 'right';
    } else {
      target = 'center';
    }

    setDragState(prev => prev ? { ...prev, dropTarget: target, targetPaneId: paneId } : null);
  }, [dragState, panes.length]);

  const handlePaneDragLeave = useCallback(() => {
    setDragState(prev => prev ? { ...prev, dropTarget: null, targetPaneId: null } : null);
  }, []);

  const handlePaneDrop = useCallback((e: React.DragEvent, targetPaneId: string) => {
    e.preventDefault();
    if (!dragState) return;

    const { tabId, sourcePaneId, dropTarget } = dragState;
    setDragState(null);

    if (!dropTarget) return;

    // Find source pane
    const sourcePaneIndex = panes.findIndex(p => p.id === sourcePaneId);
    if (sourcePaneIndex === -1) return;

    // Dropping on center = move tab to target pane's tab bar
    if (dropTarget === 'center') {
      if (sourcePaneId === targetPaneId) return; // same pane, no-op

      setPanes(prev => {
        let newPanes = prev.map(p => {
          if (p.id === sourcePaneId) {
            const newTabIds = p.tabIds.filter(t => t !== tabId);
            return {
              ...p,
              tabIds: newTabIds,
              activeTabId: newTabIds.includes(p.activeTabId) ? p.activeTabId : (newTabIds[0] || 'validation'),
            };
          }
          if (p.id === targetPaneId) {
            return {
              ...p,
              tabIds: [...p.tabIds, tabId],
              activeTabId: tabId,
            };
          }
          return p;
        });

        // Remove empty panes
        newPanes = newPanes.filter(p => p.tabIds.length > 0);
        if (newPanes.length === 0) {
          newPanes = [{ id: nextPaneId(), tabIds: [...FIXED_TABS], activeTabId: 'validation' }];
        }
        return newPanes;
      });

      // Reset to single pane widths if collapsed to one
      setPaneWidths(prev => {
        const remainingPanes = panes.filter(p => {
          if (p.id === sourcePaneId) return p.tabIds.length > 1; // will still have tabs
          return true;
        });
        return remainingPanes.length <= 1 ? [100] : prev;
      });

      return;
    }

    // Dropping on edge = split into new pane
    if (panes.length >= 2) return; // max 2 panes

    // Source pane must have more than 1 tab to split
    const sourcePane = panes[sourcePaneIndex];
    if (sourcePane.tabIds.length <= 1) return;

    const newPaneId = nextPaneId();

    setPanes(prev => {
      const updated = prev.map(p => {
        if (p.id === sourcePaneId) {
          const newTabIds = p.tabIds.filter(t => t !== tabId);
          return {
            ...p,
            tabIds: newTabIds,
            activeTabId: newTabIds.includes(p.activeTabId) ? p.activeTabId : newTabIds[0],
          };
        }
        return p;
      });

      const newPane: PaneState = {
        id: newPaneId,
        tabIds: [tabId],
        activeTabId: tabId,
      };

      if (dropTarget === 'left') {
        return [newPane, ...updated];
      } else {
        return [...updated, newPane];
      }
    });

    setPaneWidths([50, 50]);
  }, [dragState, panes]);

  // --- Tab label/badge/content helpers ---
  function getTabLabel(tabId: string): string {
    switch (tabId) {
      case 'slice-errors': return 'Slice Errors';
      case 'errors': return 'Errors';
      case 'validation': return 'Validation';
      case 'log': return 'Log';
      case 'recipes': return 'Recipes';
      case 'boot-config': return 'Boot Config';
      case 'local-terminal': return 'Local';
      default: {
        const term = terminals.find(t => t.id === tabId);
        return term ? term.label : tabId;
      }
    }
  }

  function getTabBadge(tabId: string): React.ReactNode {
    switch (tabId) {
      case 'slice-errors':
        return totalSliceIssues > 0 ? <span className="bp-tab-badge error">{totalSliceIssues}</span> : null;
      case 'errors':
        return apiErrorCount > 0 ? <span className="bp-tab-badge error">{apiErrorCount}</span> : null;
      case 'validation':
        return (
          <>
            {!validationValid && <span className="bp-tab-indicator error" />}
            {validationValid && validationIssues.length === 0 && <span className="bp-tab-indicator ok" />}
            {validationValid && warnCount > 0 && <span className="bp-tab-indicator warn" />}
          </>
        );
      case 'recipes':
        return (
          <>
            {recipeRunning && <span className="bp-tab-indicator warn" />}
            {!recipeRunning && recipeConsole.length > 0 && <span className="bp-tab-indicator ok" />}
          </>
        );
      case 'boot-config':
        return (
          <>
            {bootRunning && <span className="bp-tab-indicator warn" />}
            {!bootRunning && bootConsole.length > 0 && <span className="bp-tab-indicator ok" />}
          </>
        );
      default:
        return null;
    }
  }

  function getTabHelpId(tabId: string): string | undefined {
    switch (tabId) {
      case 'errors': return 'bottom.errors';
      case 'validation': return 'bottom.validation';
      case 'log': return 'bottom.log';
      case 'local-terminal': return 'bottom.local-terminal';
      default: return undefined;
    }
  }

  function isTabCloseable(tabId: string): boolean {
    return !!terminals.find(t => t.id === tabId);
  }

  function renderTabContent(tabId: string, isActive: boolean): React.ReactNode {
    switch (tabId) {
      case 'slice-errors':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <SliceErrorsView errors={sliceErrors} bootConfigErrors={bootConfigErrors} onClearBootConfigErrors={onClearBootConfigErrors} />
          </div>
        );
      case 'errors':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
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
        );
      case 'validation':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <ValidationView issues={validationIssues} valid={validationValid} sliceState={sliceState} dirty={dirty} />
          </div>
        );
      case 'log':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <LogView />
          </div>
        );
      case 'recipes':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <RecipeConsoleView
              lines={recipeConsole}
              running={recipeRunning}
              onClear={onClearRecipeConsole}
              endRef={recipeConsoleEndRef}
            />
          </div>
        );
      case 'boot-config':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            <BootConsoleView
              lines={bootConsole}
              running={bootRunning}
              onClear={onClearBootConsole}
              endRef={bootConsoleEndRef}
            />
          </div>
        );
      case 'local-terminal':
        return (
          <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
            {containerTermActive && <ContainerTerminalView />}
          </div>
        );
      default: {
        const term = terminals.find(t => t.id === tabId);
        if (term) {
          return (
            <div style={{ display: isActive ? 'flex' : 'none', flex: 1, overflow: 'hidden' }}>
              <TerminalView sliceName={term.sliceName} nodeName={term.nodeName} managementIp={term.managementIp} />
            </div>
          );
        }
        return null;
      }
    }
  }

  // --- Collapsed view ---
  if (!expanded) {
    return (
      <div className="bottom-panel-collapsed">
        <span className="bottom-panel-collapsed-label" onClick={() => setExpanded(true)}>
          ▲ Console
          {totalSliceIssues > 0 && <span className="bottom-panel-badge error">{totalSliceIssues} slice issue{totalSliceIssues !== 1 ? 's' : ''}</span>}
          {apiErrorCount > 0 && <span className="bottom-panel-badge error">{apiErrorCount} error{apiErrorCount !== 1 ? 's' : ''}</span>}
          <span className={`bottom-panel-badge ${validationErrorCount > 0 ? 'warn' : 'ok'}`}>{validationErrorCount} validation</span>
          {warnCount > 0 && <span className="bottom-panel-badge warn">{warnCount} warning{warnCount !== 1 ? 's' : ''}</span>}
          {termCount > 0 && <span className="bottom-panel-badge">{termCount} terminal{termCount !== 1 ? 's' : ''}</span>}
          {containerTermActive && <span className="bottom-panel-badge">local</span>}
          {recipeRunning && <span className="bottom-panel-badge warn">recipe running</span>}
          {bootRunning && <span className="bottom-panel-badge warn">boot config running</span>}
        </span>
        <span className="bottom-panel-collapsed-actions">
          {statusMessage && (
            <span className="bp-status-indicator">
              <span className="bp-status-spinner" />
              <span className="bp-status-text">{statusMessage}</span>
            </span>
          )}
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

  // --- Expanded view with panes ---
  return (
    <div className="bottom-panel" style={{ height: panelHeight }}>
      <div className="bp-resize-handle" onMouseDown={handleHeightDragStart} />
      {/* Global controls row */}
      <div className="bp-global-controls">
        {statusMessage && (
          <span className="bp-status-indicator">
            <span className="bp-status-spinner" />
            <span className="bp-status-text">{statusMessage}</span>
          </span>
        )}
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
      {/* Panes row */}
      <div className="bp-panes-row" ref={panesRowRef}>
        {panes.map((pane, paneIndex) => (
          <div key={pane.id} className="bp-pane-wrapper" style={{ width: `${paneWidths[paneIndex] ?? 50}%` }}>
            {paneIndex > 0 && (
              <div className="bp-pane-divider" onMouseDown={handlePaneDividerStart} />
            )}
            <div
              className="bp-pane"
              onDragOver={(e) => handlePaneDragOver(e, pane.id)}
              onDragLeave={handlePaneDragLeave}
              onDrop={(e) => handlePaneDrop(e, pane.id)}
            >
              {/* Drop indicator overlay */}
              {dragState && dragState.targetPaneId === pane.id && dragState.dropTarget && (
                <div className={`bp-drop-indicator bp-drop-${dragState.dropTarget}`} />
              )}
              {/* Pane tab bar */}
              <div className="bottom-panel-tabs">
                {pane.tabIds.map((tabId) => {
                  const isTermTab = isTabCloseable(tabId);
                  const isLocalTerm = tabId === 'local-terminal';
                  return (
                    <button
                      key={tabId}
                      className={`bp-tab ${pane.activeTabId === tabId ? 'active' : ''} ${isLocalTerm ? 'bp-tab-container' : ''} ${dragState?.tabId === tabId ? 'dragging' : ''}`}
                      draggable
                      onDragStart={(e) => handleTabDragStart(e, tabId, pane.id)}
                      onDragEnd={handleTabDragEnd}
                      onClick={() => {
                        activateTab(tabId);
                        if (isLocalTerm) {
                          setContainerTermActive(true);
                        }
                      }}
                      data-help-id={getTabHelpId(tabId)}
                    >
                      {getTabLabel(tabId)}
                      {getTabBadge(tabId)}
                      {isTermTab && (
                        <span
                          className="bp-tab-close"
                          onClick={(e) => { e.stopPropagation(); onCloseTerminal(tabId); }}
                        >
                          ✕
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {/* Pane content area */}
              <div className="bottom-panel-content">
                {pane.tabIds.map((tabId) => (
                  <React.Fragment key={tabId}>
                    {renderTabContent(tabId, pane.activeTabId === tabId)}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Recipe Console View ---
function RecipeConsoleView({ lines, running, onClear, endRef }: { lines: RecipeConsoleLine[]; running: boolean; onClear: () => void; endRef: React.RefObject<HTMLDivElement> }) {
  if (lines.length === 0) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-empty">No recipe output. Apply a recipe from the Libraries panel to see execution output here.</div>
      </div>
    );
  }

  return (
    <div className="bp-recipe-console">
      <div className="bp-recipe-header">
        <span>{running ? 'Recipe running...' : 'Recipe complete'}</span>
        {!running && (
          <button className="bp-errors-clear" onClick={onClear}>Clear</button>
        )}
        {running && <span className="bp-recipe-pulse" />}
      </div>
      <div className="bp-recipe-body">
        {lines.map((line, i) => (
          <div key={i} className={`bp-recipe-line bp-recipe-${line.type}`}>
            {line.type === 'step'   && <span className="bp-recipe-icon">{'\u25B6'}</span>}
            {line.type === 'output' && <span className="bp-recipe-icon">{' '}</span>}
            {line.type === 'error'  && <span className="bp-recipe-icon">{'\u2716'}</span>}
            <span>{line.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}

// --- Boot Config Console View ---
function BootConsoleView({ lines, running, onClear, endRef }: { lines: BootConsoleLine[]; running: boolean; onClear: () => void; endRef: React.RefObject<HTMLDivElement> }) {
  if (lines.length === 0) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-empty">No boot config output. Run boot config from the Editor panel to see execution output here.</div>
      </div>
    );
  }

  return (
    <div className="bp-recipe-console">
      <div className="bp-recipe-header">
        <span>{running ? 'Boot config running...' : 'Boot config complete'}</span>
        {!running && (
          <button className="bp-errors-clear" onClick={onClear}>Clear</button>
        )}
        {running && <span className="bp-recipe-pulse" />}
      </div>
      <div className="bp-recipe-body">
        {lines.map((line, i) => (
          <div key={i} className={`bp-recipe-line bp-recipe-${line.type}`}>
            {line.type === 'node'   && <span className="bp-recipe-icon">{'\u25A0'}</span>}
            {line.type === 'step'   && <span className="bp-recipe-icon">{'\u25B6'}</span>}
            {line.type === 'output' && <span className="bp-recipe-icon">{' '}</span>}
            {line.type === 'error'  && <span className="bp-recipe-icon">{'\u2716'}</span>}
            <span>{line.message}</span>
          </div>
        ))}
        <div ref={endRef} />
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

function SliceErrorsView({ errors, bootConfigErrors, onClearBootConfigErrors }: { errors: SliceErrorMessage[]; bootConfigErrors: BootConfigError[]; onClearBootConfigErrors?: () => void }) {
  const hasSliceErrors = errors && errors.length > 0;
  const hasBootErrors = bootConfigErrors && bootConfigErrors.length > 0;

  if (!hasSliceErrors && !hasBootErrors) {
    return (
      <div className="bp-validation-container">
        <div className="bp-validation-ok">No slice errors.</div>
      </div>
    );
  }

  const seen = new Set<string>();
  const diagnosed: Array<{ sliver: string; diagnosis: ErrorDiagnosis; raw: string }> = [];
  if (hasSliceErrors) {
    for (const err of errors) {
      const key = err.message;
      if (seen.has(key)) continue;
      seen.add(key);
      diagnosed.push({ sliver: err.sliver, diagnosis: diagnoseError(err.message), raw: err.message });
    }
  }

  return (
    <div className="bp-validation-container">
      {diagnosed.length > 0 && (
        <>
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
        </>
      )}
      {hasBootErrors && (
        <>
          <div className="bp-validation-header error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Boot Config — {bootConfigErrors.length} error{bootConfigErrors.length !== 1 ? 's' : ''}</span>
            {onClearBootConfigErrors && (
              <button className="bp-errors-clear" onClick={onClearBootConfigErrors}>Clear</button>
            )}
          </div>
          {bootConfigErrors.map((e, i) => (
            <div key={i} className="bp-slice-error-entry">
              <div className="bp-slice-error-category">
                {e.type === 'network' ? 'Network Config' : e.type === 'upload' ? 'File Upload' : 'Command'}
                <span className="bp-slice-error-sliver"> — {e.node}</span>
              </div>
              <div className="bp-slice-error-summary">{e.detail}</div>
            </div>
          ))}
        </>
      )}
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

    const wsUrl = buildWsUrl(`/ws/terminal/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}`);
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

    const wsUrl = buildWsUrl('/ws/terminal/container');
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
