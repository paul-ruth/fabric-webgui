import { useState, useEffect, useCallback } from 'react';
import type { SliceData } from '../types/fabric';
import type { TemplateSummary } from '../api/client';
import * as api from '../api/client';
import Tooltip from './Tooltip';
import '../styles/template-panel.css';

interface DragHandleProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

interface TemplatePanelProps {
  onSliceImported: (data: SliceData) => void;
  onCollapse: () => void;
  dragHandleProps?: DragHandleProps;
  panelIcon?: string;
}

export default function TemplatePanel({ onSliceImported, onCollapse, dragHandleProps, panelIcon }: TemplatePanelProps) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Load modal state
  const [loadingTemplate, setLoadingTemplate] = useState<string | null>(null);
  const [loadSliceName, setLoadSliceName] = useState('');

  // Delete confirmation
  const [deletingTemplate, setDeletingTemplate] = useState<string | null>(null);

  // Search filter
  const [searchFilter, setSearchFilter] = useState('');

  const refreshTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.listTemplates();
      setTemplates(list);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTemplates();
  }, [refreshTemplates]);

  const handleLoad = async (templateName: string) => {
    const name = loadSliceName.trim() || templateName;
    setError('');
    try {
      const data = await api.loadTemplate(templateName, name);
      onSliceImported(data);
      setLoadingTemplate(null);
      setLoadSliceName('');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDelete = async (templateName: string) => {
    setError('');
    try {
      await api.deleteTemplate(templateName);
      setDeletingTemplate(null);
      refreshTemplates();
    } catch (e: any) {
      setError(e.message);
    }
  };

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
        <Tooltip text="Pre-built slice topologies. Load a template to create a new draft slice with pre-configured nodes, networks, and site groups.">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="panel-drag-handle">{'\u283F'}</span>
            Slice Templates
          </span>
        </Tooltip>
        <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); onCollapse(); }} title="Collapse">
          {panelIcon || '\u29C9'}
        </button>
      </div>

      <div className="template-body">
          {error && <div className="template-error">{error}</div>}

          {/* Search filter */}
          {templates.length > 0 && (
            <div className="template-search-wrapper">
              <input
                type="text"
                className="template-search-input"
                placeholder="Filter slice templates..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
              />
            </div>
          )}

          {/* Template List */}
          <div className="template-list">
            {loading && templates.length === 0 && (
              <div className="template-empty">Loading...</div>
            )}
            {!loading && templates.length === 0 && (
              <div className="template-empty">
                No templates saved yet. Use the "Save Template" button in the toolbar to create one.
              </div>
            )}
            {templates
              .filter((t) => {
                if (!searchFilter) return true;
                const q = searchFilter.toLowerCase();
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
                      onClick={() => setDeletingTemplate(t.name)}
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
                  onKeyDown={(e) => e.key === 'Enter' && handleLoad(loadingTemplate)}
                  autoFocus
                />
                <div className="template-modal-actions">
                  <button onClick={() => setLoadingTemplate(null)}>Cancel</button>
                  <button className="primary" onClick={() => handleLoad(loadingTemplate)}>Load</button>
                </div>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {deletingTemplate && (
            <div className="template-modal-overlay" onClick={() => setDeletingTemplate(null)}>
              <div className="template-modal" onClick={(e) => e.stopPropagation()}>
                <h4>Delete Template</h4>
                <p>Are you sure you want to delete <strong>{deletingTemplate}</strong>?</p>
                <div className="template-modal-actions">
                  <button onClick={() => setDeletingTemplate(null)}>Cancel</button>
                  <button className="danger" onClick={() => handleDelete(deletingTemplate)}>Delete</button>
                </div>
              </div>
            </div>
          )}
        </div>
    </div>
  );
}
