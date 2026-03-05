'use client';
import { useState, useRef, useEffect } from 'react';
import '../styles/titlebar.css';
import { VERSION } from '../version';
import { checkForUpdate } from '../api/client';
import type { UpdateInfo } from '../types/fabric';

interface ProjectInfo {
  uuid: string;
  name: string;
}

interface AiToolInfo {
  id: string;
  name: string;
  icon: string;
}

interface TitleBarProps {
  dark: boolean;
  currentView: string;
  onToggleDark: () => void;
  onViewChange: (view: 'topology' | 'sliver' | 'map' | 'files' | 'libraries' | 'monitoring' | 'client' | 'ai') => void;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  projectName?: string;
  projects?: ProjectInfo[];
  onProjectChange?: (uuid: string) => void;
  aiTools?: AiToolInfo[];
  selectedAiTool?: string | null;
  onLaunchAiTool?: (toolId: string) => void;
}

const VIEWS: Array<{ key: 'topology' | 'sliver' | 'map' | 'files' | 'libraries' | 'monitoring' | 'client' | 'ai'; label: string; icon: string }> = [
  { key: 'topology', label: 'Topology', icon: '\u25A6' },
  { key: 'sliver', label: 'Table', icon: '\u2261' },
  { key: 'map', label: 'Map', icon: '\u25C9' },
  { key: 'files', label: 'Files', icon: '\u2630' },
  { key: 'libraries', label: 'Artifacts', icon: '\u29C9' },
  { key: 'monitoring', label: 'Monitoring', icon: '\u25CE' },
  { key: 'client', label: 'Client', icon: '\u25B6' },
  { key: 'ai', label: 'AI Companion', icon: '\u2726' },
];

