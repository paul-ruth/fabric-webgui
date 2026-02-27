import { useState } from 'react';
import type { SliceSummary } from '../types/fabric';
import '../styles/toolbar.css';

interface ToolbarProps {
  slices: SliceSummary[];
  selectedSlice: string;
  sliceState: string;
  dirty: boolean;
  sliceValid: boolean;
  currentView: 'editor' | 'geo' | 'configure';
  loading: boolean;
  onSelectSlice: (name: string) => void;
  onLoad: () => void;
  onRefreshList: () => void;
  onCreateSlice: (name: string) => void;
  onSubmit: () => void;
  onRefreshSlice: () => void;
  onDeleteSlice: () => void;
  onViewChange: (view: 'editor' | 'geo' | 'configure') => void;
}

export default function Toolbar(props: ToolbarProps) {
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSliceName, setNewSliceName] = useState('');

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
          className={props.currentView === 'configure' ? 'active' : ''}
          onClick={() => props.onViewChange('configure')}
        >
          Configure
        </button>
      </div>
    </div>
  );
}
