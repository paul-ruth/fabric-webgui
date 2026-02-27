import { useState, useCallback, useEffect } from 'react';
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
import * as api from './api/client';
import type { SliceSummary, SliceData, SiteInfo, LinkInfo, ValidationIssue } from './types/fabric';

export default function App() {
  const [slices, setSlices] = useState<SliceSummary[]>([]);
  const [selectedSliceName, setSelectedSliceName] = useState('');
  const [sliceData, setSliceData] = useState<SliceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentView, setCurrentView] = useState<'editor' | 'geo' | 'configure'>('editor');
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
  const [infraSites, setInfraSites] = useState<SiteInfo[]>([]);
  const [infraLinks, setInfraLinks] = useState<LinkInfo[]>([]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Fetch infrastructure sites and links (fire-and-forget on mount)
  useEffect(() => {
    const IGNORED = new Set(['AWS', 'AZURE', 'GCP', 'OCI', 'AL2S']);
    api.listSites()
      .then((all) => setInfraSites(all.filter((s) => !IGNORED.has(s.name) && s.lat !== 0 && s.lon !== 0)))
      .catch(() => {});
    api.listLinks().then(setInfraLinks).catch(() => {});
  }, []);

  // Check config status on mount
  useEffect(() => {
    api.getConfig().then((cfg) => {
      setIsConfigured(cfg.configured);
      if (!cfg.configured) {
        setCurrentView('configure');
      }
    }).catch(() => {
      setIsConfigured(false);
      setCurrentView('configure');
    });

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('configLogin') === 'success') {
      setCurrentView('configure');
      window.history.replaceState({}, '', '/');
    }
  }, []);

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
    setError('');
    try {
      const list = await api.listSlices();
      setSlices(list);
      setListLoaded(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load list if not yet loaded and configured
  if (!listLoaded && !loading && isConfigured) {
    refreshSliceList();
  }

  const loadSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    setError('');
    setSelectedElement(null);
    try {
      const data = await api.getSlice(selectedSliceName);
      setSliceData(data);
      runValidation(selectedSliceName);
    } catch (e: any) {
      setError(e.message);
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
    try {
      const data = await api.submitSlice(selectedSliceName);
      setSliceData(data);
      setValidationIssues([]);
      setValidationValid(true);
      await refreshSliceList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSliceName, refreshSliceList]);

  const handleRefreshSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    try {
      const data = await api.refreshSlice(selectedSliceName);
      setSliceData(data);
      runValidation(selectedSliceName);
    } catch (e: any) {
      setError(e.message);
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
        }
      }
      updateSliceAndValidate(data);
      setSelectedElement(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sliceData, selectedSliceName, updateSliceAndValidate]);

  const handleDeleteSlice = useCallback(async () => {
    if (!selectedSliceName) return;
    setLoading(true);
    try {
      await api.deleteSlice(selectedSliceName);
      setSliceData(null);
      setSelectedSliceName('');
      setSelectedElement(null);
      setValidationIssues([]);
      setValidationValid(false);
      await refreshSliceList();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedSliceName, refreshSliceList]);

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
    setError('');
    try {
      const data = await api.createSlice(name);
      setSliceData(data);
      setSelectedSliceName(name);
      setSlices((prev) => {
        if (prev.some((s) => s.name === name)) return prev;
        return [...prev, { name, id: '', state: 'Draft' }];
      });
      runValidation(name);
    } catch (e: any) {
      setError(e.message);
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

  const handleContextAction = useCallback((action: ContextMenuAction) => {
    if (action.type === 'terminal') {
      handleOpenTerminals(action.elements);
    } else if (action.type === 'delete') {
      handleDeleteElements(action.elements);
    }
  }, [handleOpenTerminals, handleDeleteElements]);

  const handleCloseTerminal = useCallback((id: string) => {
    setTerminalTabs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleSliceUpdated = useCallback((data: SliceData) => {
    updateSliceAndValidate(data);
  }, [updateSliceAndValidate]);

  return (
    <>
      <TitleBar dark={dark} currentView={currentView} onToggleDark={() => setDark((d) => !d)} />

      {error && (
        <div style={{
          padding: '8px 16px',
          background: 'var(--state-error-bg)',
          color: 'var(--state-error-border)',
          fontSize: 13,
          borderBottom: '1px solid var(--fabric-border)',
        }}>
          {error}
          <button
            onClick={() => setError('')}
            style={{ float: 'right', background: 'none', border: 'none', color: 'var(--state-error-border)', fontSize: 16 }}
          >
            ×
          </button>
        </div>
      )}

      <Toolbar
        slices={slices}
        selectedSlice={selectedSliceName}
        sliceState={sliceData?.state ?? ''}
        dirty={sliceData?.dirty ?? false}
        sliceValid={validationValid}
        currentView={currentView}
        loading={loading}
        onSelectSlice={setSelectedSliceName}
        onLoad={loadSlice}
        onRefreshList={refreshSliceList}
        onCreateSlice={handleCreateSlice}
        onSubmit={handleSubmit}
        onRefreshSlice={handleRefreshSlice}
        onDeleteSlice={handleDeleteSlice}
        onViewChange={setCurrentView}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {currentView === 'configure' ? (
          <ConfigureView
            onConfigured={() => {
              setIsConfigured(true);
              setCurrentView('editor');
              setListLoaded(false);
            }}
          />
        ) : currentView === 'editor' ? (
          <>
            {showEditorPanel && (
              <EditorPanel
                sliceData={sliceData}
                sliceName={selectedSliceName}
                onSliceUpdated={handleSliceUpdated}
                onCollapse={() => setShowEditorPanel(false)}
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
                onLayoutChange={setLayout}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onBackgroundClick={handleBackgroundClick}
                onContextAction={handleContextAction}
              />
              <BottomPanel
                terminals={terminalTabs}
                onCloseTerminal={handleCloseTerminal}
                validationIssues={validationIssues}
                validationValid={validationValid}
                sliceState={sliceData?.state ?? ''}
                dirty={sliceData?.dirty ?? false}
              />
            </div>
            {showDetailPanel && (
              <DetailPanel
                sliceData={sliceData}
                selectedElement={selectedElement}
                onCollapse={() => setShowDetailPanel(false)}
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
          />
        )}
      </div>
    </>
  );
}
