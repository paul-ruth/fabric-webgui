import { useState } from 'react';
import type { SliceSummary } from '../types/fabric';
import * as api from '../api/client';
import '../styles/toolbar.css';

interface ToolbarProps {
  slices: SliceSummary[];
  selectedSlice: string;
  sliceState: string;
  dirty: boolean;
  sliceValid: boolean;
  currentView: 'editor' | 'geo' | 'files' | 'configure';
  loading: boolean;
  onSelectSlice: (name: string) => void;
  onLoad: () => void;
  onRefreshList: () => void;
  onCreateSlice: (name: string) => void;
  onSubmit: () => void;
  onRefreshSlice: () => void;
  onDeleteSlice: () => void;
  onViewChange: (view: 'editor' | 'geo' | 'files' | 'configure') => void;
  onRefreshResources: () => void;
  infraLoading: boolean;
  onSliceImported?: (data: any) => void;
}

export default function Toolbar(props: ToolbarProps) {
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSliceName, setNewSliceName] = useState('');
  const [openingFromStorage, setOpeningFromStorage] = useState(false);
  const [storageFiles, setStorageFiles] = useState<Array<{ name: string; size: number; modified: number }>>([]);
  const [selectedFile, setSelectedFile] = useState('');

  const handleSave = async () => {
    if (!props.selectedSlice) return;
    try {
      const result = await api.saveToStorage(props.selectedSlice);
      alert(`Saved to storage: ${result.path}`);
    } catch (e: any) {
      alert(`Save failed: ${e.message}`);
    }
  };

  const handleOpen = async () => {
    try {
      const files = await api.listStorageFiles();
      setStorageFiles(files);
      setSelectedFile(files.length > 0 ? files[0].name : '');
      setOpeningFromStorage(true);
    } catch (e: any) {
      alert(`Failed to list files: ${e.message}`);
    }
  };

  const handleOpenConfirm = async () => {
    if (!selectedFile) return;
    try {
      const result = await api.openFromStorage(selectedFile);
      props.onSliceImported?.(result);
      setOpeningFromStorage(false);
    } catch (err: any) {
      alert(`Import failed: ${err.message}`);
    }
  };

  const handleDeleteSlice = () => {
    if (confirming) {
      props.onDeleteSlice();
      setConfirming(false);
    } else {
      setConfirming(true);
    }
  };

  const handleCreate = () => {
    if (newSliceName.trim()) {
      props.onCreateSlice(newSliceName.trim());
      setNewSliceName('');
      setCreating(false);
    }
  };

  const isDraft = props.sliceState === 'Draft';
  const canSubmit = isDraft || props.dirty;

  return (
    <div className="toolbar">
      {props.currentView !== 'configure' && (
        <>
          {/* Slice selector or create form */}
          {creating ? (
            <div className="create-group">
              <input
                type="text"
                placeholder="Slice name..."
                value={newSliceName}
                onChange={(e) => setNewSliceName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                autoFocus
              />
              <button className="success" onClick={handleCreate} disabled={!newSliceName.trim()}>
                Create
              </button>
              <button onClick={() => { setCreating(false); setNewSliceName(''); }}>
                Cancel
              </button>
            </div>
          ) : (
            <>
              <select
                value={props.selectedSlice}
                onChange={(e) => props.onSelectSlice(e.target.value)}
              >
                <option value="">-- Select Slice --</option>
                {props.slices.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button className="primary" onClick={props.onLoad} disabled={!props.selectedSlice || props.loading}>
                {props.loading ? 'Loading...' : 'Load'}
              </button>
              <button onClick={props.onRefreshList} disabled={props.loading} title="Refresh slice list">
                ↻
              </button>
              <button className="success" onClick={() => setCreating(true)} disabled={props.loading} title="Create new slice">
                + New
              </button>
              <button onClick={handleSave} disabled={!props.selectedSlice || props.loading} title="Save slice definition to container storage">
                Save
              </button>
              <button onClick={handleOpen} disabled={props.loading} title="Open slice definition from container storage">
                Open
              </button>
            </>
          )}

          {props.sliceState && (
            <span className={`status-badge ${props.sliceState}`}>
              {props.sliceState}{props.dirty ? ' *' : ''}
            </span>
          )}

          <div className="separator" />

          {/* Submit — sends new or modified slice to FABRIC */}
          <button
            className={canSubmit ? (props.sliceValid ? 'success' : 'warning') : ''}
            onClick={props.onSubmit}
            disabled={!canSubmit || props.loading}
            title={
              !canSubmit ? 'No pending changes'
                : props.sliceValid ? 'Submit changes to FABRIC'
                : 'Slice has validation errors — check the Validation tab'
            }
          >
            ✓ Submit
          </button>
          <button onClick={props.onRefreshSlice} disabled={props.loading} title="Refresh slice from FABRIC (discards local edits)">
            ↻ Refresh
          </button>

          <div className="separator" />

          {/* Delete slice with confirmation */}
          {confirming ? (
            <div className="confirm-group">
              <span>Delete slice?</span>
              <button className="danger" onClick={handleDeleteSlice}>
                Yes
              </button>
              <button onClick={() => setConfirming(false)}>No</button>
            </div>
          ) : (
            <button
              className="danger"
              onClick={handleDeleteSlice}
              disabled={!props.selectedSlice || props.loading}
              title="Delete entire slice"
            >
              ✕ Delete Slice
            </button>
          )}
        </>
      )}

      {props.currentView !== 'configure' && (
        <>
          <div className="separator" />
          <button
            onClick={props.onRefreshResources}
            disabled={props.infraLoading}
            title="Refresh infrastructure sites and links"
          >
            {props.infraLoading ? '↻...' : '↻ Resources'}
          </button>
        </>
      )}

      {/* View toggle */}
      <div className="view-toggle">
        <button
          className={props.currentView === 'editor' ? 'active' : ''}
          onClick={() => props.onViewChange('editor')}
        >
          Editor
        </button>
        <button
          className={props.currentView === 'geo' ? 'active' : ''}
          onClick={() => props.onViewChange('geo')}
        >
          Geographic
        </button>
        <button
          className={props.currentView === 'files' ? 'active' : ''}
          onClick={() => props.onViewChange('files')}
        >
          Files
        </button>
        <button
          className={props.currentView === 'configure' ? 'active' : ''}
          onClick={() => props.onViewChange('configure')}
        >
          Configure
        </button>
      </div>

      {/* Open from storage dialog */}
      {openingFromStorage && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setOpeningFromStorage(false)}>
          <div style={{
            background: 'var(--panel-bg, #fff)', border: '1px solid var(--fabric-border)',
            borderRadius: 8, padding: 20, minWidth: 340, maxWidth: 480,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          }} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14 }}>Open from Storage</h4>
            {storageFiles.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                No .fabric.json files found in storage. Save a slice first or upload files via the Files view.
              </p>
            ) : (
              <select
                value={selectedFile}
                onChange={(e) => setSelectedFile(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, marginBottom: 12 }}
              >
                {storageFiles.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}</option>
                ))}
              </select>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setOpeningFromStorage(false)}>Cancel</button>
              <button
                className="primary"
                onClick={handleOpenConfirm}
                disabled={!selectedFile || storageFiles.length === 0}
              >
                Open
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