export default function TitleBar({ dark, currentView, onToggleDark, onViewChange, onOpenSettings, onOpenHelp, projectName, projects, onProjectChange, aiTools, selectedAiTool, onLaunchAiTool }: TitleBarProps) {
  const currentProject = projects?.find((p) => p.name === projectName);
  const [viewOpen, setViewOpen] = useState(false);
  const [projOpen, setProjOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [copiedPull, setCopiedPull] = useState(false);
  const [copiedRun, setCopiedRun] = useState(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<HTMLDivElement>(null);

  const [aiSubOpen, setAiSubOpen] = useState(false);

  // Show the selected AI tool name in the pill when an AI view is active
  const activeAiTool = aiTools?.find((t) => t.id === selectedAiTool);
  const activeView = VIEWS.find((v) => v.key === currentView) ?? VIEWS[0];

  // Check for updates on mount
  useEffect(() => {
    checkForUpdate().then(setUpdateInfo).catch(() => {});
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (viewRef.current && !viewRef.current.contains(e.target as Node)) setViewOpen(false);
      if (projRef.current && !projRef.current.contains(e.target as Node)) setProjOpen(false);
      if (updateRef.current && !updateRef.current.contains(e.target as Node)) setUpdateOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleVersionClick = () => {
    setUpdateOpen(!updateOpen);
  };

  const handleCopyPull = () => {
    navigator.clipboard.writeText('docker compose pull\ndocker compose up -d').then(() => {
      setCopiedPull(true);
      setTimeout(() => setCopiedPull(false), 2000);
    });
  };

  const handleCopyRun = () => {
    navigator.clipboard.writeText('docker compose pull\ndocker compose up -d').then(() => {
      setCopiedRun(true);
      setTimeout(() => setCopiedRun(false), 2000);
    });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    try {
      return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  };

  // Add "(beta)" suffix for versions starting with 0
  const displayVersion = (v: string) => {
    const clean = v.replace(/^v/, '');
    return clean.startsWith('0.') ? `${clean} (beta)` : clean;
  };

  return (
    <div className="title-bar">
      <div className="title-left">
        <img src="/fabric_logo.png" alt="FABRIC" className="fabric-logo" />
        <span className="title-text">FABRIC Visualization Suite</span>
        <div className="title-version-wrapper" ref={updateRef}>
          <button className="title-version-btn" onClick={handleVersionClick}>
            <span className="title-version">v{displayVersion(VERSION)}</span>
            {updateInfo?.update_available && <span className="title-update-badge" />}
          </button>
          {updateOpen && (
            <div className="title-update-panel">
              {updateInfo?.update_available ? (
                <>
                  <div className="title-update-header">Update Available</div>
                  <div className="title-update-versions">
                    <span className="title-update-current">v{displayVersion(updateInfo.current_version)}</span>
                    <span className="title-update-arrow">{'\u2192'}</span>
                    <span className="title-update-latest">v{displayVersion(updateInfo.latest_version)}</span>
                  </div>
                  {updateInfo.published_at && (
                    <div className="title-update-date">Published {formatDate(updateInfo.published_at)}</div>
                  )}
                  <div className="title-update-section-label">Upgrade existing install:</div>
                  <div className="title-update-command">
                    <pre>docker compose pull{'\n'}docker compose up -d</pre>
                    <button className="title-update-copy" onClick={handleCopyPull}>
                      {copiedPull ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="title-update-header title-update-header-current">
                    FABRIC Web GUI v{displayVersion(VERSION)}
                  </div>
                  <div className="title-update-status-ok">{'\u2713'} You are running the latest version</div>
                </>
              )}
              <div className="title-update-divider" />
              <div className="title-update-section-label">Install / Run locally:</div>
              <div className="title-update-step">
                <span className="title-update-step-num">1</span>
                <span>Download the compose file:</span>
              </div>
              <div className="title-update-links" style={{ marginBottom: 8 }}>
                <a
                  className="title-update-link"
                  href="https://raw.githubusercontent.com/fabric-testbed/fabric-webgui/main/docker-compose.hub.yml"
                  download="docker-compose.yml"
                >
                  {'\u2913'} docker-compose.yml
                </a>
              </div>
              <div className="title-update-step">
                <span className="title-update-step-num">2</span>
                <span>Pull and start the container:</span>
              </div>
              <div className="title-update-command">
                <pre>docker compose pull{'\n'}docker compose up -d</pre>
                <button className="title-update-copy" onClick={handleCopyRun}>
                  {copiedRun ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <div className="title-update-links">
                <a
                  className="title-update-link"
                  href={updateInfo?.docker_hub_url || `https://hub.docker.com/r/pruth/fabric-webui`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Docker Hub {'\u2197'}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="title-right">
        {/* View selector pill */}
        <div className="title-pill-wrapper" ref={viewRef} data-help-id="titlebar.view">
          <button className="title-pill" onClick={() => { setViewOpen(!viewOpen); setProjOpen(false); setAiSubOpen(false); }}>
            <span className="title-pill-label">View</span>
            <span className="title-pill-value">
              {activeView.icon} {currentView === 'ai' && activeAiTool ? activeAiTool.name : activeView.label}
            </span>
            <span className="title-pill-arrow">{viewOpen ? '\u25B4' : '\u25BE'}</span>
          </button>
          {viewOpen && (
            <div className="title-pill-dropdown">
              {VIEWS.map((v) => {
                // AI Companion entry with sub-menu
                if (v.key === 'ai' && aiTools && aiTools.length > 0) {
                  return (
                    <div
                      key={v.key}
                      className="title-pill-submenu-wrapper"
                      onMouseEnter={() => setAiSubOpen(true)}
                      onMouseLeave={() => setAiSubOpen(false)}
                    >
                      <button
                        className={`title-pill-option ${currentView === v.key ? 'active' : ''}`}
                        onClick={() => setAiSubOpen(!aiSubOpen)}
                      >
                        <span className="title-pill-option-icon">{v.icon}</span>
                        {v.label}
                        <span className="title-pill-submenu-arrow">{'\u203A'}</span>
                      </button>
                      {aiSubOpen && (
                        <div className="title-pill-submenu">
                          {aiTools.map((tool) => (
                            <button
                              key={tool.id}
                              className={`title-pill-option ${currentView === 'ai' && selectedAiTool === tool.id ? 'active' : ''}`}
                              onClick={() => { onLaunchAiTool?.(tool.id); setViewOpen(false); setAiSubOpen(false); }}
                            >
                              <span className="title-pill-option-icon">{tool.icon}</span>
                              {tool.name}
                              {currentView === 'ai' && selectedAiTool === tool.id && <span className="title-pill-check">{'\u2713'}</span>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <button
                    key={v.key}
                    className={`title-pill-option ${currentView === v.key ? 'active' : ''}`}
                    onClick={() => { onViewChange(v.key); setViewOpen(false); }}
                  >
                    <span className="title-pill-option-icon">{v.icon}</span>
                    {v.label}
                    {currentView === v.key && <span className="title-pill-check">{'\u2713'}</span>}
                  </button>
                );
              })}
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
