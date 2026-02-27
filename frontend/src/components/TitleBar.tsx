import '../styles/titlebar.css';

interface TitleBarProps {
  dark: boolean;
  currentView: string;
  onToggleDark: () => void;
}

export default function TitleBar({ dark, currentView, onToggleDark }: TitleBarProps) {
  const modeLabel = currentView === 'configure' ? 'Configure' : currentView === 'editor' ? 'Editor' : 'Geographic';

  return (
    <div className="title-bar">
      <div className="title-left">
        <img src="/fabric_logo.png" alt="FABRIC" className="fabric-logo" />
        <span className="title-text">FABRIC Visualization Suite</span>
      </div>
      <div className="title-right">
        <span className="mode-label">{modeLabel}</span>
        <button className="theme-toggle" onClick={onToggleDark}>
          {dark ? '\u2600' : '\u263E'}
          {dark ? ' Light' : ' Dark'}
        </button>
      </div>
    </div>
  );
}
