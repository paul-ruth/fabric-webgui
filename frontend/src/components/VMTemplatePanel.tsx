import { useState, useEffect, useCallback } from 'react';
import type { VMTemplateSummary, SliceData } from '../types/fabric';
import * as api from '../api/client';
import Tooltip from './Tooltip';
import '../styles/vm-template-panel.css';

interface DragHandleProps {
  draggable: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

interface VMTemplatePanelProps {
  onCollapse: () => void;
  dragHandleProps?: DragHandleProps;
  panelIcon?: string;
  onVmTemplatesChanged: () => void;
  sliceName: string;
  sliceData: SliceData | null;
  onNodeAdded: (data: SliceData) => void;
}

export default function VMTemplatePanel({
  onCollapse, dragHandleProps, panelIcon, onVmTemplatesChanged,
  sliceName, sliceData, onNodeAdded,
}: VMTemplatePanelProps) {
  const [templates, setTemplates] = useState<VMTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchFilter, setSearchFilter] = useState('');
  const [addingTemplate, setAddingTemplate] = useState<string | null>(null);

  // Delete confirmation
  const [deletingTemplate, setDeletingTemplate] = useState<string | null>(null);

  const refreshTemplates = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await api.listVmTemplates();
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

  const generateNodeName = useCallback((baseName: string): string => {
    const existingNames = new Set(sliceData?.nodes.map(n => n.name) || []);
    // Sanitize base name: lowercase, replace spaces/special chars with hyphens
    const sanitized = baseName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const base = sanitized || 'node';
    if (!existingNames.has(base)) return base;
    for (let i = 1; ; i++) {
      const candidate = `${base}${i}`;
      if (!existingNames.has(candidate)) return candidate;
    }
  }, [sliceData]);

  const handleAddVm = async (dirName: string) => {
    if (!sliceName) return;
    setError('');
    setAddingTemplate(dirName);
    try {
      const detail = await api.getVmTemplate(dirName);
      const nodeName = generateNodeName(detail.name);
      const result = await api.addNode(sliceName, { name: nodeName, image: detail.image });
      // Apply boot config if template has commands or uploads
      const bc = detail.boot_config;
      if (bc && (bc.commands.length > 0 || bc.uploads.length > 0 || bc.network.length > 0)) {
        await api.saveBootConfig(sliceName, nodeName, bc);
      }
      onNodeAdded(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingTemplate(null);
    }
  };

  const handleDelete = async (templateName: string) => {
    setError('');
    try {
      await api.deleteVmTemplate(templateName);
      setDeletingTemplate(null);
      refreshTemplates();
      onVmTemplatesChanged();
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
    <div className="vmt-panel" data-help-id="vm-templates.panel">
      <div className="vmt-header" {...(dragHandleProps || {})}>
        <Tooltip text="Reusable VM configurations. Add a VM from a template to quickly create nodes with pre-configured images and boot scripts.">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span className="panel-drag-handle">{'\u283F'}</span>
            VM Templates
          </span>
        </Tooltip>
        <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); onCollapse(); }} title="Collapse">
          {panelIcon || '\u2699'}
        </button>
      </div>

      <div className="vmt-body">
        {error && <div className="vmt-error">{error}</div>}

        {/* Search filter */}
        {templates.length > 0 && (
          <div className="vmt-search-wrapper">
            <input
              type="text"
              className="vmt-search-input"
              placeholder="Filter VM templates..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
          </div>
        )}

        {/* Template list */}
        <div className="vmt-list">
          {loading && templates.length === 0 && (
            <div className="vmt-empty">Loading...</div>
          )}
          {!loading && templates.length === 0 && (
            <div className="vmt-empty">
              No VM templates yet. Right-click a node or use "Save VM Template" in the editor to create one.
            </div>
          )}
          {templates
            .filter((t) => {
              if (!searchFilter) return true;
              const q = searchFilter.toLowerCase();
              return t.name.toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q);
            })
            .map((t) => (
            <div className="vmt-card" key={t.dir_name}>
              <div className="vmt-card-header">
                <span className="vmt-card-name">{t.name}</span>
                {t.builtin && <span className="vmt-badge-builtin">built-in</span>}
              </div>
              {t.description && (
                <div className="vmt-card-desc">{t.description}</div>
              )}
              <div className="vmt-card-meta">
                <span>Image: {t.image}</span>
                <span>{formatDate(t.created)}</span>
              </div>
              <div className="vmt-card-actions">
                <Tooltip text={!sliceName ? 'Select or create a slice first' : 'Add a new node to the current slice using this VM template configuration'}>
                  <button
                    className="vmt-btn-add"
                    disabled={!sliceName || addingTemplate === t.dir_name}
                    onClick={() => handleAddVm(t.dir_name)}
                    data-help-id="vm-templates.add-vm"
                  >
                    {addingTemplate === t.dir_name ? 'Adding...' : 'Add VM'}
                  </button>
                </Tooltip>
                <Tooltip text="Permanently remove this VM template">
                  <button
                    className="vmt-btn-delete"
                    onClick={() => setDeletingTemplate(t.name)}
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
        {deletingTemplate && (
          <div className="vmt-modal-overlay" onClick={() => setDeletingTemplate(null)}>
            <div className="vmt-modal" onClick={(e) => e.stopPropagation()}>
              <h4>Delete VM Template</h4>
              <p>Are you sure you want to delete <strong>{deletingTemplate}</strong>?</p>
              <div className="vmt-modal-actions">
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
