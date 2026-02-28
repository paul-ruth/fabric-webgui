import { useState, useRef, useEffect } from 'react';
import '../styles/titlebar.css';

interface ProjectInfo {
  uuid: string;
  name: string;
}

interface TitleBarProps {
  dark: boolean;
  currentView: string;
  onToggleDark: () => void;
  onViewChange: (view: 'topology' | 'map' | 'files') => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  projectName?: string;
  projects?: ProjectInfo[];
  onProjectChange?: (uuid: string) => void;
}

const VIEWS: Array<{ key: 'topology' | 'map' | 'files'; label: string; icon: string }> = [
  { key: 'topology', label: 'Topology', icon: '\u25A6' },
  { key: 'map', label: 'Map', icon: '\u25C9' },
  { key: 'files', label: 'Files', icon: '\u2630' },
];

export default function TitleBar({ dark, currentView, onToggleDark, onViewChange, onOpenSettings, onOpenHelp, projectName, projects, onProjectChange }: TitleBarProps) {
  const currentProject = projects?.find((p) => p.name === projectName);
  const [viewOpen, setViewOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLDivElement>(null);

  const activeView = VIEWS.find((v) => v.key === currentView) ?? VIEWS[0];

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) setViewOpen(false);
      if (projRef.current && !projRef.current.contains(e.target as Node)) setProjOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="title-bar">
      <div className="title-left">
        <img src="/fabric_logo.png" alt="FABRIC" className="fabric-logo" />
        <span className="title-text">FABRIC Visualization Suite</span>
        <span className="title-version">v0.1.0-beta</span>
      </div>
      <div className="title-right">
        {/* View selector pill */}
        <div className="title-pill-wrapper" ref={viewRef} data-help-id="titlebar.view">
          <button className="title-pill" onClick={() => { setViewOpen(!viewOpen); setProjOpen(false); }}>
            <span className="title-pill-label">View</span>
            <span className="title-pill-value">{activeView.icon} {activeView.label}</span>
            <span className="title-pill-arrow">{viewOpen ? '\u25B4' : '\u25BE'}</span>
          </button>
          {viewOpen && (
            <div className="title-pill-dropdown">
              {VIEWS.map((v) => (
                <button
                  key={v.key}
                  className={`title-pill-option ${currentView === v.key ? 'active' : ''}`}
                  onClick={() => { onViewChange(v.key); setViewOpen(false); }}
                >
                  <span className="title-pill-option-icon">{v.icon}</span>
                  {v.label}
                  {currentView === v.key && <span className="title-pill-check">{'\u2713'}</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Project selector pill */}
        {projects && projects.length > 0 && onProjectChange && (
          <div className="title-pill-wrapper" ref={projRef} data-help-id="titlebar.project">
            <button className="title-pill" onClick={() => { setProjOpen(!projOpen); setViewOpen(false); }}>
              <span className="title-pill-label">Project</span>
              <span className="title-pill-value">{projectName || 'None'}</span>
              <span className="title-pill-arrow">{projOpen ? '\u25B4' : '\u25BE'}</span>
            </button>
            {projOpen && (
              <div className="title-pill-dropdown title-pill-dropdown-projects">
                {projects.map((p) => (
                  <button
                    key={p.uuid}
                    className={`title-pill-option ${currentProject?.uuid === p.uuid ? 'active' : ''}`}
                    onClick={() => { onProjectChange(p.uuid); setProjOpen(false); }}
                  >
                    {p.name}
                    {currentProject?.uuid === p.uuid && <span className="title-pill-check">{'\u2713'}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Settings button */}
        <button className="title-icon-btn" onClick={onOpenSettings} title="Settings" data-help-id="titlebar.settings">
          {'\u2699'}
        </button>

        {/* Theme toggle */}
        <button className="title-icon-btn" onClick={onToggleDark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} data-help-id="titlebar.theme">
          {dark ? '\u2600' : '\u263E'}
        </button>

        {/* Help button */}
        <button className="title-icon-btn" onClick={onOpenHelp} title="Help" data-help-id="titlebar.help">
          ?
        </button>
      </div>
    </div>
  );
}
