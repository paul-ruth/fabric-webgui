import { useState, useRef, useEffect } from 'react';
import type { VMTemplateSummary } from '../../types/fabric';
import '../../styles/image-combo.css';

interface ImageComboBoxProps {
  images: string[];
  vmTemplates: VMTemplateSummary[];
  value: string;
  onSelect: (image: string, vmTemplate?: VMTemplateSummary) => void;
}

export default function ImageComboBox({ images, vmTemplates, value, onSelect }: ImageComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const lowerFilter = filter.toLowerCase();

  const filteredTemplates = vmTemplates.filter(
    (t) => t.name.toLowerCase().includes(lowerFilter) || t.description.toLowerCase().includes(lowerFilter)
  );
  const filteredImages = images.filter((i) => i.toLowerCase().includes(lowerFilter));

  // Check if current value matches a VM template
  const activeTemplate = vmTemplates.find((t) => t.name === value || t.dir_name === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter('');
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="image-combo" ref={dropdownRef}>
      <div
        className="image-combo-input"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        {open ? (
          <input
            ref={inputRef}
            className="image-combo-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search images or templates..."
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setOpen(false);
                setFilter('');
              }
            }}
          />
        ) : (
          <span className="image-combo-display">
            <span className="image-combo-name">
              {activeTemplate ? activeTemplate.name : value}
            </span>
            {activeTemplate ? (
              <span className="image-badge image-badge-tpl">TPL</span>
            ) : (
              <span className="image-badge image-badge-img">IMG</span>
            )}
          </span>
        )}
        <span className="image-combo-arrow">{open ? '\u25B2' : '\u25BC'}</span>
      </div>

      {open && (
        <div className="image-combo-dropdown">
          {filteredTemplates.length === 0 && filteredImages.length === 0 ? (
            <div className="image-combo-empty">No matches</div>
          ) : (
            <>
              {filteredTemplates.length > 0 && (
                <div>
                  <div className="image-combo-group">VM Templates</div>
                  {filteredTemplates.map((t) => (
                    <div
                      key={`tpl:${t.dir_name}`}
                      className="image-combo-option"
                      onClick={() => {
                        onSelect(t.image, t);
                        setOpen(false);
                        setFilter('');
                      }}
                    >
                      <div className="image-combo-opt-info">
                        <span className="image-combo-opt-name">{t.name}</span>
                        {t.description && (
                          <span className="image-combo-opt-desc">{t.description}</span>
                        )}
                      </div>
                      <span className="image-badge image-badge-tpl">TPL</span>
                    </div>
                  ))}
                </div>
              )}
              {filteredImages.length > 0 && (
                <div>
                  <div className="image-combo-group">OS Images</div>
                  {filteredImages.map((img) => (
                    <div
                      key={`img:${img}`}
                      className={`image-combo-option ${img === value && !activeTemplate ? 'selected' : ''}`}
                      onClick={() => {
                        onSelect(img);
                        setOpen(false);
                        setFilter('');
                      }}
                    >
                      <span className="image-combo-opt-name">{img}</span>
                      <span className="image-badge image-badge-img">IMG</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
