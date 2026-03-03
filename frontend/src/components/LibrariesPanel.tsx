'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { SliceData, VMTemplateSummary, RecipeSummary } from '../types/fabric';
import type { TemplateSummary } from '../api/client';
import * as api from '../api/client';
import Tooltip from './Tooltip';
import '../styles/template-panel.css';
import '../styles/vm-template-panel.css';

interface DragHandleProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

interface LibrariesPanelProps {
  // Slice template props
  onSliceImported: (data: SliceData) => void;
  // VM template props
  onVmTemplatesChanged: () => void;
  sliceName: string;
  sliceData: SliceData | null;
  onNodeAdded: (data: SliceData) => void;
  // Recipe execution callback (lifted to App for BottomPanel console)
  onExecuteRecipe: (recipeDirName: string, nodeName: string) => void;
  executingRecipe: string | null;
  // Panel chrome
  onCollapse: () => void;
  dragHandleProps?: DragHandleProps;
  panelIcon?: string;
}

type TabId = 'slice' | 'vm' | 'recipes';

export default function LibrariesPanel({
  onSliceImported, onVmTemplatesChanged, sliceName, sliceData, onNodeAdded,
  onExecuteRecipe, executingRecipe,
  onCollapse, dragHandleProps, panelIcon,
}: LibrariesPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('slice');

  // ─── Slice Templates state ───
  const [sliceTemplates, setSliceTemplates] = useState<TemplateSummary[]>([]);
  const [sliceLoading, setSliceLoading] = useState(false);
  const [sliceError, setSliceError] = useState('');
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [loadSliceName, setLoadSliceName] = useState('');
  const [deletingSliceTemplate, setDeletingSliceTemplate] = useState<string | null>(null);
  const [loadProgress, setLoadProgress] = useState<{ active: boolean; step: number } | null>(null);
  const loadStepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [sliceSearchFilter, setSliceSearchFilter] = useState('');

  const LOAD_STEPS = [
    'Reading template...',
    'Creating draft slice...',
    'Adding nodes...',
    'Configuring components...',
    'Setting up networks...',
    'Resolving site assignments...',
    'Checking resource availability...',
    'Finalizing topology...',
  ];

  const refreshSliceTemplates = useCallback(async () => {
    setSliceLoading(true);
    setSliceError('');
    try {
      const list = await api.listTemplates();
      setSliceTemplates(list);
    } catch (e: any) {
      setSliceError(e.message);
    } finally {
      setSliceLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSliceTemplates();
  }, [refreshSliceTemplates]);

  const handleLoadSliceTemplate = async (templateName: string) => {
    const name = loadSliceName.trim() || templateName;
    setSliceError('');
    setLoadingTemplate(null);
    setLoadProgress({ active: true, step: 0 });

    let step = 0;
    loadStepTimerRef.current = setInterval(() => {
      step = Math.min(step + 1, LOAD_STEPS.length - 1);
      setLoadProgress({ active: true, step });
    }, 2000);

    try {
      const data = await api.loadTemplate(templateName, name);
      onSliceImported(data);
      setLoadSliceName('');
    } catch (e: any) {
      setSliceError(e.message);
    } finally {
      if (loadStepTimerRef.current) clearInterval(loadStepTimerRef.current);
      setLoadProgress(null);
    }
  };

  const handleDeleteSliceTemplate = async (templateName: string) => {
    setSliceError('');
    try {
      await api.deleteTemplate(templateName);
      setDeletingSliceTemplate(null);
      refreshSliceTemplates();
    } catch (e: any) {
      setSliceError(e.message);
    }
  };

  // ─── VM Templates state ───
  const [vmTemplates, setVmTemplates] = useState<VMTemplateSummary[]>([]);
  const [vmLoading, setVmLoading] = useState(false);
  const [vmError, setVmError] = useState('');
  const [vmSearchFilter, setVmSearchFilter] = useState('');
  const [addingTemplate, setAddingTemplate] = useState<string | null>(null);
  const [deletingVmTemplate, setDeletingVmTemplate] = useState<string | null>(null);
  const [variantPicker, setVariantPicker] = useState<{ dirName: string; images: string[] } | null>(null);

  const refreshVmTemplates = useCallback(async () => {
    setVmLoading(true);
    setVmError('');
    try {
      const list = await api.listVmTemplates();
      setVmTemplates(list);
    } catch (e: any) {
      setVmError(e.message);
    } finally {
      setVmLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshVmTemplates();
  }, [refreshVmTemplates]);

  // ─── Recipes state ───
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [recipeSearchFilter, setRecipeSearchFilter] = useState('');
  const [recipeNodePicker, setRecipeNodePicker] = useState<string | null>(null);

  const refreshRecipes = useCallback(async () => {
    setRecipesLoading(true);
    try {
      const list = await api.listRecipes();
      setRecipes(list);
    } catch {
      // ignore
    } finally {
      setRecipesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshRecipes();
  }, [refreshRecipes]);

  const handleExecuteRecipe = (recipeDirName: string, nodeName: string) => {
    setRecipeNodePicker(null);
    onExecuteRecipe(recipeDirName, nodeName);
  };

  const generateNodeName = useCallback((baseName: string): string => {
    const existingNames = new Set(sliceData?.nodes.map(n => n.name) || []);
    const sanitized = baseName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const base = sanitized || 'node';
    if (!existingNames.has(base)) return base;
    for (let i = 1; ; i++) {
      const candidate = `${base}${i}`;
      if (!existingNames.has(candidate)) return candidate;
    }
  }, [sliceData]);

  const handleAddVm = async (dirName: string, variantImage?: string) => {
    if (!sliceName) return;
    setVmError('');
    setAddingTemplate(dirName);
    setVariantPicker(null);
    try {
      const detail = await api.getVmTemplate(dirName);
      const nodeName = generateNodeName(detail.name);

      if (variantImage && detail.variants) {
        // Multi-variant: use variant endpoint to get synthesized boot_config
        const variant = await api.getVmTemplateVariant(dirName, variantImage);
        const result = await api.addNode(sliceName, { name: nodeName, image: variantImage });
        const bc = variant.boot_config;
        if (bc && (bc.commands.length > 0 || bc.uploads.length > 0 || bc.network.length > 0)) {
          await api.saveBootConfig(sliceName, nodeName, bc);
        }
        onNodeAdded(result);
      } else {
        // Legacy single-image template
        const result = await api.addNode(sliceName, { name: nodeName, image: detail.image });
        const bc = detail.boot_config;
        if (bc && (bc.commands.length > 0 || bc.uploads.length > 0 || bc.network.length > 0)) {
          await api.saveBootConfig(sliceName, nodeName, bc);
        }
        onNodeAdded(result);
      }
    } catch (e: any) {
      setVmError(e.message);
    } finally {
      setAddingTemplate(null);
    }
  };

  const handleDeleteVmTemplate = async (templateName: string) => {
    setVmError('');
    try {
      await api.deleteVmTemplate(templateName);
      setDeletingVmTemplate(null);
      refreshVmTemplates();
      onVmTemplatesChanged();
    } catch (e: any) {
      setVmError(e.message);
    }
  };

  // ─── Shared ───
  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  return (
    <div className="template-panel" data-help-id="templates.panel">
      <div className="template-header" {...(dragHandleProps || {})}>
        <Tooltip text="Browse and load slice templates, VM templates, or recipes">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="panel-drag-handle">{'\u283F'}</span>
            Libraries
          </span>
        </Tooltip>
        <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); onCollapse(); }} title="Collapse">
          {panelIcon || '\u29C9'}
        </button>
      </div>

      {/* Tab bar */}
      <div className="templates-tab-bar">
        <button
          className={`templates-tab${activeTab === 'slice' ? ' active' : ''}`}
          onClick={() => setActiveTab('slice')}
        >
          Slice
        </button>
        <button
          className={`templates-tab${activeTab === 'vm' ? ' active' : ''}`}
          onClick={() => setActiveTab('vm')}
        >
          VM
        </button>
        <button
          className={`templates-tab${activeTab === 'recipes' ? ' active' : ''}`}
          onClick={() => setActiveTab('recipes')}
        >
          Recipes
        </button>
      </div>

      {/* ─── Slice Templates Tab ─── */}
      {activeTab === 'slice' && (
        <div className="template-body">
          {sliceError && <div className="template-error">{sliceError}</div>}

          {sliceTemplates.length > 0 && (
            <div className="template-search-wrapper">
              <input
                type="text"
                className="template-search-input"
                placeholder="Filter slice templates..."
                value={sliceSearchFilter}
                onChange={(e) => setSliceSearchFilter(e.target.value)}
              />
            </div>
          )}

          <div className="template-list">
            {sliceLoading && sliceTemplates.length === 0 && (
              <div className="template-empty">Loading...</div>
            )}
            {!sliceLoading && sliceTemplates.length === 0 && (
              <div className="template-empty">
                No templates saved yet. Use the "Save Template" button in the toolbar to create one.
              </div>
            )}
            {sliceTemplates
              .filter((t) => {
                if (!sliceSearchFilter) return true;
                const q = sliceSearchFilter.toLowerCase();
                return t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
              })
              .map((t) => (
              <div className="template-card" key={t.dir_name}>
                <div className="template-card-header">
                  <span className="template-card-name">{t.name}</span>
                  {t.builtin && <span className="template-builtin-badge">built-in</span>}
                </div>
                {t.description && (
                  <div className="template-card-desc">{t.description}</div>
                )}
                <div className="template-card-meta">
                  <span>{t.node_count} node{t.node_count !== 1 ? 's' : ''}</span>
                  <span>{t.network_count} net{t.network_count !== 1 ? 's' : ''}</span>
                  <span>{formatDate(t.created)}</span>
                </div>
                <div className="template-card-actions">
                  <Tooltip text="Create a new draft slice from this template with pre-configured nodes and networks">
                    <button
                      className="template-btn-load"
                      onClick={() => {
                        setLoadSliceName(t.name);
                        setLoadingTemplate(t.name);
                      }}
                      data-help-id="templates.load"
                    >
                      Load
                    </button>
                  </Tooltip>
                  <Tooltip text="Permanently remove this template">
                    <button
                      className="template-btn-delete"
                      onClick={() => setDeletingSliceTemplate(t.name)}
                      data-help-id="templates.delete"
                    >
                      Delete
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>

          {/* Load Modal */}
          {loadingTemplate && (
            <div className="template-modal-overlay" onClick={() => setLoadingTemplate(null)}>
              <div className="template-modal" onClick={(e) => e.stopPropagation()}>
                <h4>Load Template</h4>
                <p>Create a new draft slice from template <strong>{loadingTemplate}</strong>.</p>
                <input
                  type="text"
                  className="template-input"
                  placeholder="Slice name..."
                  value={loadSliceName}
                  onChange={(e) => setLoadSliceName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleLoadSliceTemplate(loadingTemplate)}
                  autoFocus
                />
                <div className="template-modal-actions">
                  <button onClick={() => setLoadingTemplate(null)}>Cancel</button>
                  <button className="primary" onClick={() => handleLoadSliceTemplate(loadingTemplate)}>Load</button>
                </div>
              </div>
            </div>
          )}

          {/* Loading Progress Overlay */}
          {loadProgress && (
            <div className="template-modal-overlay">
              <div className="template-modal template-loading-modal">
                <div className="template-loading-spinner" />
                <h4>Loading Template</h4>
                <div className="template-loading-steps">
                  {LOAD_STEPS.map((msg, i) => (
                    <div
                      key={i}
                      className={`template-loading-step${i < loadProgress.step ? ' done' : i === loadProgress.step ? ' active' : ''}`}
                    >
                      <span className="template-step-icon">
                        {i < loadProgress.step ? '\u2713' : i === loadProgress.step ? '\u25CF' : '\u25CB'}
                      </span>
                      {msg}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deletingSliceTemplate && (
            <div className="template-modal-overlay" onClick={() => setDeletingSliceTemplate(null)}>
              <div className="template-modal" onClick={(e) => e.stopPropagation()}>
                <h4>Delete Template</h4>
                <p>Are you sure you want to delete <strong>{deletingSliceTemplate}</strong>?</p>
                <div className="template-modal-actions">
                  <button onClick={() => setDeletingSliceTemplate(null)}>Cancel</button>
                  <button className="danger" onClick={() => handleDeleteSliceTemplate(deletingSliceTemplate)}>Delete</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── VM Templates Tab ─── */}
      {activeTab === 'vm' && (
        <div className="vmt-body">
          {vmError && <div className="vmt-error">{vmError}</div>}

          {vmTemplates.length > 0 && (
            <div className="vmt-search-wrapper">
              <input
                type="text"
                className="vmt-search-input"
                placeholder="Filter VM templates..."
                value={vmSearchFilter}
                onChange={(e) => setVmSearchFilter(e.target.value)}
              />
            </div>
          )}

          <div className="vmt-list">
            {vmLoading && vmTemplates.length === 0 && (
              <div className="vmt-empty">Loading...</div>
            )}
            {!vmLoading && vmTemplates.length === 0 && (
              <div className="vmt-empty">
                No VM templates yet. Right-click a node or use "Save VM Template" in the editor to create one.
              </div>
            )}
            {vmTemplates
              .filter((t) => {
                if (!vmSearchFilter) return true;
                const q = vmSearchFilter.toLowerCase();
                return t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
              })
              .map((t) => (
              <div className="vmt-card" key={t.dir_name}>
                <div className="vmt-card-header">
                  <span className="vmt-card-name">{t.name}</span>
                  {t.builtin && <span className="vmt-badge-builtin">built-in</span>}
                  {t.version && <span className="vmt-badge-version">v{t.version}</span>}
                </div>
                {t.description && (
                  <div className="vmt-card-desc">{t.description}</div>
                )}
                <div className="vmt-card-meta">
                  {t.variant_count > 0 ? (
                    <span>{t.variant_count} images</span>
                  ) : (
                    <span>Image: {t.image}</span>
                  )}
                  <span>{formatDate(t.created)}</span>
                </div>
                {/* Inline variant picker */}
                {variantPicker?.dirName === t.dir_name && (
                  <div className="vmt-variant-picker">
                    {t.images.map((img) => (
                      <button
                        key={img}
                        className="vmt-variant-btn"
                        onClick={() => handleAddVm(t.dir_name, img)}
                        disabled={addingTemplate === t.dir_name}
                      >
                        {img}
                      </button>
                    ))}
                    <button className="vmt-variant-btn vmt-variant-cancel" onClick={() => setVariantPicker(null)}>Cancel</button>
                  </div>
                )}
                <div className="vmt-card-actions">
                  <Tooltip text={!sliceName ? 'Select or create a slice first' : 'Add a new node to the current slice using this VM template configuration'}>
                    <button
                      className="vmt-btn-add"
                      disabled={!sliceName || addingTemplate === t.dir_name}
                      onClick={() => {
                        if (t.variant_count > 0) {
                          setVariantPicker({ dirName: t.dir_name, images: t.images });
                        } else {
                          handleAddVm(t.dir_name);
                        }
                      }}
                      data-help-id="vm-templates.add-vm"
                    >
                      {addingTemplate === t.dir_name ? 'Adding...' : 'Add VM'}
                    </button>
                  </Tooltip>
                  <Tooltip text="Permanently remove this VM template">
                    <button
                      className="vmt-btn-delete"
                      onClick={() => setDeletingVmTemplate(t.name)}
                      data-help-id="vm-templates.delete"
                    >
                      Delete
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>

          {/* Delete Confirmation Modal */}
          {deletingVmTemplate && (
            <div className="vmt-modal-overlay" onClick={() => setDeletingVmTemplate(null)}>
              <div className="vmt-modal" onClick={(e) => e.stopPropagation()}>
                <h4>Delete VM Template</h4>
                <p>Are you sure you want to delete <strong>{deletingVmTemplate}</strong>?</p>
                <div className="vmt-modal-actions">
                  <button onClick={() => setDeletingVmTemplate(null)}>Cancel</button>
                  <button className="danger" onClick={() => handleDeleteVmTemplate(deletingVmTemplate)}>Delete</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Recipes Tab ─── */}
      {activeTab === 'recipes' && (
        <div className="vmt-body">
          {recipes.length > 0 && (
            <div className="vmt-search-wrapper">
              <input
                type="text"
                className="vmt-search-input"
                placeholder="Filter recipes..."
                value={recipeSearchFilter}
                onChange={(e) => setRecipeSearchFilter(e.target.value)}
              />
            </div>
          )}

          <div className="vmt-list">
            {recipesLoading && recipes.length === 0 && (
              <div className="vmt-empty">Loading...</div>
            )}
            {!recipesLoading && recipes.length === 0 && (
              <div className="vmt-empty">No recipes available.</div>
            )}
            {recipes
              .filter((r) => {
                if (!recipeSearchFilter) return true;
                const q = recipeSearchFilter.toLowerCase();
                return r.name.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q);
              })
              .map((r) => (
              <div className="vmt-card" key={r.dir_name}>
                <div className="vmt-card-header">
                  <span className="vmt-card-name">{r.name}</span>
                  {r.builtin && <span className="vmt-badge-builtin">built-in</span>}
                </div>
                {r.description && (
                  <div className="vmt-card-desc">{r.description}</div>
                )}
                <div className="vmt-card-meta">
                  <span>Images: {Object.keys(r.image_patterns).join(', ')}</span>
                </div>
                {/* Node picker for Apply */}
                {recipeNodePicker === r.dir_name && sliceData && sliceData.nodes.length > 0 && (
                  <div className="vmt-variant-picker">
                    {sliceData.nodes.map((n) => (
                      <button
                        key={n.name}
                        className="vmt-variant-btn"
                        onClick={() => handleExecuteRecipe(r.dir_name, n.name)}
                        disabled={executingRecipe === r.dir_name}
                      >
                        {n.name}
                      </button>
                    ))}
                    <button className="vmt-variant-btn vmt-variant-cancel" onClick={() => setRecipeNodePicker(null)}>Cancel</button>
                  </div>
                )}
                <div className="vmt-card-actions">
                  <Tooltip text={!sliceName || !sliceData?.nodes.length ? 'Need a slice with nodes first' : 'Apply this recipe to a node'}>
                    <button
                      className="vmt-btn-add"
                      disabled={!sliceName || !sliceData?.nodes.length || executingRecipe === r.dir_name}
                      onClick={() => setRecipeNodePicker(r.dir_name)}
                    >
                      {executingRecipe === r.dir_name ? 'Applying...' : 'Apply'}
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>

        </div>
      )}
    </div>
  );
}
