'use client';
import React, { useState, useCallback, useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Toolbar from './components/Toolbar';
import CytoscapeGraph from './components/CytoscapeGraph';
import type { ContextMenuAction } from './components/CytoscapeGraph';
import SliverView from './components/SliverView';
import AllSliversView from './components/AllSliversView';
import EditorPanel from './components/EditorPanel';
import LibrariesPanel from './components/LibrariesPanel';
import MonitoringView from './components/MonitoringView';
import LibrariesView from './components/LibrariesView';
import DetailPanel from './components/DetailPanel';
import GeoView from './components/GeoView';
import BottomPanel from './components/BottomPanel';
import type { TerminalTab, RecipeConsoleLine, BootConsoleLine } from './components/BottomPanel';
import ConfigureView from './components/ConfigureView';
import FileTransferView from './components/FileTransferView';
import HelpView from './components/HelpView';
import ClientView from './components/ClientView';
import AICompanionView from './components/AICompanionView';
import type { ClientTarget } from './components/ClientView';
import HelpContextMenu from './components/HelpContextMenu';
import GuidedTour from './components/GuidedTour';
import { tours } from './data/tourSteps';
import * as api from './api/client';
import type { SliceSummary, SliceData, SiteInfo, LinkInfo, ComponentModel, SiteMetrics, LinkMetrics, ValidationIssue, ProjectInfo, VMTemplateSummary, BootConfig, RecipeSummary } from './types/fabric';

export default function App() {
  const [slices, setSlices] = useState<SliceSummary[]>([]);
  const [selectedSliceName, setSelectedSliceName] = useState('');
  const [sliceData, setSliceData] = useState<SliceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [bootConfigErrors, setBootConfigErrors] = useState<Array<{ node: string; type: string; id: string; detail: string }>>([]);
  // Per-node activity status shown in Slivers view (key=nodeName, value=status message or empty for ready)
  const [nodeActivity, setNodeActivity] = useState<Record<string, string>>({});
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recipeConsole, setRecipeConsole] = useState<RecipeConsoleLine[]>([]);
  const [recipeRunning, setRecipeRunning] = useState(false);
  const [executingRecipeName, setExecutingRecipeName] = useState<string | null>(null);
  const [sliceBootLogs, setSliceBootLogs] = useState<Record<string, BootConsoleLine[]>>({});
  const [sliceBootRunning, setSliceBootRunning] = useState<Record<string, boolean>>({});
  const [sliceBootNodeStatus, setSliceBootNodeStatus] = useState<Record<string, Record<string, 'pending' | 'running' | 'done' | 'error'>>>({});
  const [currentView, setCurrentView] = useState<'topology' | 'sliver' | 'map' | 'files' | 'libraries' | 'monitoring' | 'client' | 'ai'>('topology');
  const [clientTarget, setClientTarget] = useState<ClientTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [layout, setLayout] = useState('dagre');
  const [selectedElement, setSelectedElement] = useState<Record<string, string> | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  // --- Draggable panel layout ---
  type PanelId = 'editor' | 'template' | 'detail';
  type PanelLayoutEntry = { side: 'left' | 'right'; collapsed: boolean; width: number; order: number };
  type PanelLayoutMap = Record<PanelId, PanelLayoutEntry>;

  const PANEL_ICONS: Record<PanelId, string> = { editor: '\u270E', template: '\u29C9', detail: '\u2139' };
  const PANEL_LABELS: Record<PanelId, string> = { editor: 'Editor', template: 'Libraries', detail: 'Details' };
  const PANEL_IDS: PanelId[] = ['editor', 'template', 'detail'];
  const DEFAULT_PANEL_WIDTH = 280;
  const MIN_PANEL_WIDTH = 180;

  const defaultLayout: PanelLayoutMap = {
    editor: { side: 'left', collapsed: false, width: DEFAULT_PANEL_WIDTH, order: 0 },
    detail: { side: 'left', collapsed: true, width: DEFAULT_PANEL_WIDTH, order: 1 },
    template: { side: 'right', collapsed: false, width: DEFAULT_PANEL_WIDTH, order: 0 },
  };

  const [panelLayout, setPanelLayout] = useState<PanelLayoutMap>(() => {
    try {
      const saved = localStorage.getItem('fabric-panel-layout');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate old format (no width field)
        for (const id of PANEL_IDS) {
          if (parsed[id] && parsed[id].width === undefined) {
            parsed[id].width = DEFAULT_PANEL_WIDTH;
          }
        }
        // Migrate: remove vm-template panel (merged into template)
        delete parsed['vm-template'];
        // Migrate: add order field if missing
        for (const id of PANEL_IDS) {
          if (parsed[id] && parsed[id].order === undefined) {
            parsed[id].order = defaultLayout[id].order;
          }
        }
        // Migrate: move detail panel to left side (v2 layout)
        if (!parsed._layoutV2) {
          parsed.detail = { ...defaultLayout.detail };
          parsed.template = { ...defaultLayout.template };
          parsed._layoutV2 = true;
        }
        // Migrate: remove old project panel
        delete parsed.project;
        return parsed;
      }
    } catch {}
    return defaultLayout;
  });

  const [draggingPanel, setDraggingPanel] = useState<PanelId | null>(null);

  // Resize state
  const resizeRef = useRef<{ panelId: PanelId; startX: number; startWidth: number; growRight: boolean } | null>(null);
  // Keep a ref to the latest panelLayout so the resize mousedown handler never reads stale state
  const panelLayoutRef = useRef(panelLayout);
  panelLayoutRef.current = panelLayout;

  useEffect(() => {
    localStorage.setItem('fabric-panel-layout', JSON.stringify(panelLayout));
  }, [panelLayout]);

  const toggleCollapse = useCallback((id: PanelId) => {
    setPanelLayout(prev => ({ ...prev, [id]: { ...prev[id], collapsed: !prev[id].collapsed } }));
  }, []);

  const movePanel = useCallback((id: PanelId, side: 'left' | 'right') => {
    setPanelLayout(prev => {
      // Place the moved panel at the end of the target side
      const maxOrder = Math.max(-1, ...PANEL_IDS.filter(p => p !== id && prev[p].side === side).map(p => prev[p].order));
      return { ...prev, [id]: { ...prev[id], side, collapsed: false, order: maxOrder + 1 } };
    });
  }, []);

  /** Move a panel to a specific position (before `beforeId`) on a side. */
  const movePanelToPosition = useCallback((id: PanelId, side: 'left' | 'right', beforeId: PanelId | null) => {
    setPanelLayout(prev => {
      const next = { ...prev };
      // Get panels on the target side sorted by order, excluding the dragged panel
      const sidePanels = PANEL_IDS
        .filter(p => p !== id && next[p].side === side)
        .sort((a, b) => next[a].order - next[b].order);

      // Insert the dragged panel at the right position
      const insertIdx = beforeId ? sidePanels.indexOf(beforeId) : sidePanels.length;
      const finalIdx = insertIdx === -1 ? sidePanels.length : insertIdx;
      sidePanels.splice(finalIdx, 0, id);

      // Reassign orders
      sidePanels.forEach((p, i) => {
        next[p] = { ...next[p], side, order: i, collapsed: p === id ? false : next[p].collapsed };
      });

      return next;
    });
  }, []);

  // Stable callback — reads width from ref, so no stale closure issues
  const startResize = useCallback((panelId: PanelId, growRight: boolean, e: React.MouseEvent) => {
    e.preventDefault();
    const currentWidth = panelLayoutRef.current[panelId].width;
    resizeRef.current = { panelId, startX: e.clientX, startWidth: currentWidth, growRight };
    const handle = e.currentTarget as HTMLElement;
    handle.classList.add('active');

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const { panelId: pid, startX, startWidth, growRight: gr } = resizeRef.current;
      const delta = gr ? ev.clientX - startX : startX - ev.clientX;
      const newWidth = Math.max(MIN_PANEL_WIDTH, startWidth + delta);
      setPanelLayout(prev => ({ ...prev, [pid]: { ...prev[pid], width: newWidth } }));
    };
    const onMouseUp = () => {
      resizeRef.current = null;
      handle.classList.remove('active');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []); // stable — no deps needed
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [terminalIdCounter, setTerminalIdCounter] = useState(0);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [validationValid, setValidationValid] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpSection, setHelpSection] = useState<string | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(() => localStorage.getItem('auto-refresh') !== 'off');
  const autoRefreshRef = useRef(autoRefresh);
  autoRefreshRef.current = autoRefresh;
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [consoleFullWidth, setConsoleFullWidth] = useState(true);
  const [consoleExpanded, setConsoleExpanded] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(260);
  const [dropIndicator, setDropIndicator] = useState<{ panelId: PanelId; edge: 'left' | 'right' } | null>(null);

  // --- Global cache: infrastructure ---
  const [infraSites, setInfraSites] = useState<SiteInfo[]>([]);
  const [infraLinks, setInfraLinks] = useState<LinkInfo[]>([]);
  const [infraLoading, setInfraLoading] = useState(false);

  // --- Global cache: static data (fetched once on mount) ---
  const [images, setImages] = useState<string[]>([]);
  const [componentModels, setComponentModels] = useState<ComponentModel[]>([]);
  const [vmTemplates, setVmTemplates] = useState<VMTemplateSummary[]>([]);

  // --- Guided tour (multi-tour) ---
  const [activeTourId, setActiveTourId] = useState<string | null>(null);
  const [tourStep, setTourStep] = useState(0);
  const [tourDismissed] = useState(() => localStorage.getItem('fabric-tour-dismissed') === 'true');

  // --- Global cache: metrics ---
  const [siteMetricsCache, setSiteMetricsCache] = useState<Record<string, SiteMetrics>>({});
  const [linkMetricsCache, setLinkMetricsCache] = useState<Record<string, LinkMetrics>>({});
  const [metricsRefreshRate, setMetricsRefreshRate] = useState(0); // 0 = manual
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Fetch static data once on mount (images + component models + VM templates)
  useEffect(() => {
    api.listImages().then(setImages).catch(() => {});
    api.listComponentModels().then(setComponentModels).catch(() => {});
    api.listVmTemplates().then(setVmTemplates).catch(() => {});
  }, []);

  const refreshVmTemplates = useCallback(() => {
    api.listVmTemplates().then(setVmTemplates).catch(() => {});
  }, []);

  // Fetch recipes on mount
  useEffect(() => {
    api.listRecipes().then(setRecipes).catch(() => {});
  }, []);

  // Recipe execution handler (streams SSE to bottom panel console)
  const handleExecuteRecipe = useCallback(async (recipeDirName: string, nodeName: string) => {
    if (!selectedSliceName) return;
    setRecipeRunning(true);
    setExecutingRecipeName(recipeDirName);
    setRecipeConsole([{ type: 'step', message: `Starting recipe "${recipeDirName}" on ${nodeName}...` }]);
    try {
      await api.executeRecipeStream(recipeDirName, selectedSliceName, nodeName, (evt) => {
        if (evt.event === 'done') {
          setRecipeConsole(prev => [...prev, {
            type: evt.status === 'ok' ? 'step' : 'error',
            message: `Done — ${evt.status}`
          }]);
          setRecipeRunning(false);
          setExecutingRecipeName(null);
        } else {
          setRecipeConsole(prev => [...prev, { type: evt.event, message: evt.message || '' }]);
        }
      });
    } catch (e: any) {
      setRecipeConsole(prev => [...prev, { type: 'error', message: e.message }]);
      setRecipeRunning(false);
      setExecutingRecipeName(null);
    }
  }, [selectedSliceName]);

  // Boot config streaming handler — per-slice, supports concurrent runs across multiple slices
  const handleRunBootConfigStream = useCallback(async (sliceNameOverride?: string) => {
    const target = sliceNameOverride || selectedSliceName;
    console.log(`[bootConfigStream] called with override=${sliceNameOverride} selected=${selectedSliceName} target=${target}`);
    if (!target) return;

    setSliceBootRunning(prev => ({ ...prev, [target]: true }));
    setSliceBootLogs(prev => ({
      ...prev,
      [target]: [{ type: 'step', message: `Starting boot config for slice "${target}" (waiting for SSH)...` }],
    }));

    const appendLine = (line: BootConsoleLine) => {
      setSliceBootLogs(prev => ({
        ...prev,
        [target]: [...(prev[target] || []), line],
      }));
    };

    try {
      await api.executeBootConfigStream(target, (evt) => {
        if (evt.event === 'done') {
          appendLine({ type: evt.status === 'ok' ? 'step' : 'error', message: evt.message || `Done — ${evt.status}` });
          setSliceBootRunning(prev => ({ ...prev, [target]: false }));
          setSliceBootNodeStatus(prev => {
            const nodeStatus = { ...(prev[target] || {}) };
            for (const k of Object.keys(nodeStatus)) {
              if (nodeStatus[k] === 'running' || nodeStatus[k] === 'pending') nodeStatus[k] = 'done';
            }
            return { ...prev, [target]: nodeStatus };
          });
        } else if (evt.event === 'node' && evt.node) {
          if (evt.status === 'ok') {
            setSliceBootNodeStatus(prev => ({ ...prev, [target]: { ...(prev[target] || {}), [evt.node!]: 'done' } }));
          } else {
            setSliceBootNodeStatus(prev => ({ ...prev, [target]: { ...(prev[target] || {}), [evt.node!]: 'running' } }));
          }
          appendLine({ type: evt.event, message: evt.message || '' });
        } else if (evt.event === 'error' && evt.node) {
          setSliceBootNodeStatus(prev => ({ ...prev, [target]: { ...(prev[target] || {}), [evt.node!]: 'error' } }));
          appendLine({ type: evt.event, message: evt.message || '' });
        } else {
          appendLine({ type: evt.event, message: evt.message || '' });
        }
      });
    } catch (e: any) {
      appendLine({ type: 'error', message: e.message });
      setSliceBootRunning(prev => ({ ...prev, [target]: false }));
    }
  }, [selectedSliceName]);

  // Check config status on mount
  useEffect(() => {
    api.getConfig().then((cfg) => {
      setIsConfigured(cfg.configured);
      // Set project ID from config as initial value
      if (cfg.project_id) {
        setProjectId(cfg.project_id);
        // Use JWT projects as initial fallback until Core API responds
        if (cfg.token_info?.projects) {
          setProjects(cfg.token_info.projects);
          const proj = cfg.token_info.projects.find((p) => p.uuid === cfg.project_id);
          if (proj) setProjectName(proj.name);
        }
      }
      // Check if token is valid and not expired
      const tokenExpired = cfg.token_info?.exp
        ? cfg.token_info.exp * 1000 < Date.now()
        : !cfg.has_token;
      if (!cfg.configured || tokenExpired) {
        setSettingsOpen(true);
        if (tokenExpired && cfg.has_token) {
          setErrors(prev => [...prev, 'Your FABRIC token has expired. Please update it in Settings.']);
        }
      } else {
        // Token is good — auto-load slices and resources
        refreshSliceList();
        refreshInfrastructureAndMark();
        // Fetch full project list from Core API (replaces JWT subset)
        api.listUserProjects().then((resp) => {
          setProjects(resp.projects);
          if (resp.active_project_id) {
            setProjectId(resp.active_project_id);
            const proj = resp.projects.find((p) => p.uuid === resp.active_project_id);
            if (proj) setProjectName(proj.name);
          }
          // Reconcile all known slices with their projects in the background,
          // then refresh the slice list so filtering is accurate
          api.reconcileProjects().then(() => {
            refreshSliceList();
          }).catch(() => {});
        }).catch(() => {
          // Core API unavailable — keep JWT projects as fallback
        });
      }
    }).catch(() => {
      setIsConfigured(false);
      setSettingsOpen(true);
    });

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('configLogin') === 'success') {
      setSettingsOpen(true);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Auto-start guided tour on first visit
  useEffect(() => {
    if (isConfigured !== null && !tourDismissed) {
      setActiveTourId('getting-started');
    }
  }, [isConfigured, tourDismissed]);

  const activeTourSteps = activeTourId ? (tours[activeTourId]?.steps ?? []) : [];

  const dismissTour = useCallback(() => {
    // Only set localStorage dismiss for getting-started tour
    if (activeTourId === 'getting-started') {
      localStorage.setItem('fabric-tour-dismissed', 'true');
    }
    setActiveTourId(null);
    setTourStep(0);
  }, [activeTourId]);

  const closeTour = useCallback(() => {
    setActiveTourId(null);
    setTourStep(0);
  }, []);

  const startTour = useCallback((tourId: string) => {
    if (tourId === 'getting-started') {
      localStorage.removeItem('fabric-tour-dismissed');
    }
    setTourStep(0);
    setActiveTourId(tourId);
    setHelpOpen(false);
    setSettingsOpen(false);
  }, []);

  // --- Refresh infrastructure (sites + links) + metrics ---
  const refreshInfrastructure = useCallback(async () => {
    setInfraLoading(true);
    setStatusMessage('Loading sites and links...');
    const IGNORED = new Set(['AWS', 'AZURE', 'GCP', 'OCI', 'AL2S']);
    try {
      const [allSites, links] = await Promise.all([api.listSites(), api.listLinks()]);
      const filteredSites = allSites.filter((s) => !IGNORED.has(s.name) && s.lat !== 0 && s.lon !== 0);
      setInfraSites(filteredSites);
      setInfraLinks(links);

      setStatusMessage('Loading metrics...');
      // Refresh all site metrics in parallel
      await Promise.allSettled(filteredSites.map((s) => api.getSiteMetrics(s.name)))
        .then((results) => {
          const cache: Record<string, SiteMetrics> = {};
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              cache[filteredSites[i].name] = r.value;
            }
          });
          setSiteMetricsCache((prev) => ({ ...prev, ...cache }));
        });

      // Refresh all link metrics in parallel
      await Promise.allSettled(links.map((l) => api.getLinkMetrics(l.site_a, l.site_b)))
        .then((results) => {
          const cache: Record<string, any> = {};
          results.forEach((r, i) => {
            if (r.status === 'fulfilled') {
              const key = `${links[i].site_a}-${links[i].site_b}`;
              cache[key] = r.value;
            }
          });
          setLinkMetricsCache((prev) => ({ ...prev, ...cache }));
        });
    } catch (e: any) {
      addError(e.message);
    } finally {
      setInfraLoading(false);
      setStatusMessage('');
    }
  }, []);

  // --- Refresh metrics for currently selected element ---
  const refreshMetrics = useCallback(async () => {
    if (!selectedElement) return;
    const type = selectedElement.element_type;
    if (type === 'site') {
      const siteName = selectedElement.name;
      setMetricsLoading(true);
      setStatusMessage(`Refreshing metrics for ${siteName}...`);
      try {
        const m = await api.getSiteMetrics(siteName);
        setSiteMetricsCache((prev) => ({ ...prev, [siteName]: m }));
      } catch (e: any) {
        addError(e.message);
      } finally {
        setMetricsLoading(false);
        setStatusMessage('');
      }
    } else if (type === 'infra_link') {
      const key = `${selectedElement.site_a}-${selectedElement.site_b}`;
      setMetricsLoading(true);
      setStatusMessage('Refreshing link metrics...');
      try {
        const m = await api.getLinkMetrics(selectedElement.site_a, selectedElement.site_b);
        setLinkMetricsCache((prev) => ({ ...prev, [key]: m }));
      } catch (e: any) {
        addError(e.message);
      } finally {
        setMetricsLoading(false);
        setStatusMessage('');
      }
    }
  }, [selectedElement]);

  // Infrastructure loaded flag (no auto-fetch on startup)
  const [infraLoaded, setInfraLoaded] = useState(false);
  const refreshInfrastructureAndMark = useCallback(async () => {
    await refreshInfrastructure();
    setInfraLoaded(true);
  }, [refreshInfrastructure]);

  // --- Auto-refresh interval for metrics ---
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (metricsRefreshRate > 0 && selectedElement) {
      const type = selectedElement.element_type;
      if (type === 'site' || type === 'infra_link') {
        intervalRef.current = setInterval(refreshMetrics, metricsRefreshRate * 1000);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [metricsRefreshRate, selectedElement, refreshMetrics]);

  // Validate slice whenever sliceData changes
  const runValidation = useCallback(async (name: string) => {
    try {
      const result = await api.validateSlice(name);
      setValidationIssues(result.issues);
      setValidationValid(result.valid);
    } catch {
      // If validation fails, assume invalid
      setValidationIssues([]);
      setValidationValid(false);
    }
  }, []);

  // Helper: after receiving a fresh slice list from FABRIC, update sliceData.state
  // if the current slice's state in the list differs. Ensures the toolbar badge
  // stays current even when only the list is refreshed (not the full slice).
  const syncStateFromList = useCallback((list: SliceSummary[]) => {
    setSliceData(prev => {
      if (!prev?.name) return prev;
      const entry = list.find(s => s.name === prev.name);
      if (!entry || !entry.state || entry.state === prev.state) return prev;
      return { ...prev, state: entry.state };
    });
  }, []);

  // --- Auto-refresh polling — refreshes list until all slices are stable/terminal ---
  const POLL_STATES = new Set(['Configuring', 'Ticketed', 'Nascent', 'ModifyOK', 'ModifyError']);
  const STABLE_STATES = new Set(['StableOK', 'Active']);
  const TERMINAL_STATES_SET = new Set(['Dead', 'Closing', 'StableError']);
  const POLL_INTERVAL = 15000; // 15 seconds

  // Track which slices have already had boot configs auto-executed
  const bootConfigRanRef = useRef<Set<string>>(new Set());

  // Track which slices the user has flagged for auto-enable monitoring after submit
  const monitoringPendingRef = useRef<Set<string>>(new Set());
  const [monitoringEnabledSlices, setMonitoringEnabledSlices] = useState<Set<string>>(new Set());

  const setMonitoringEnabled = useCallback((sliceName: string, enabled: boolean) => {
    setMonitoringEnabledSlices(prev => {
      const next = new Set(prev);
      if (enabled) {
        next.add(sliceName);
        monitoringPendingRef.current.add(sliceName);
      } else {
        next.delete(sliceName);
        monitoringPendingRef.current.delete(sliceName);
      }
      return next;
    });
  }, []);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const selectedSliceRef = useRef(selectedSliceName);
  selectedSliceRef.current = selectedSliceName;

  const projectNameRef = useRef(projectName);
  projectNameRef.current = projectName;

  // Helper to add errors with project/slice context prefix
  const addError = useCallback((msg: string, sliceName?: string) => {
    const parts: string[] = [];
    if (projectNameRef.current) parts.push(projectNameRef.current);
    if (sliceName || selectedSliceRef.current) parts.push(sliceName || selectedSliceRef.current);
    const prefix = parts.length > 0 ? `[${parts.join(' / ')}] ` : '';
    setErrors(prev => [...prev, prefix + msg]);
  }, []);

  // Run boot configs per-node with activity tracking
  const runBootConfigsPerNode = useCallback(async (sliceName: string, nodeNames: string[]) => {
    if (nodeNames.length === 0) return;
    setNodeActivity(prev => {
      const next = { ...prev };
      for (const n of nodeNames) next[n] = 'Boot config pending...';
      return next;
    });
    const bootErrors: Array<{ node: string; type: string; id: string; detail: string }> = [];
    for (const nodeName of nodeNames) {
      setNodeActivity(prev => ({ ...prev, [nodeName]: 'Running boot config...' }));
      try {
        const results = await api.executeBootConfig(sliceName, nodeName);
        let hasError = false;
        for (const r of results) {
          if (r.status === 'error') {
            hasError = true;
            bootErrors.push({ node: nodeName, type: r.type, id: r.id, detail: r.detail || 'Unknown error' });
          }
        }
        setNodeActivity(prev => ({ ...prev, [nodeName]: hasError ? 'Boot config failed' : '' }));
      } catch (e: any) {
        setNodeActivity(prev => ({ ...prev, [nodeName]: 'Boot config failed' }));
        bootErrors.push({ node: nodeName, type: 'general', id: '', detail: e.message });
      }
    }
    if (bootErrors.length > 0) {
      setBootConfigErrors(bootErrors);
    }
    // Clear error statuses after a delay
    setTimeout(() => setNodeActivity(prev => {
      const next = { ...prev };
      for (const n of nodeNames) { if (next[n] === 'Boot config failed') delete next[n]; }
      return next;
    }), 8000);
    return bootErrors;
  }, []);

  // Enable monitoring per-node with activity tracking
  const enableMonitoringPerNode = useCallback(async (sliceName: string, nodeNames: string[]) => {
    if (nodeNames.length === 0) return;
    setNodeActivity(prev => {
      const next = { ...prev };
      for (const n of nodeNames) next[n] = next[n] || 'Monitoring pending...';
      return next;
    });
    for (const nodeName of nodeNames) {
      setNodeActivity(prev => ({ ...prev, [nodeName]: 'Installing node_exporter...' }));
      try {
        await api.enableNodeMonitoring(sliceName, nodeName);
        setNodeActivity(prev => ({ ...prev, [nodeName]: '' }));
      } catch (e: any) {
        setNodeActivity(prev => ({ ...prev, [nodeName]: 'Monitoring failed' }));
        addError(`Monitoring enable failed for ${nodeName}: ${e.message}`, sliceName);
      }
    }
    // Clear error statuses after a delay
    setTimeout(() => setNodeActivity(prev => {
      const next = { ...prev };
      for (const n of nodeNames) { if (next[n] === 'Monitoring failed') delete next[n]; }
      return next;
    }), 8000);
  }, [addError]);

  const startPolling = useCallback(() => {
    console.log(`[startPolling] called, autoRefresh=${autoRefreshRef.current}`);
    stopPolling();
    if (!autoRefreshRef.current) return;

    pollingRef.current = setInterval(async () => {
      if (!autoRefreshRef.current) { stopPolling(); return; }

      try {
        // Refresh slice list
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
        syncStateFromList(list);

        // Also refresh the currently selected slice if it's in a transitional state
        const currentName = selectedSliceRef.current;
        const currentEntry = currentName ? list.find(s => s.name === currentName) : null;
        if (currentName && currentEntry && POLL_STATES.has(currentEntry.state)) {
          try {
            const data = await api.getSlice(currentName);
            setSliceData(data);
          } catch { /* next poll will retry */ }
        }

        // Auto-run boot configs for slices that just reached StableOK
        // Runs for any slice the webui sees transition to stable for the first time
        for (const entry of list) {
          console.log(`[poll] Slice "${entry.name}" state=${entry.state} bootConfigRan=${bootConfigRanRef.current.has(entry.name)}`);
          if ((entry.state === 'StableOK' || entry.state === 'Active') && !bootConfigRanRef.current.has(entry.name)) {
            console.log(`[poll] Auto-running boot config for "${entry.name}"`);
            bootConfigRanRef.current.add(entry.name);
            // Refresh slice data if it's the currently selected slice
            if (entry.name === currentName) {
              try {
                const data = await api.getSlice(currentName);
                setSliceData(data);
              } catch { /* ignore */ }
            }
            // Fire and forget — each slice configures independently in parallel
            const sliceName = entry.name;
            (async () => {
              // Get node names for per-node progress tracking
              let sliceNodeNames: string[] = [];
              try {
                const sd = await api.getSlice(sliceName);
                sliceNodeNames = sd.nodes.map((n: any) => n.name);
                if (sliceName === currentName) setSliceData(sd);
              } catch { /* fallback */ }

              // Run FABlib's native post_boot_config (assigns IPs/hostnames)
              try {
                await api.runPostBootConfig(sliceName);
              } catch (e: any) {
                addError(`FABlib post_boot_config failed for ${sliceName}: ${e.message}`);
              }

              // Run boot configs via streaming endpoint (includes deploy.sh + SSH readiness)
              await handleRunBootConfigStream(sliceName);

              // Auto-enable monitoring if user flagged it pre-submit
              if (monitoringPendingRef.current.has(sliceName)) {
                monitoringPendingRef.current.delete(sliceName);
                setMonitoringEnabledSlices(prev => { const next = new Set(prev); next.delete(sliceName); return next; });
                if (sliceNodeNames.length > 0) {
                  await enableMonitoringPerNode(sliceName, sliceNodeNames);
                } else {
                  try {
                    await api.enableMonitoring(sliceName);
                  } catch (e: any) {
                    addError(`Auto-enable monitoring failed for ${sliceName}: ${e.message}`);
                  }
                }
              }
            })();
          }
        }

        // Check if ALL slices are in a stable or terminal state — if so, stop polling
        const allSettled = list.every(s => {
          const st = s.state || '';
          return st === 'Draft' || STABLE_STATES.has(st) || TERMINAL_STATES_SET.has(st);
        });
        if (allSettled) {
          console.log(`[poll] All slices settled, stopping polling`);
          stopPolling();
        }
      } catch {
        // Silently ignore polling errors — next poll will retry
      }
    }, POLL_INTERVAL);
  }, [stopPolling, syncStateFromList, handleRunBootConfigStream]);

  // Clean up polling on unmount
  useEffect(() => { return () => stopPolling(); }, [stopPolling]);

  const toggleAutoRefresh = useCallback(() => {
    setAutoRefresh(prev => {
      const next = !prev;
      localStorage.setItem('auto-refresh', next ? 'on' : 'off');
      if (!next) stopPolling();
      return next;
    });
  }, [stopPolling]);

  // Load slice list on first interaction or mount
  const refreshSliceList = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setStatusMessage('Refreshing slice list...');
    try {
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);

      // Pre-seed bootConfigRanRef with already-stable slices so we only
      // auto-run boot config for slices that *newly* transition to stable
      for (const s of list) {
        if (STABLE_STATES.has(s.state) || TERMINAL_STATES_SET.has(s.state)) {
          bootConfigRanRef.current.add(s.name);
        }
      }

      // If the currently selected slice changed state, reload it
      const currentName = selectedSliceRef.current;
      if (currentName) {
        const entry = list.find(s => s.name === currentName);
        if (entry) {
          syncStateFromList(list);
          // Reload slice data if it's not yet stable/terminal (state may have changed)
          if (POLL_STATES.has(entry.state)) {
            try {
              const data = await api.getSlice(currentName);
              setSliceData(data);
            } catch { /* ignore */ }
          }
        }
      } else {
        syncStateFromList(list);
      }

      // Start polling if any slices are in transitional states
      const hasTransitional = list.some(s => POLL_STATES.has(s.state));
      if (hasTransitional && autoRefreshRef.current) {
        startPolling();
      }
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [syncStateFromList, startPolling]);

  const handleProjectChange = useCallback(async (uuid: string) => {
    const proj = projects.find((p) => p.uuid === uuid);
    if (!proj) return;
    setStatusMessage('Switching project...');
    try {
      const result = await api.switchProject(uuid);
      setProjectId(uuid);
      setProjectName(proj.name);
      // Reset slice state and refresh
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setSlices([]);
      setListLoaded(false);
      // If token couldn't be refreshed, open CM login in a new tab so the
      // user can get a project-scoped token with a refresh_token
      if (!result.token_refreshed && result.login_url) {
        window.open(result.login_url, '_blank');
        setErrors(prev => [...prev,
          'Your token needs to be updated for the new project. ' +
          'A login page has opened — copy the token and paste it in Settings.'
        ]);
        setSettingsOpen(true);
      }
      // Auto-load slices for the new project
      await refreshSliceList();
    } catch (e: any) {
      addError(e.message);
    } finally {
      setStatusMessage('');
    }
  }, [projects, refreshSliceList]);

  // No auto-load — user must click "Load Slices" first

  // When sliceData updates, push its state into the matching slices list entry
  // so the dropdown stays in sync with the loaded slice's current state.
  useEffect(() => {
    if (!sliceData?.name || !sliceData.state) return;
    const name = sliceData.name;
    const state = sliceData.state;
    const hasErrors = (sliceData.error_messages?.length ?? 0) > 0;
    setSlices(prev => {
      const idx = prev.findIndex(s => s.name === name);
      if (idx === -1) return prev;
      if (prev[idx].state === state && prev[idx].has_errors === hasErrors) return prev;
      const updated = [...prev];
      updated[idx] = { ...updated[idx], state, has_errors: hasErrors };
      return updated;
    });
  }, [sliceData?.name, sliceData?.state, sliceData?.error_messages]);

  // Helper: update slice data and re-validate
  const updateSliceAndValidate = useCallback((data: SliceData) => {
    setSliceData(data);
    if (data.name) {
      runValidation(data.name);
    }
  }, [runValidation]);


  // Submit handles both new slice creation and modifications to existing slices
  const handleSubmit = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setStatusMessage('Submitting slice to FABRIC...');
    try {
      const data = await api.submitSlice(selectedSliceName);
      setSliceData(data);
      setValidationIssues([]);
      setValidationValid(true);
      setStatusMessage('Submitted. Refreshing slice state...');
      let refreshedData = data;
      try {
        // Reload slice data to get updated state from FABRIC
        const refreshed = await api.refreshSlice(selectedSliceName);
        refreshedData = refreshed;
        setSliceData(refreshed);
        runValidation(selectedSliceName);
      } catch {}
      setStatusMessage('Refreshing slice list...');
      try {
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
      } catch {}
      // If slice reached StableOK immediately, run boot configs now
      console.log(`[submit] refreshedData.state=${refreshedData.state}`);
      if (refreshedData.state === 'StableOK') {
        console.log(`[submit] StableOK immediate — running post-boot config`);
        bootConfigRanRef.current.add(selectedSliceName);
        // Run FABlib's native post_boot_config (L3 networking, hostnames, IPs, routes)
        setStatusMessage('Running FABlib post-boot config...');
        try {
          await api.runPostBootConfig(selectedSliceName);
        } catch (e: any) {
          addError(`FABlib post_boot_config failed: ${e.message}`);
        }
        setStatusMessage('Running post-boot configuration (waiting for SSH)...');
        await handleRunBootConfigStream(selectedSliceName);
        // Auto-enable monitoring if user flagged it pre-submit
        if (monitoringPendingRef.current.has(selectedSliceName)) {
          monitoringPendingRef.current.delete(selectedSliceName);
          setMonitoringEnabledSlices(prev => { const next = new Set(prev); next.delete(selectedSliceName); return next; });
          setStatusMessage('Enabling monitoring...');
          const monitorNodeNames = refreshedData.nodes.map((n: any) => n.name);
          if (monitorNodeNames.length > 0) {
            await enableMonitoringPerNode(selectedSliceName, monitorNodeNames);
          } else {
            try {
              await api.enableMonitoring(selectedSliceName);
            } catch (e: any) {
              addError(`Auto-enable monitoring failed: ${e.message}`);
            }
          }
        }
      } else if (POLL_STATES.has(refreshedData.state || '')) {
        // Slice is still provisioning — start auto-refresh polling
        startPolling();
      }
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, runValidation, startPolling, handleRunBootConfigStream]);

  const handleRefreshSlices = useCallback(async () => {
    setLoading(true);
    setStatusMessage('Refreshing slices...');
    try {
      // Refresh the slice list
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);
      syncStateFromList(list);

      // Also refresh the currently loaded slice if any
      const currentName = selectedSliceRef.current;
      if (currentName) {
        try {
          const data = await api.refreshSlice(currentName);
          setSliceData(data);
          runValidation(currentName);
        } catch { /* slice may no longer exist */ }
      }
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [runValidation, syncStateFromList]);

  const handleDeleteElements = useCallback(async (elements: Record<string, string>[]) => {
    if (!sliceData || elements.length === 0) return;
    setLoading(true);
    try {
      let data: SliceData = sliceData;
      for (const el of elements) {
        if (el.element_type === 'node') {
          data = await api.removeNode(selectedSliceName, el.name);
        } else if (el.element_type === 'network') {
          data = await api.removeNetwork(selectedSliceName, el.name);
        } else if (el.element_type === 'facility-port') {
          data = await api.removeFacilityPort(selectedSliceName, el.name);
        }
      }
      updateSliceAndValidate(data);
      setSelectedElement(null);
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sliceData, selectedSliceName, updateSliceAndValidate]);

  const handleDeleteSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    const deletedName = selectedSliceName;
    const wasDraft = sliceData?.state === 'Draft';
    setLoading(true);
    setStatusMessage('Deleting slice...');
    try {
      await api.deleteSlice(deletedName);
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setValidationIssues([]);
      setValidationValid(false);
      if (wasDraft) {
        // Drafts are fully removed — take them out of the list immediately
        setSlices(prev => prev.filter(s => s.name !== deletedName));
      } else {
        // Submitted slices become "Dead" — mark locally for instant feedback
        setSlices(prev => prev.map(s => s.name === deletedName ? { ...s, state: 'Dead' } : s));
      }
      // Refresh the list to confirm the backend state
      setStatusMessage('Confirming deletion...');
      const MAX_RETRIES = 4;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const list = await api.listSlices();
          if (wasDraft) {
            setSlices(list);
            setListLoaded(true);
            if (!list.some(s => s.name === deletedName)) break;
          } else {
            // Ensure the deleted slice stays in the list as Dead until archived
            const entry = list.find(s => s.name === deletedName);
            if (!entry) {
              // Backend didn't return it yet — inject it as Dead
              list.push({ name: deletedName, id: '', state: 'Dead', has_errors: false });
            }
            setSlices(list);
            setListLoaded(true);
            const finalEntry = list.find(s => s.name === deletedName);
            if (finalEntry && (finalEntry.state === 'Dead' || finalEntry.state === 'Closing')) break;
          }
        } catch {
          // Ignore and retry
        }
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, sliceData?.state]);

  // Delete a slice by name (used by AllSliversView)
  const handleDeleteSliceByName = useCallback(async (name: string) => {
    const slice = slices.find(s => s.name === name);
    const wasDraft = slice?.state === 'Draft';
    await api.deleteSlice(name);
    // If deleting the currently-selected slice, clear selection
    if (name === selectedSliceName) {
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setValidationIssues([]);
      setValidationValid(false);
    }
    if (wasDraft) {
      setSlices(prev => prev.filter(s => s.name !== name));
    } else {
      setSlices(prev => prev.map(s => s.name === name ? { ...s, state: 'Dead' } : s));
    }
  }, [slices, selectedSliceName]);


  const handleArchiveSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setStatusMessage('Archiving slice...');
    try {
      await api.archiveSlice(selectedSliceName);
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setValidationIssues([]);
      setValidationValid(false);
      try {
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
      } catch {}
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName]);

  const handleArchiveAllTerminal = useCallback(async () => {
    setLoading(true);
    setStatusMessage('Archiving terminal slices...');
    try {
      await api.archiveAllTerminal();
      // If current slice was archived, clear it
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);
      if (selectedSliceName && !list.find(s => s.name === selectedSliceName)) {
        setSliceData(null);
        setSelectedSliceName('');
        setSelectedElement(null);
        setValidationIssues([]);
        setValidationValid(false);
      }
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName]);

  const handleNodeClick = useCallback((data: Record<string, string>) => {
    setSelectedElement(data);
  }, []);

  const handleEdgeClick = useCallback((data: Record<string, string>) => {
    setSelectedElement(data);
  }, []);

  const handleBackgroundClick = useCallback(() => {
    setSelectedElement(null);
  }, []);

  const handleCreateSlice = useCallback(async (name: string) => {
    setLoading(true);
    setErrors([]);
    setStatusMessage('Creating slice...');
    try {
      const data = await api.createSlice(name);
      setSliceData(data);
      setSelectedSliceName(name);
      setSlices((prev) => {
        if (prev.some((s) => s.name === name)) return prev;
        return [...prev, { name, id: '', state: 'Draft' }];
      });
      setCurrentView('topology');
      runValidation(name);
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [runValidation]);

  const handleOpenTerminals = useCallback((elements: Record<string, string>[]) => {
    let counter = terminalIdCounter;
    const newTabs: TerminalTab[] = [];
    for (const el of elements) {
      if (el.element_type === 'node' && el.management_ip) {
        const id = `term-${counter}`;
        counter++;
        newTabs.push({
          id,
          label: el.name,
          sliceName: selectedSliceName,
          nodeName: el.name,
          managementIp: el.management_ip,
        });
      }
    }
    if (newTabs.length > 0) {
      setTerminalIdCounter(counter);
      setTerminalTabs((prev) => [...prev, ...newTabs]);
    }
  }, [selectedSliceName, terminalIdCounter]);

  const handleDeleteComponent = useCallback(async (nodeName: string, componentName: string) => {
    if (!selectedSliceName) return;
    setLoading(true);
    try {
      const data = await api.removeComponent(selectedSliceName, nodeName, componentName);
      updateSliceAndValidate(data);
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSliceName, updateSliceAndValidate]);

  const handleDeleteFacilityPort = useCallback(async (fpName: string) => {
    if (!selectedSliceName) return;
    setLoading(true);
    try {
      const data = await api.removeFacilityPort(selectedSliceName, fpName);
      updateSliceAndValidate(data);
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSliceName, updateSliceAndValidate]);

  // --- Save-template modal state ---
  const [saveTemplateModal, setSaveTemplateModal] = useState<{ type: 'slice' | 'vm'; nodeName?: string } | null>(null);
  const [saveTemplateName, setSaveTemplateName] = useState('');
  const [saveTemplateDesc, setSaveTemplateDesc] = useState('');
  const [saveTemplateBusy, setSaveTemplateBusy] = useState(false);

  const handleSaveSliceTemplate = useCallback(() => {
    setSaveTemplateName(selectedSliceName || '');
    setSaveTemplateDesc('');
    setSaveTemplateModal({ type: 'slice' });
  }, [selectedSliceName]);

  const handleSaveVmTemplate = useCallback((nodeName: string) => {
    setSaveTemplateName('');
    setSaveTemplateDesc('');
    setSaveTemplateModal({ type: 'vm', nodeName });
  }, []);

  const handleSaveTemplateConfirm = useCallback(async () => {
    if (!saveTemplateName.trim() || !saveTemplateModal) return;
    setSaveTemplateBusy(true);
    setStatusMessage('Saving template...');
    try {
      if (saveTemplateModal.type === 'slice') {
        await api.saveTemplate({
          name: saveTemplateName.trim(),
          description: saveTemplateDesc.trim(),
          slice_name: selectedSliceName,
        });
      } else if (saveTemplateModal.type === 'vm' && saveTemplateModal.nodeName) {
        let bootConfig: BootConfig = { uploads: [], commands: [], network: [] };
        try {
          bootConfig = await api.getBootConfig(selectedSliceName, saveTemplateModal.nodeName);
        } catch { /* no boot config yet */ }
        const node = sliceData?.nodes.find((n) => n.name === saveTemplateModal.nodeName);
        await api.saveVmTemplate({
          name: saveTemplateName.trim(),
          description: saveTemplateDesc.trim(),
          image: node?.image || 'default_ubuntu_22',
          boot_config: bootConfig,
        });
        refreshVmTemplates();
      }
      setSaveTemplateModal(null);
      setSaveTemplateName('');
      setSaveTemplateDesc('');
    } catch (e: any) {
      addError(e.message);
    } finally {
      setSaveTemplateBusy(false);
      setStatusMessage('');
    }
  }, [saveTemplateModal, saveTemplateName, saveTemplateDesc, selectedSliceName, sliceData, refreshVmTemplates]);

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.type === 'terminal') {
      handleOpenTerminals(action.elements);
    } else if (action.type === 'delete') {
      handleDeleteElements(action.elements);
    } else if (action.type === 'delete-slice' && action.sliceNames) {
      (async () => {
        for (const name of action.sliceNames!) {
          try { await handleDeleteSliceByName(name); } catch (e: any) { addError(e.message); }
        }
        handleRefreshSlices();
      })();
    } else if (action.type === 'delete-component' && action.nodeName && action.componentName) {
      handleDeleteComponent(action.nodeName, action.componentName);
    } else if (action.type === 'delete-facility-port' && action.fpName) {
      handleDeleteFacilityPort(action.fpName);
    } else if (action.type === 'save-vm-template' && action.nodeName) {
      handleSaveVmTemplate(action.nodeName);
    } else if (action.type === 'apply-recipe' && action.recipeName && action.nodeName) {
      handleExecuteRecipe(action.recipeName, action.nodeName);
    } else if (action.type === 'open-client' && action.elements.length > 0) {
      const el = action.elements[0];
      setClientTarget({ sliceName: selectedSliceName, nodeName: el.name, port: action.port || 3000 });
      setCurrentView('client');
    }
  }, [handleOpenTerminals, handleDeleteElements, handleDeleteSliceByName, handleRefreshSlices, handleDeleteComponent, handleDeleteFacilityPort, handleSaveVmTemplate, handleExecuteRecipe, selectedSliceName]);

  const handleCloseTerminal = useCallback((id: string) => {
    setTerminalTabs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSliceUpdated = useCallback((data: SliceData) => {
    updateSliceAndValidate(data);
  }, [updateSliceAndValidate]);

  const handleOpenHelp = useCallback((section?: string) => {
    if (!section && helpOpen) {
      // Toggle off when clicking the help button again with no specific section
      setHelpOpen(false);
      setHelpSection(undefined);
    } else {
      setHelpSection(section);
      setHelpOpen(true);
    }
  }, [helpOpen]);

  const handleCloneSlice = useCallback(async (newName: string) => {
    if (!selectedSliceName) return;
    setLoading(true);
    setStatusMessage('Cloning slice...');
    try {
      const data = await api.cloneSlice(selectedSliceName, newName);
      setSliceData(data);
      setSelectedSliceName(data.name);
      // Refresh the full slice list from backend to include the new draft
      try {
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
      } catch {
        // Fallback: add locally if list refresh fails
        setSlices((prev) => {
          if (prev.some((s) => s.name === data.name)) return prev;
          return [...prev, { name: data.name, id: '', state: 'Draft' }];
        });
      }
      setCurrentView('topology');
      runValidation(data.name);
    } catch (e: any) {
      addError(e.message);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, runValidation]);

  const handleSliceImported = useCallback((data: SliceData) => {
    setSliceData(data);
    setSelectedSliceName(data.name);
    setSlices((prev) => {
      if (prev.some((s) => s.name === data.name)) return prev;
      return [...prev, { name: data.name, id: '', state: 'Draft' }];
    });
    runValidation(data.name);
  }, [runValidation]);

  return (
    <>
      <TitleBar
        dark={dark}
        currentView={currentView}
        onToggleDark={() => setDark((d) => !d)}
        onViewChange={setCurrentView}
        onOpenSettings={() => setSettingsOpen((prev) => !prev)}
        onOpenHelp={() => handleOpenHelp()}
        projectName={projectName}
        projects={projects}
        onProjectChange={handleProjectChange}
      />

      <Toolbar
        slices={slices}
        selectedSlice={selectedSliceName}
        sliceState={sliceData?.state ?? ''}
        dirty={sliceData?.dirty ?? false}
        sliceValid={validationValid}
        loading={loading}
        onSelectSlice={(name) => {
          setSelectedSliceName(name);
          setSliceData(null);
          setSelectedElement(null);
          setValidationIssues([]);
          setValidationValid(false);
          // Auto-load the slice data
          if (name) {
            setLoading(true);
            setStatusMessage('Loading slice...');
            api.getSlice(name).then(data => {
              setSliceData(data);
              runValidation(name);
            }).catch(e => {
              addError(e.message);
            }).finally(() => {
              setLoading(false);
              setStatusMessage('');
            });
          }
        }}
        onCreateSlice={handleCreateSlice}
        onSubmit={handleSubmit}
        onRefreshSlices={handleRefreshSlices}
        onDeleteSlice={handleDeleteSlice}
        onRefreshTopology={refreshInfrastructureAndMark}
        infraLoading={infraLoading}
        onCloneSlice={handleCloneSlice}
        listLoaded={listLoaded}
        onLoadSlices={refreshSliceList}
        infraLoaded={infraLoaded}
        statusMessage={statusMessage}
        onSaveSliceTemplate={handleSaveSliceTemplate}
        onArchiveSlice={handleArchiveSlice}
        onArchiveAllTerminal={handleArchiveAllTerminal}
        hasErrors={sliceData?.error_messages != null && sliceData.error_messages.length > 0}
        autoRefresh={autoRefresh}
        onToggleAutoRefresh={toggleAutoRefresh}
      />

      <HelpContextMenu onOpenHelp={handleOpenHelp} />

      {/* Help overlay */}
      {helpOpen && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <HelpView
            scrollToSection={helpSection}
            onClose={() => { setHelpOpen(false); setHelpSection(undefined); }}
            onStartTour={(tourId: string) => startTour(tourId)}
          />
        </div>
      )}

      {/* Settings overlay */}
      {settingsOpen && !helpOpen && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <ConfigureView
            onConfigured={() => {
              setIsConfigured(true);
              setSettingsOpen(false);
              setListLoaded(false);
              refreshInfrastructureAndMark();
              // Refresh project list from Core API (with config fallback)
              api.listUserProjects().then((resp) => {
                setProjects(resp.projects);
                if (resp.active_project_id) {
                  setProjectId(resp.active_project_id);
                  const proj = resp.projects.find((p) => p.uuid === resp.active_project_id);
                  if (proj) setProjectName(proj.name);
                }
                // Reconcile slice→project mappings in background
                api.reconcileProjects().catch(() => {});
              }).catch(() => {
                // Fallback to JWT projects
                api.getConfig().then((cfg) => {
                  if (cfg.token_info?.projects) {
                    setProjects(cfg.token_info.projects);
                  }
                  if (cfg.project_id) {
                    setProjectId(cfg.project_id);
                    const proj = cfg.token_info?.projects?.find((p) => p.uuid === cfg.project_id);
                    if (proj) setProjectName(proj.name);
                  }
                }).catch(() => {});
              });
            }}
            onClose={() => {
              setSettingsOpen(false);
              setListLoaded(false);
              refreshInfrastructureAndMark();
            }}
          />
        </div>
      )}

      <div style={{ flex: 1, display: (settingsOpen || helpOpen) ? 'none' : 'flex', overflow: 'hidden' }}>
        {currentView === 'ai' ? (
          <AICompanionView />
        ) : currentView === 'client' ? (
          <ClientView
            slices={slices}
            selectedSliceName={selectedSliceName}
            sliceData={sliceData}
            clientTarget={clientTarget}
            onTargetChange={setClientTarget}
          />
        ) : currentView === 'monitoring' ? (
          <MonitoringView sliceName={selectedSliceName || null} sliceData={sliceData} monitoringPending={monitoringEnabledSlices.has(selectedSliceName)} nodeActivity={nodeActivity} />
        ) : currentView === 'libraries' ? (
          <LibrariesView onLoadSlice={(data) => { setSliceData(data); setSelectedSliceName(data.name); refreshSliceList(); setCurrentView('topology'); }} />
        ) : currentView === 'files' ? (
          <FileTransferView
            sliceName={selectedSliceName}
            sliceData={sliceData}
          />
        ) : currentView === 'topology' || currentView === 'sliver' ? (
          (() => {
            const makeDragProps = (id: PanelId) => ({
              draggable: true,
              onDragStart: (e: React.DragEvent) => {
                e.dataTransfer.setData('text/plain', id);
                setDraggingPanel(id);
              },
              onDragEnd: () => setDraggingPanel(null),
            });

            const renderPanel = (id: PanelId) => {
              const dragProps = makeDragProps(id);
              const icon = PANEL_ICONS[id];
              switch (id) {
                case 'editor':
                  return (
                    <EditorPanel
                      key="editor"
                      sliceData={sliceData}
                      sliceName={selectedSliceName}
                      onSliceUpdated={handleSliceUpdated}
                      onCollapse={() => toggleCollapse('editor')}
                      sites={infraSites}
                      images={images}
                      componentModels={componentModels}
                      selectedElement={selectedElement}
                      dragHandleProps={dragProps}
                      panelIcon={icon}
                      vmTemplates={vmTemplates}
                      onSaveVmTemplate={handleSaveVmTemplate}
                      onBootConfigErrors={setBootConfigErrors}
                      onRunBootConfig={handleRunBootConfigStream}
                      bootRunning={!!sliceBootRunning[selectedSliceName]}
                      monitoringEnabled={monitoringEnabledSlices.has(selectedSliceName)}
                      onToggleMonitoring={(enabled) => setMonitoringEnabled(selectedSliceName, enabled)}
                    />
                  );
                case 'template':
                  return (
                    <LibrariesPanel
                      key="template"
                      onSliceImported={handleSliceImported}
                      onCollapse={() => toggleCollapse('template')}
                      dragHandleProps={dragProps}
                      panelIcon={icon}
                      onVmTemplatesChanged={refreshVmTemplates}
                      sliceName={selectedSliceName}
                      sliceData={sliceData}
                      onNodeAdded={updateSliceAndValidate}
                      onExecuteRecipe={handleExecuteRecipe}
                      executingRecipe={executingRecipeName}
                      onRecipesChanged={() => api.listRecipes().then(setRecipes).catch(() => {})}
                    />
                  );
                case 'detail':
                  return (
                    <DetailPanel
                      key="detail"
                      sliceData={sliceData}
                      selectedElement={selectedElement}
                      onCollapse={() => toggleCollapse('detail')}
                      siteMetricsCache={siteMetricsCache}
                      linkMetricsCache={linkMetricsCache}
                      metricsRefreshRate={metricsRefreshRate}
                      onMetricsRefreshRateChange={setMetricsRefreshRate}
                      onRefreshMetrics={refreshMetrics}
                      metricsLoading={metricsLoading}
                      dragHandleProps={dragProps}
                      panelIcon={icon}
                    />
                  );
              }
            };

            const sortByOrder = (ids: PanelId[]) => [...ids].sort((a, b) => panelLayout[a].order - panelLayout[b].order);
            const leftExpanded = sortByOrder(PANEL_IDS.filter(id => panelLayout[id].side === 'left' && !panelLayout[id].collapsed));
            const rightExpanded = sortByOrder(PANEL_IDS.filter(id => panelLayout[id].side === 'right' && !panelLayout[id].collapsed));
            const leftCollapsed = sortByOrder(PANEL_IDS.filter(id => panelLayout[id].side === 'left' && panelLayout[id].collapsed));
            const rightCollapsed = sortByOrder(PANEL_IDS.filter(id => panelLayout[id].side === 'right' && panelLayout[id].collapsed));

            // Helper: find which panel the cursor is over by checking child element bounds
            const findTargetPanel = (groupEl: HTMLElement, clientX: number, panels: PanelId[]): { panelId: PanelId; edge: 'left' | 'right' } | null => {
              const wrappers = groupEl.querySelectorAll<HTMLElement>('.panel-wrapper');
              for (let i = 0; i < wrappers.length; i++) {
                const rect = wrappers[i].getBoundingClientRect();
                if (clientX >= rect.left && clientX <= rect.right) {
                  const panelId = panels[i];
                  if (!panelId || panelId === draggingPanel) return null;
                  const midX = rect.left + rect.width / 2;
                  return { panelId, edge: clientX < midX ? 'left' : 'right' };
                }
              }
              return null;
            };

            const handleGroupDragOver = (e: React.DragEvent, panels: PanelId[], side: 'left' | 'right') => {
              if (!draggingPanel) return;
              e.preventDefault();
              const target = findTargetPanel(e.currentTarget as HTMLElement, e.clientX, panels);
              setDropIndicator(target);
            };

            const handleGroupDrop = (e: React.DragEvent, panels: PanelId[], side: 'left' | 'right') => {
              if (!draggingPanel) return;
              e.preventDefault();
              const target = findTargetPanel(e.currentTarget as HTMLElement, e.clientX, panels);
              if (target) {
                const targetIdx = panels.indexOf(target.panelId);
                const beforeId = target.edge === 'left' ? target.panelId : (targetIdx + 1 < panels.length ? panels[targetIdx + 1] : null);
                movePanelToPosition(draggingPanel, side, beforeId);
              }
              setDraggingPanel(null);
              setDropIndicator(null);
            };

            const renderPanelGroup = (panels: PanelId[], side: 'left' | 'right') => {
              return (
              <div
                className={`panel-group ${side}`}
                onDragOver={(e) => handleGroupDragOver(e, panels, side)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDropIndicator(null);
                  }
                }}
                onDrop={(e) => handleGroupDrop(e, panels, side)}
              >
                {/* Right-side group: edge handle on the left (facing graph) */}
                {side === 'right' && (
                  <div
                    className="panel-resize-handle"
                    onMouseDown={(e) => startResize(panels[0], false, e)}
                  />
                )}
                {panels.map((id, i) => {
                  const isDragging = draggingPanel === id;
                  const showLeftIndicator = dropIndicator?.panelId === id && dropIndicator?.edge === 'left';
                  const showRightIndicator = dropIndicator?.panelId === id && dropIndicator?.edge === 'right';
                  return (
                  <React.Fragment key={id}>
                    {i > 0 && !draggingPanel && (
                      <div
                        className="panel-resize-handle"
                        onMouseDown={(e) => startResize(
                          side === 'left' ? panels[i - 1] : panels[i],
                          side === 'left',
                          e
                        )}
                      />
                    )}
                    <div
                      className={`panel-wrapper${isDragging ? ' dragging' : ''}${showLeftIndicator ? ' drop-left' : ''}${showRightIndicator ? ' drop-right' : ''}`}
                      style={{ width: panelLayout[id].width }}
                    >
                      {renderPanel(id)}
                    </div>
                  </React.Fragment>
                  );
                })}
                {/* Left-side group: edge handle on the right (facing graph) */}
                {side === 'left' && (
                  <div
                    className="panel-resize-handle"
                    onMouseDown={(e) => startResize(panels[panels.length - 1], true, e)}
                  />
                )}
              </div>
              );
            };

            return (
              <>
                {leftExpanded.length > 0 && renderPanelGroup(leftExpanded, 'left')}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
                  {/* Collapsed panel icon tabs - left side */}
                  {leftCollapsed.map((id, i) => (
                    <button
                      key={id}
                      className="panel-icon-tab left"
                      style={{ top: 12 + i * 36 }}
                      onClick={() => toggleCollapse(id)}
                      title={`Show ${PANEL_LABELS[id]}`}
                    >
                      {PANEL_ICONS[id]}
                    </button>
                  ))}
                  {/* Collapsed panel icon tabs - right side */}
                  {rightCollapsed.map((id, i) => (
                    <button
                      key={id}
                      className="panel-icon-tab right"
                      style={{ top: 12 + i * 36 }}
                      onClick={() => toggleCollapse(id)}
                      title={`Show ${PANEL_LABELS[id]}`}
                    >
                      {PANEL_ICONS[id]}
                    </button>
                  ))}
                  {/* Drop zones when dragging */}
                  {draggingPanel && (
                    <>
                      <div
                        className="panel-drop-zone left active"
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('hover'); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('hover')}
                        onDrop={(e) => { e.preventDefault(); movePanel(draggingPanel, 'left'); setDraggingPanel(null); }}
                      />
                      <div
                        className="panel-drop-zone right active"
                        onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('hover'); }}
                        onDragLeave={(e) => e.currentTarget.classList.remove('hover')}
                        onDrop={(e) => { e.preventDefault(); movePanel(draggingPanel, 'right'); setDraggingPanel(null); }}
                      />
                    </>
                  )}
                  {currentView === 'topology' ? (
                    <CytoscapeGraph
                      graph={sliceData?.graph ?? null}
                      layout={layout}
                      dark={dark}
                      sliceData={sliceData}
                      recipes={recipes}
                      bootNodeStatus={sliceBootNodeStatus[selectedSliceName] ?? {}}
                      onLayoutChange={setLayout}
                      onNodeClick={handleNodeClick}
                      onEdgeClick={handleEdgeClick}
                      onBackgroundClick={handleBackgroundClick}
                      onContextAction={handleContextAction}
                    />
                  ) : (
                    <AllSliversView
                      slices={slices}
                      dark={dark}
                      onSliceSelect={(name) => {
                        setSelectedSliceName(name);
                        setCurrentView('topology');
                      }}
                      onDeleteSlice={handleDeleteSliceByName}
                      onRefreshSlices={handleRefreshSlices}
                      onContextAction={handleContextAction}
                      nodeActivity={nodeActivity}
                      recipes={recipes}
                    />
                  )}
                </div>
                {rightExpanded.length > 0 && renderPanelGroup(rightExpanded, 'right')}
              </>
            );
          })()
        ) : (
          <GeoView
            sliceData={sliceData}
            selectedElement={selectedElement}
            onNodeClick={handleNodeClick}
            sites={infraSites}
            links={infraLinks}
            linksLoading={infraLoading}
            siteMetricsCache={siteMetricsCache}
            linkMetricsCache={linkMetricsCache}
            metricsRefreshRate={metricsRefreshRate}
            onMetricsRefreshRateChange={setMetricsRefreshRate}
            onRefreshMetrics={refreshMetrics}
            metricsLoading={metricsLoading}
          />
        )}
      </div>

      {/* Always render BottomPanel to preserve terminal connections across view switches */}
      <div style={{ display: (settingsOpen || helpOpen || currentView === 'files') ? 'none' : undefined }}>
        <BottomPanel
          terminals={terminalTabs}
          onCloseTerminal={handleCloseTerminal}
          validationIssues={validationIssues}
          validationValid={validationValid}
          sliceState={sliceData?.state ?? ''}
          dirty={sliceData?.dirty ?? false}
          errors={errors}
          onClearErrors={() => { setErrors([]); setValidationIssues([]); setValidationValid(false); }}
          sliceErrors={sliceData?.error_messages ?? []}
          bootConfigErrors={bootConfigErrors}
          onClearBootConfigErrors={() => setBootConfigErrors([])}
          fullWidth={consoleFullWidth || (currentView !== 'topology' && currentView !== 'sliver')}
          onToggleFullWidth={() => setConsoleFullWidth(fw => !fw)}
          showWidthToggle={currentView === 'topology' || currentView === 'sliver'}
          expanded={consoleExpanded}
          onExpandedChange={setConsoleExpanded}
          panelHeight={consoleHeight}
          onPanelHeightChange={setConsoleHeight}
          statusMessage={statusMessage}
          loading={loading}
          recipeConsole={recipeConsole}
          recipeRunning={recipeRunning}
          onClearRecipeConsole={() => setRecipeConsole([])}
          sliceBootLogs={sliceBootLogs}
          sliceBootRunning={sliceBootRunning}
          onClearSliceBootLog={(sn) => setSliceBootLogs(prev => { const next = { ...prev }; delete next[sn]; return next; })}
        />
      </div>

      {/* Save Template Modal (slice or VM) */}
      {saveTemplateModal && (
        <div className="toolbar-modal-overlay" onClick={() => setSaveTemplateModal(null)}>
          <div className="toolbar-modal" onClick={(e) => e.stopPropagation()}>
            <h4>{saveTemplateModal.type === 'slice' ? 'Save Slice Template' : 'Save VM Template'}</h4>
            <p>
              {saveTemplateModal.type === 'slice'
                ? <>Save <strong>{selectedSliceName}</strong> as a reusable slice template.</>
                : <>Save node <strong>{saveTemplateModal.nodeName}</strong> config as a VM template.</>
              }
            </p>
            <input
              type="text"
              className="toolbar-modal-input"
              placeholder="Template name..."
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveTemplateConfirm()}
              autoFocus
            />
            <textarea
              className="toolbar-modal-input"
              placeholder="Description (optional)..."
              value={saveTemplateDesc}
              onChange={(e) => setSaveTemplateDesc(e.target.value)}
              rows={2}
              style={{ resize: 'vertical', marginTop: 8 }}
            />
            <div className="toolbar-modal-actions">
              <button onClick={() => setSaveTemplateModal(null)}>Cancel</button>
              <button
                className="success"
                onClick={handleSaveTemplateConfirm}
                disabled={!saveTemplateName.trim() || saveTemplateBusy}
              >
                {saveTemplateBusy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Guided Tour */}
      <GuidedTour
        active={activeTourId !== null}
        steps={activeTourSteps}
        step={tourStep}
        onStepChange={setTourStep}
        onDismiss={dismissTour}
        onClose={closeTour}
        onOpenSettings={() => setSettingsOpen(true)}
        onCloseSettings={() => setSettingsOpen(false)}
        settingsOpen={settingsOpen}
        onSwitchView={setCurrentView}
        currentView={currentView}
      />
    </>
  );
}
