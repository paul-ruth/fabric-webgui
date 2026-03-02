import { useState, useRef, useEffect } from 'react';
import type { SliceSummary } from '../types/fabric';
import Tooltip from './Tooltip';
import '../styles/toolbar.css';

const TERMINAL_STATES = new Set(['Dead', 'Closing', 'StableError']);

interface ToolbarProps {
  slices: SliceSummary[];
  selectedSlice: string;
  sliceState: string;
  dirty: boolean;
  sliceValid: boolean;
  loading: boolean;
  onSelectSlice: (name: string) => void;
  onLoad: () => void;
  onCreateSlice: (name: string) => void;
  onSubmit: () => void;
  onRefreshSlices: () => void;
  onDeleteSlice: () => void;
  onRefreshTopology: () => void;
  infraLoading: boolean;
  onCloneSlice?: (newName: string) => void;
  listLoaded: boolean;
  onLoadSlices: () => void;
  infraLoaded: boolean;
  statusMessage?: string;
  onSaveSliceTemplate?: () => void;
  onArchiveSlice?: () => void;
  onArchiveAllTerminal?: () => void;
  hasErrors?: boolean;
  autoRefresh?: boolean;
  onToggleAutoRefresh?: () => void;
}

export default function Toolbar(props: ToolbarProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSliceName, setNewSliceName] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneName, setCloneName] = useState('');

  // Combo box state for slice selector
  const [sliceFilter, setSliceFilter] = useState('');
  const [sliceDropOpen, setSliceDropOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!sliceDropOpen) return;
    const handler = (e: MouseEvent) => {
      if (comboRef.current && !comboRef.current.contains(e.target as Node)) {
        setSliceDropOpen(false);
        setSliceFilter('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sliceDropOpen]);

  const handleDeleteConfirm = () => {
    props.onDeleteSlice();
    setConfirmingDelete(false);
  };

  const handleRevertConfirm = () => {
    props.onRefreshSlices();
    setConfirmingRevert(false);
  };

  const handleLoadSlice = () => {
    if (hasSlice && props.dirty) {
      setConfirmingRevert(true);
    } else {
      props.onLoad();
    }
  };

  const handleCreate = () => {
    if (newSliceName.trim()) {
      props.onCreateSlice(newSliceName.trim());
      setNewSliceName('');
      setCreating(false);
    }
  };

  const handleClone = () => {
    if (cloneName.trim()) {
      props.onCloneSlice?.(cloneName.trim());
      setCloneName('');
      setCloning(false);
    }
  };

  const isDraft = props.sliceState === 'Draft';
  const canSubmit = isDraft || props.dirty;
  const hasSlice = !!props.selectedSlice && !!props.sliceState;
  const isTerminal = TERMINAL_STATES.has(props.sliceState);
  const hasTerminalSlices = props.slices.some(s => TERMINAL_STATES.has(s.state));

  const loadLabel = hasSlice ? 'Reload' : 'Load';
  const loadTitle = hasSlice
    ? (props.dirty ? 'Reload slice from FABRIC — all uncommitted changes will be lost' : 'Reload slice data from FABRIC')
    : 'Load the selected slice from FABRIC';

  return (
    <div className="toolbar">
      {/* --- Slice Group (selector + actions) --- */}
      <div className="toolbar-group">
        <span className="toolbar-group-label">Slice</span>

        {/* Refresh all slices (list + current) */}
        <Tooltip text={props.listLoaded ? 'Refresh all slices from FABRIC (list and current slice)' : 'Fetch your slices from FABRIC'}>
          <button
            className="toolbar-btn toolbar-btn-list"
            onClick={props.listLoaded ? props.onRefreshSlices : props.onLoadSlices}
            disabled={props.loading}
          >
            {props.listLoaded ? '\u21BB Refresh Slices' : 'Load Slices'}
          </button>
        </Tooltip>

        <div className="slice-combo" ref={comboRef} data-help-id="toolbar.slice-selector">
          <input
            type="text"
            className="slice-combo-input"
            placeholder={props.selectedSlice || '-- Select Slice --'}
            value={sliceDropOpen ? sliceFilter : (props.selectedSlice || '')}
            onChange={(e) => { setSliceFilter(e.target.value); if (!sliceDropOpen) setSliceDropOpen(true); }}
            onFocus={() => { setSliceDropOpen(true); setSliceFilter(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { setSliceDropOpen(false); setSliceFilter(''); (e.target as HTMLElement).blur(); }
            }}
          />
          <button
            className="slice-combo-toggle"
            onClick={() => { setSliceDropOpen(!sliceDropOpen); setSliceFilter(''); }}
            tabIndex={-1}
          >
            {sliceDropOpen ? '\u25B4' : '\u25BE'}
          </button>
          {sliceDropOpen && (() => {
            const q = sliceFilter.toLowerCase();
            const activeSlices = props.slices.filter((s) => s.state !== 'Draft' && !TERMINAL_STATES.has(s.state) && s.name.toLowerCase().includes(q));
            const terminalSlices = props.slices.filter((s) => TERMINAL_STATES.has(s.state) && s.name.toLowerCase().includes(q));
            const draftSlices = props.slices.filter((s) => s.state === 'Draft' && s.name.toLowerCase().includes(q));
            const hasResults = activeSlices.length > 0 || terminalSlices.length > 0 || draftSlices.length > 0;
            return (
              <div className="slice-combo-dropdown">
                {!hasResults && (
                  <div className="slice-combo-empty">No matching slices</div>
                )}
                {activeSlices.length > 0 && (
                  <>
                    <div className="slice-combo-group-label">FABRIC Slices</div>
                    {activeSlices.map((s) => {
                      const isSelected = s.name === props.selectedSlice;
                      const dirtyMark = isSelected && props.dirty ? ' *' : '';
                      return (
                        <button
                          key={s.name}
                          className={`slice-combo-option ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            props.onSelectSlice(s.name);
                            setSliceDropOpen(false);
                            setSliceFilter('');
                          }}
                        >
                          <span className="slice-combo-name">{s.name}</span>
                          <span className={`slice-combo-state ${s.state}`}>{s.state}{dirtyMark}</span>
                        </button>
                      );
                    })}
                  </>
                )}
                {terminalSlices.length > 0 && (
                  <>
                    <div className="slice-combo-group-label">Terminal Slices</div>
                    {terminalSlices.map((s) => (
                      <button
                        key={`${s.name}-${s.id}`}
                        className={`slice-combo-option slice-combo-option-terminal ${s.has_errors ? 'has-errors' : ''} ${s.name === props.selectedSlice ? 'active' : ''}`}
                        onClick={() => {
                          props.onSelectSlice(s.name);
                          setSliceDropOpen(false);
                          setSliceFilter('');
                        }}
                      >
                        <span className="slice-combo-name">
                          {s.has_errors && <span className="slice-combo-error-dot" title="This slice has errors" />}
                          {s.name}
                        </span>
                        <span className={`slice-combo-state ${s.has_errors ? 'StableError' : s.state}`}>
                          {s.has_errors ? 'Failed' : s.state}
                        </span>
                      </button>
                    ))}
                  </>
                )}
                {draftSlices.length > 0 && (
                  <>
                    <div className="slice-combo-group-label">Local Drafts</div>
                    {draftSlices.map((s) => (
                      <button
                        key={s.name}
                        className={`slice-combo-option ${s.name === props.selectedSlice ? 'active' : ''}`}
                        onClick={() => {
                          props.onSelectSlice(s.name);
                          setSliceDropOpen(false);
                          setSliceFilter('');
                        }}
                      >
                        <span className="slice-combo-name">{s.name}</span>
                        <span className="slice-combo-state Draft">Draft</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            );
          })()}
        </div>

        <Tooltip text={loadTitle}>
          <button
            className={`toolbar-btn toolbar-btn-load ${hasSlice && props.dirty ? 'warning' : 'primary'}`}
            onClick={handleLoadSlice}
            disabled={!props.selectedSlice || props.loading}
            data-help-id="toolbar.load"
          >
            {props.loading ? 'Loading...' : loadLabel}
          </button>
        </Tooltip>

        <Tooltip text="Create a new empty draft slice">
          <button
            className="toolbar-btn toolbar-btn-new success"
            onClick={() => setCreating(true)}
            disabled={props.loading}
            data-help-id="toolbar.new"
          >
            + New
          </button>
        </Tooltip>

        <Tooltip text={!canSubmit ? 'No pending changes' : props.sliceValid ? 'Submit slice to FABRIC for provisioning' : 'Slice has validation errors'}>
          <button
            className={`toolbar-btn toolbar-btn-submit ${canSubmit ? (props.sliceValid ? 'success' : 'warning') : 'primary'}`}
            onClick={props.onSubmit}
            disabled={!hasSlice || !canSubmit || props.loading}
            data-help-id="toolbar.submit"
          >
            Submit
          </button>
        </Tooltip>

        <Tooltip text={isDraft ? "Discard this draft" : "Delete this slice from FABRIC"}>
          <button
            className="toolbar-btn toolbar-btn-delete danger"
            onClick={() => setConfirmingDelete(true)}
            disabled={!hasSlice || props.loading}
            data-help-id="toolbar.delete"
          >
            {isDraft ? 'Discard' : 'Delete'}
          </button>
        </Tooltip>

        <Tooltip text="Clone this slice as a new draft">
          <button
            className="toolbar-btn toolbar-btn-clone"
            onClick={() => { setCloneName(`${props.selectedSlice}-copy`); setCloning(true); }}
            disabled={!hasSlice || props.loading}
            data-help-id="toolbar.clone"
          >
            Clone
          </button>
        </Tooltip>

        <Tooltip text="Save current slice as a reusable template">
          <button
            className="toolbar-btn toolbar-btn-save-template"
            onClick={() => props.onSaveSliceTemplate?.()}
            disabled={!hasSlice || !props.sliceState || props.loading}
          >
            Save as Template
          </button>
        </Tooltip>

        {hasSlice && isTerminal && (
          <Tooltip text="Archive this slice (hide from list)">
            <button
              className="toolbar-btn toolbar-btn-archive"
              onClick={() => props.onArchiveSlice?.()}
              disabled={props.loading}
            >
              Archive
            </button>
          </Tooltip>
        )}

        {hasTerminalSlices && (
          <Tooltip text="Archive all Dead/Closing/Error slices">
            <button
              className="toolbar-btn toolbar-btn-archive-all"
              onClick={() => props.onArchiveAllTerminal?.()}
              disabled={props.loading}
            >
              Archive All Terminal
            </button>
          </Tooltip>
        )}
      </div>

      {props.sliceState && (
        <span className={`status-badge ${props.hasErrors && isTerminal ? 'StableError' : props.sliceState}`}>
          {props.hasErrors && isTerminal ? 'Failed' : props.sliceState}{props.dirty ? ' *' : ''}
        </span>
      )}

      <Tooltip text={props.autoRefresh ? 'Auto-refresh is on — slice list and state update automatically while provisioning' : 'Auto-refresh is off — click to enable automatic updates while provisioning'}>
        <button
          className={`toolbar-btn toolbar-btn-auto-refresh ${props.autoRefresh ? 'active' : ''}`}
          onClick={props.onToggleAutoRefresh}
        >
          {props.autoRefresh ? '\u21BB Auto' : '\u21BB Auto'}
        </button>
      </Tooltip>

      <div className="toolbar-spacer" />

      <Tooltip text={props.infraLoaded ? 'Refresh site and link data from FABRIC' : 'Load site and link data from FABRIC'}>
        <button
          className="toolbar-btn toolbar-btn-resources"
          onClick={props.onRefreshTopology}
          disabled={props.infraLoading}
          data-help-id="toolbar.refresh-resources"
        >
          {props.infraLoading ? '\u21BB Loading Resources...' : props.infraLoaded ? '\u21BB Refresh Resources' : 'Load Resources'}
        </button>
      </Tooltip>

      {/* --- Modal: Confirm Delete --- */}
      {confirmingDelete && (
        <div className="toolbar-modal-overlay" onClick={() => setConfirmingDelete(false)}>
          <div className="toolbar-modal" onClick={(e) => e.stopPropagation()}>
            <h4>{isDraft ? 'Discard Draft' : 'Delete Slice'}</h4>
            <p>{isDraft
              ? <>Discard draft <strong>{props.selectedSlice}</strong>? This only removes the local draft — nothing has been submitted to FABRIC.</>
              : <>Are you sure you want to delete <strong>{props.selectedSlice}</strong>? This cannot be undone.</>
            }</p>
            <div className="toolbar-modal-actions">
              <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
              <button className="danger" onClick={handleDeleteConfirm}>{isDraft ? 'Discard' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Confirm Reload --- */}
      {confirmingRevert && (
        <div className="toolbar-modal-overlay" onClick={() => setConfirmingRevert(false)}>
          <div className="toolbar-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Reload Slice</h4>
            <p>All uncommitted changes to <strong>{props.selectedSlice}</strong> will be lost. Continue?</p>
            <div className="toolbar-modal-actions">
              <button onClick={() => setConfirmingRevert(false)}>Cancel</button>
              <button className="warning" onClick={handleRevertConfirm}>Reload</button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Create Slice --- */}
      {creating && (
        <div className="toolbar-modal-overlay" onClick={() => { setCreating(false); setNewSliceName(''); }}>
          <div className="toolbar-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Create New Slice</h4>
            <p>Enter a name for the new draft slice.</p>
            <input
              type="text"
              className="toolbar-modal-input"
              placeholder="Slice name..."
              value={newSliceName}
              onChange={(e) => setNewSliceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="toolbar-modal-actions">
              <button onClick={() => { setCreating(false); setNewSliceName(''); }}>Cancel</button>
              <button className="success" onClick={handleCreate} disabled={!newSliceName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* --- Modal: Clone Slice --- */}
      {cloning && (
        <div className="toolbar-modal-overlay" onClick={() => { setCloning(false); setCloneName(''); }}>
          <div className="toolbar-modal" onClick={(e) => e.stopPropagation()}>
            <h4>Clone Slice</h4>
            <p>Enter a name for the cloned draft slice.</p>
            <input
              type="text"
              className="toolbar-modal-input"
              placeholder="New slice name..."
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleClone()}
              autoFocus
            />
            <div className="toolbar-modal-actions">
              <button onClick={() => { setCloning(false); setCloneName(''); }}>Cancel</button>
              <button className="success" onClick={handleClone} disabled={!cloneName.trim()}>Clone</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
