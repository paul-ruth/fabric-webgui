import React, { useState, useCallback, useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Toolbar from './components/Toolbar';
import CytoscapeGraph from './components/CytoscapeGraph';
import type { ContextMenuAction } from './components/CytoscapeGraph';
import EditorPanel from './components/EditorPanel';
import TemplatePanel from './components/TemplatePanel';
import VMTemplatePanel from './components/VMTemplatePanel';
import DetailPanel from './components/DetailPanel';
import GeoView from './components/GeoView';
import BottomPanel from './components/BottomPanel';
import type { TerminalTab } from './components/BottomPanel';
import ConfigureView from './components/ConfigureView';
import FileTransferView from './components/FileTransferView';
import HelpView from './components/HelpView';
import HelpContextMenu from './components/HelpContextMenu';
import GuidedTour from './components/GuidedTour';
import { tours } from './data/tourSteps';
import * as api from './api/client';
import type { SliceSummary, SliceData, SiteInfo, LinkInfo, ComponentModel, SiteMetrics, LinkMetrics, ValidationIssue, ProjectInfo, VMTemplateSummary, BootConfig } from './types/fabric';

export default function App() {
  const [slices, setSlices] = useState<SliceSummary[]>([]);
  const [selectedSliceName, setSelectedSliceName] = useState('');
  const [sliceData, setSliceData] = useState<SliceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<'topology' | 'map' | 'files'>('topology');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [layout, setLayout] = useState('dagre');
  const [selectedElement, setSelectedElement] = useState<Record<string, string> | null>(null);
  const [listLoaded, setListLoaded] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  // --- Draggable panel layout ---
  type PanelId = 'editor' | 'template' | 'detail' | 'vm-template';
  type PanelLayoutEntry = { side: 'left' | 'right'; collapsed: boolean; width: number; order: number };
  type PanelLayoutMap = Record<PanelId, PanelLayoutEntry>;

  const PANEL_ICONS: Record<PanelId, string> = { editor: '\u270E', template: '\u29C9', detail: '\u2139', 'vm-template': '\u2699' };
  const PANEL_LABELS: Record<PanelId, string> = { editor: 'Editor', template: 'Slice Templates', detail: 'Details', 'vm-template': 'VM Templates' };
  const PANEL_IDS: PanelId[] = ['editor', 'template', 'detail', 'vm-template'];
  const DEFAULT_PANEL_WIDTH = 280;
  const MIN_PANEL_WIDTH = 180;

  const defaultLayout: PanelLayoutMap = {
    editor: { side: 'left', collapsed: false, width: DEFAULT_PANEL_WIDTH, order: 0 },
    template: { side: 'right', collapsed: false, width: DEFAULT_PANEL_WIDTH, order: 0 },
    detail: { side: 'right', collapsed: false, width: DEFAULT_PANEL_WIDTH, order: 1 },
    'vm-template': { side: 'right', collapsed: true, width: DEFAULT_PANEL_WIDTH, order: 2 },
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
        // Migrate: add vm-template panel if missing
        if (!parsed['vm-template']) {
          parsed['vm-template'] = { side: 'right', collapsed: true, width: DEFAULT_PANEL_WIDTH, order: 2 };
        }
        // Migrate: add order field if missing
        for (const id of PANEL_IDS) {
          if (parsed[id] && parsed[id].order === undefined) {
            parsed[id].order = defaultLayout[id].order;
          }
        }
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

  // Check config status on mount
  useEffect(() => {
    api.getConfig().then((cfg) => {
      setIsConfigured(cfg.configured);
      if (!cfg.configured) {
        setSettingsOpen(true);
      }
      // Populate projects list and current project
      if (cfg.token_info?.projects) {
        setProjects(cfg.token_info.projects);
      }
      if (cfg.project_id) {
        setProjectId(cfg.project_id);
        if (cfg.token_info?.projects) {
          const proj = cfg.token_info.projects.find((p) => p.uuid === cfg.project_id);
          if (proj) setProjectName(proj.name);
        }
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
      setErrors(prev => [...prev, e.message]);
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
        setErrors(prev => [...prev, e.message]);
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
        setErrors(prev => [...prev, e.message]);
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

  // Load slice list on first interaction or mount
  const refreshSliceList = useCallback(async () => {
    setLoading(true);
    setErrors([]);
    setStatusMessage('Refreshing slice list...');
    try {
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, []);

  const handleProjectChange = useCallback(async (uuid: string) => {
    const proj = projects.find((p) => p.uuid === uuid);
    if (!proj) return;
    setStatusMessage('Switching project...');
    try {
      // We need bastion_username from current config to save
      const cfg = await api.getConfig();
      await api.saveConfig({
        project_id: uuid,
        bastion_username: cfg.bastion_username,
      });
      setProjectId(uuid);
      setProjectName(proj.name);
      // Reset slice state and refresh
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setListLoaded(false);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setStatusMessage('');
    }
  }, [projects]);

  // No auto-load — user must click "Load Slices" first

  const loadSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setErrors([]);
    setSelectedElement(null);
    setStatusMessage('Loading slice...');
    try {
      // Refresh the slice list first, then load the selected slice
      const [list, data] = await Promise.all([
        api.listSlices(),
        api.getSlice(selectedSliceName),
      ]);
      setSlices(list);
      setListLoaded(true);
      setSliceData(data);
      runValidation(selectedSliceName);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, runValidation]);

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
      try {
        // Reload slice data to get updated state from FABRIC
        const refreshed = await api.refreshSlice(selectedSliceName);
        setSliceData(refreshed);
        runValidation(selectedSliceName);
      } catch {}
      setStatusMessage('Refreshing slice list...');
      try {
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
      } catch {}
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, runValidation]);

  const handleRefreshSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setStatusMessage('Reloading slice...');
    try {
      const data = await api.refreshSlice(selectedSliceName);
      setSliceData(data);
      runValidation(selectedSliceName);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
      setStatusMessage('');
    }
  }, [selectedSliceName, runValidation]);

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
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
    }
  }, [sliceData, selectedSliceName, updateSliceAndValidate]);

  const handleDeleteSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setStatusMessage('Deleting slice...');
    try {
      await api.deleteSlice(selectedSliceName);
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setValidationIssues([]);
      setValidationValid(false);
      setStatusMessage('Deleted. Refreshing slice list...');
      try {
        const list = await api.listSlices();
        setSlices(list);
        setListLoaded(true);
      } catch {}
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
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
      setErrors(prev => [...prev, e.message]);
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
      setErrors(prev => [...prev, e.message]);
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
      setErrors(prev => [...prev, e.message]);
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
      setErrors(prev => [...prev, e.message]);
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
    } else if (action.type === 'delete-component' && action.nodeName && action.componentName) {
      handleDeleteComponent(action.nodeName, action.componentName);
    } else if (action.type === 'delete-facility-port' && action.fpName) {
      handleDeleteFacilityPort(action.fpName);
    } else if (action.type === 'save-vm-template' && action.nodeName) {
      handleSaveVmTemplate(action.nodeName);
    }
  }, [handleOpenTerminals, handleDeleteElements, handleDeleteComponent, handleDeleteFacilityPort, handleSaveVmTemplate]);

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
      setErrors(prev => [...prev, e.message]);
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
          // Clear canvas whenever selection changes (data reloads on Load)
          setSliceData(null);
          setSelectedElement(null);
          setValidationIssues([]);
          setValidationValid(false);
        }}
        onLoad={loadSlice}
        onCreateSlice={handleCreateSlice}
        onSubmit={handleSubmit}
        onReload={handleRefreshSlice}
        onDeleteSlice={handleDeleteSlice}
        onRefreshTopology={refreshInfrastructureAndMark}
        infraLoading={infraLoading}
        onCloneSlice={handleCloneSlice}
        listLoaded={listLoaded}
        onLoadSlices={refreshSliceList}
        infraLoaded={infraLoaded}
        statusMessage={statusMessage}
        onSaveSliceTemplate={handleSaveSliceTemplate}
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
              // Refresh project name and projects list
              api.getConfig().then((cfg) => {
                if (cfg.token_info?.projects) {
                  setProjects(cfg.token_info.projects);
                }
                if (cfg.project_id) {
                  setProjectId(cfg.project_id);
                  if (cfg.token_info?.projects) {
                    const proj = cfg.token_info.projects.find((p) => p.uuid === cfg.project_id);
                    if (proj) setProjectName(proj.name);
                  }
                }
              }).catch(() => {});
            }}
            onClose={() => setSettingsOpen(false)}
          />
        </div>
      )}

      <div style={{ flex: 1, display: (settingsOpen || helpOpen) ? 'none' : 'flex', overflow: 'hidden' }}>
        {currentView === 'files' ? (
          <FileTransferView
            sliceName={selectedSliceName}
            sliceData={sliceData}
          />
        ) : currentView === 'topology' ? (
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
                    />
                  );
                case 'template':
                  return (
                    <TemplatePanel
                      key="template"
                      onSliceImported={handleSliceImported}
                      onCollapse={() => toggleCollapse('template')}
                      dragHandleProps={dragProps}
                      panelIcon={icon}
                    />
                  );
                case 'vm-template':
                  return (
                    <VMTemplatePanel
                      key="vm-template"
                      onCollapse={() => toggleCollapse('vm-template')}
                      dragHandleProps={dragProps}
                      panelIcon={icon}
                      onVmTemplatesChanged={refreshVmTemplates}
                      sliceName={selectedSliceName}
                      sliceData={sliceData}
                      onNodeAdded={updateSliceAndValidate}
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
                  <CytoscapeGraph
                    graph={sliceData?.graph ?? null}
                    layout={layout}
                    dark={dark}
                    sliceData={sliceData}
                    onLayoutChange={setLayout}
                    onNodeClick={handleNodeClick}
                    onEdgeClick={handleEdgeClick}
                    onBackgroundClick={handleBackgroundClick}
                    onContextAction={handleContextAction}
                  />
                  {!consoleFullWidth && !settingsOpen && !helpOpen && (
                    <BottomPanel
                      terminals={terminalTabs}
                      onCloseTerminal={handleCloseTerminal}
                      validationIssues={validationIssues}
                      validationValid={validationValid}
                      sliceState={sliceData?.state ?? ''}
                      dirty={sliceData?.dirty ?? false}
                      errors={errors}
                      onClearErrors={() => { setErrors([]); setValidationIssues([]); setValidationValid(false); }}
                      fullWidth={consoleFullWidth}
                      onToggleFullWidth={() => setConsoleFullWidth(fw => !fw)}
                      showWidthToggle={currentView === 'topology'}
                      expanded={consoleExpanded}
                      onExpandedChange={setConsoleExpanded}
                      panelHeight={consoleHeight}
                      onPanelHeightChange={setConsoleHeight}
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

      {!settingsOpen && !helpOpen && (consoleFullWidth || currentView !== 'topology') && (
        <BottomPanel
          terminals={terminalTabs}
          onCloseTerminal={handleCloseTerminal}
          validationIssues={validationIssues}
          validationValid={validationValid}
          sliceState={sliceData?.state ?? ''}
          dirty={sliceData?.dirty ?? false}
          errors={errors}
          onClearErrors={() => { setErrors([]); setValidationIssues([]); setValidationValid(false); }}
          fullWidth={consoleFullWidth}
          onToggleFullWidth={() => setConsoleFullWidth(fw => !fw)}
          showWidthToggle={currentView === 'topology'}
          expanded={consoleExpanded}
          onExpandedChange={setConsoleExpanded}
          panelHeight={consoleHeight}
          onPanelHeightChange={setConsoleHeight}
        />
      )}

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
