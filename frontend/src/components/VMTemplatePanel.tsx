import { useState, useEffect, useCallback } from 'react';
import type { VMTemplateSummary } from '../types/fabric';
import * as api from '../api/client';
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
}

export default function VMTemplatePanel({
  onCollapse, dragHandleProps, panelIcon, onVmTemplatesChanged,
}: VMTemplatePanelProps) {
  const [templates, setTemplates] = useState<VMTemplateSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    <div className="vmt-panel">
      <div className="vmt-header" {...(dragHandleProps || {})}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className="panel-drag-handle">{'\u283F'}</span>
          VM Templates
        </span>
        <button className="collapse-btn" onClick={(e) => { e.stopPropagation(); onCollapse(); }} title="Collapse">
          {panelIcon || '\u2699'}
        </button>
      </div>

      <div className="vmt-body">
        {error && <div className="vmt-error">{error}</div>}

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
          {templates.map((t) => (
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
                <button
                  className="vmt-btn-delete"
                  disabled={t.builtin}
                  onClick={() => setDeletingTemplate(t.name)}
                  title={t.builtin ? 'Cannot delete built-in templates' : 'Delete template'}
                >
                  Delete
                </button>
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
