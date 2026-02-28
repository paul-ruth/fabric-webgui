import { useState, useCallback, useEffect, useRef } from 'react';
import TitleBar from './components/TitleBar';
import Toolbar from './components/Toolbar';
import CytoscapeGraph from './components/CytoscapeGraph';
import type { ContextMenuAction } from './components/CytoscapeGraph';
import EditorPanel from './components/EditorPanel';
import DetailPanel from './components/DetailPanel';
import GeoView from './components/GeoView';
import BottomPanel from './components/BottomPanel';
import type { TerminalTab } from './components/BottomPanel';
import ConfigureView from './components/ConfigureView';
import FileTransferView from './components/FileTransferView';
import HelpView from './components/HelpView';
import HelpContextMenu from './components/HelpContextMenu';
import * as api from './api/client';
import type { SliceSummary, SliceData, SiteInfo, LinkInfo, ComponentModel, SiteMetrics, LinkMetrics, ValidationIssue, ProjectInfo } from './types/fabric';

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
  const [showEditorPanel, setShowEditorPanel] = useState(true);
  const [showDetailPanel, setShowDetailPanel] = useState(true);
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

  // --- Global cache: infrastructure ---
  const [infraSites, setInfraSites] = useState<SiteInfo[]>([]);
  const [infraLinks, setInfraLinks] = useState<LinkInfo[]>([]);
  const [infraLoading, setInfraLoading] = useState(false);

  // --- Global cache: static data (fetched once on mount) ---
  const [images, setImages] = useState<string[]>([]);
  const [componentModels, setComponentModels] = useState<ComponentModel[]>([]);

  // --- Global cache: metrics ---
  const [siteMetricsCache, setSiteMetricsCache] = useState<Record<string, SiteMetrics>>({});
  const [linkMetricsCache, setLinkMetricsCache] = useState<Record<string, LinkMetrics>>({});
  const [metricsRefreshRate, setMetricsRefreshRate] = useState(0); // 0 = manual
  const [metricsLoading, setMetricsLoading] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Fetch static data once on mount (images + component models)
  useEffect(() => {
    api.listImages().then(setImages).catch(() => {});
    api.listComponentModels().then(setComponentModels).catch(() => {});
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

  // --- Refresh infrastructure (sites + links) + metrics ---
  const refreshInfrastructure = useCallback(async () => {
    setInfraLoading(true);
    const IGNORED = new Set(['AWS', 'AZURE', 'GCP', 'OCI', 'AL2S']);
    try {
      const [allSites, links] = await Promise.all([api.listSites(), api.listLinks()]);
      const filteredSites = allSites.filter((s) => !IGNORED.has(s.name) && s.lat !== 0 && s.lon !== 0);
      setInfraSites(filteredSites);
      setInfraLinks(links);

      // Refresh all site metrics in parallel
      Promise.allSettled(filteredSites.map((s) => api.getSiteMetrics(s.name)))
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
      Promise.allSettled(links.map((l) => api.getLinkMetrics(l.site_a, l.site_b)))
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
    }
  }, []);

  // --- Refresh metrics for currently selected element ---
  const refreshMetrics = useCallback(async () => {
    if (!selectedElement) return;
    const type = selectedElement.element_type;
    if (type === 'site') {
      const siteName = selectedElement.name;
      setMetricsLoading(true);
      try {
        const m = await api.getSiteMetrics(siteName);
        setSiteMetricsCache((prev) => ({ ...prev, [siteName]: m }));
      } catch (e: any) {
        setErrors(prev => [...prev, e.message]);
      } finally {
        setMetricsLoading(false);
      }
    } else if (type === 'infra_link') {
      const key = `${selectedElement.site_a}-${selectedElement.site_b}`;
      setMetricsLoading(true);
      try {
        const m = await api.getLinkMetrics(selectedElement.site_a, selectedElement.site_b);
        setLinkMetricsCache((prev) => ({ ...prev, [key]: m }));
      } catch (e: any) {
        setErrors(prev => [...prev, e.message]);
      } finally {
        setMetricsLoading(false);
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
    try {
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleProjectChange = useCallback(async (uuid: string) => {
    const proj = projects.find((p) => p.uuid === uuid);
    if (!proj) return;
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
    }
  }, [projects]);

  // No auto-load — user must click "Load Slices" first

  const loadSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setErrors([]);
    setSelectedElement(null);
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
    try {
      const data = await api.refreshSlice(selectedSliceName);
      setSliceData(data);
      runValidation(selectedSliceName);
    } catch (e: any) {
      setErrors(prev => [...prev, e.message]);
    } finally {
      setLoading(false);
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

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.type === 'terminal') {
      handleOpenTerminals(action.elements);
    } else if (action.type === 'delete') {
      handleDeleteElements(action.elements);
    } else if (action.type === 'delete-component' && action.nodeName && action.componentName) {
      handleDeleteComponent(action.nodeName, action.componentName);
    } else if (action.type === 'delete-facility-port' && action.fpName) {
      handleDeleteFacilityPort(action.fpName);
    }
  }, [handleOpenTerminals, handleDeleteElements, handleDeleteComponent, handleDeleteFacilityPort]);

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
        onSelectSlice={setSelectedSliceName}
        onLoad={loadSlice}
        onCreateSlice={handleCreateSlice}
        onSubmit={handleSubmit}
        onReload={handleRefreshSlice}
        onDeleteSlice={handleDeleteSlice}
        onRefreshTopology={refreshInfrastructureAndMark}
        infraLoading={infraLoading}
        onSliceImported={handleSliceImported}
        onCloneSlice={handleCloneSlice}
        listLoaded={listLoaded}
        onLoadSlices={refreshSliceList}
        infraLoaded={infraLoaded}
        statusMessage={statusMessage}
      />

      <HelpContextMenu onOpenHelp={handleOpenHelp} />

      {/* Help overlay */}
      {helpOpen && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <HelpView
            scrollToSection={helpSection}
            onClose={() => { setHelpOpen(false); setHelpSection(undefined); }}
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
          <>
            {showEditorPanel && (
              <EditorPanel
                sliceData={sliceData}
                sliceName={selectedSliceName}
                onSliceUpdated={handleSliceUpdated}
                onCollapse={() => setShowEditorPanel(false)}
                sites={infraSites}
                images={images}
                componentModels={componentModels}
                selectedElement={selectedElement}
              />
            )}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>
              {!showEditorPanel && (
                <button
                  className="panel-expand-tab left"
                  onClick={() => setShowEditorPanel(true)}
                  title="Show editor panel"
                >
                  ▶
                </button>
              )}
              {!showDetailPanel && (
                <button
                  className="panel-expand-tab right"
                  onClick={() => setShowDetailPanel(true)}
                  title="Show detail panel"
                >
                  ◀
                </button>
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
                  onClearErrors={() => setErrors([])}
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
            {showDetailPanel && (
              <DetailPanel
                sliceData={sliceData}
                selectedElement={selectedElement}
                onCollapse={() => setShowDetailPanel(false)}
                siteMetricsCache={siteMetricsCache}
                linkMetricsCache={linkMetricsCache}
                metricsRefreshRate={metricsRefreshRate}
                onMetricsRefreshRateChange={setMetricsRefreshRate}
                onRefreshMetrics={refreshMetrics}
                metricsLoading={metricsLoading}
              />
            )}
          </>
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
          onClearErrors={() => setErrors([])}
          fullWidth={consoleFullWidth}
          onToggleFullWidth={() => setConsoleFullWidth(fw => !fw)}
          showWidthToggle={currentView === 'topology'}
          expanded={consoleExpanded}
          onExpandedChange={setConsoleExpanded}
          panelHeight={consoleHeight}
          onPanelHeightChange={setConsoleHeight}
        />
      )}
    </>
  );
}
