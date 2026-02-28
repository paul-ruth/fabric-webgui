import { useEffect, useRef } from 'react';
import { helpSections } from '../data/helpData';
import '../styles/help.css';

interface HelpViewProps {
  scrollToSection?: string;
  onClose: () => void;
}

export default function HelpView({ scrollToSection, onClose }: HelpViewProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (scrollToSection) {
      // Try entry-level scroll first (e.g. "toolbar.submit" → scroll to that card)
      const entryEl = document.getElementById(`help-entry-${scrollToSection}`);
      if (entryEl) {
        entryEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        entryEl.classList.add('help-entry-highlight');
        setTimeout(() => entryEl.classList.remove('help-entry-highlight'), 2000);
        return;
      }
      // Fall back to section-level scroll
      const sectionId = scrollToSection.split('.')[0];
      const el = sectionRefs.current[sectionId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [scrollToSection]);

  const handleSidebarClick = (sectionId: string) => {
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="help-view">
      <div className="help-sidebar">
        <div className="help-sidebar-title">Sections</div>
        {helpSections.map((s) => (
          <button
            key={s.id}
            className="help-sidebar-item"
            onClick={() => handleSidebarClick(s.id)}
          >
            {s.title}
          </button>
        ))}
      </div>
      <div className="help-content" ref={contentRef}>
        <div className="help-header">
          <h2 className="help-title">FABRIC Visualization Suite — Help</h2>
          <button className="help-back-btn" onClick={onClose}>
            Back
          </button>
        </div>
        {helpSections.map((section) => (
          <div
            key={section.id}
            className="help-section"
            ref={(el) => { sectionRefs.current[section.id] = el; }}
          >
            <h3 className="help-section-title">{section.title}</h3>
            {section.entries.map((entry) => (
              <div key={entry.id} className="help-entry-card" id={`help-entry-${entry.id}`}>
                <h4 className="help-entry-label">{entry.label}</h4>
                <p className="help-entry-desc">{entry.description}</p>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
