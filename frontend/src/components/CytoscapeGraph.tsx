import { useState, useEffect, useRef, useCallback } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type { CyGraph } from '../types/fabric';
import '../styles/context-menu.css';

// Register layout extensions
import dagre from 'cytoscape-dagre';
import cola from 'cytoscape-cola';
cytoscape.use(dagre);
cytoscape.use(cola);

/** Build Cytoscape stylesheet, adapting colors for dark/light mode */
function buildStylesheet(dark: boolean): any[] {
  const bg = dark ? '#1a1a2e' : '#edf2f8';
  const containerBorder = dark ? '#4a4a6a' : '#c5cfd8';
  const containerLabel = dark ? '#8888aa' : '#838385';
  const vmText = dark ? '#e0e0e0' : '#212121';
  const edgeLabelBg = dark ? '#16213e' : '#ffffff';
  const edgeText = dark ? '#c0c0c0' : '#374955';
  const l2Color = dark ? '#5bb8d9' : '#1f6a8c';
  const l2NodeBg = dark ? '#1a3050' : '#ddeaf2';
  const l3Color = dark ? '#2bb5a0' : '#008e7a';
  const l3NodeBg = dark ? '#1a3a30' : '#e0f2f1';
  const selectOverlay = dark ? '#ffa562' : '#ff8542';

  return [
    { selector: '.slice', style: {
      'shape': 'roundrectangle', 'border-width': 2, 'border-style': 'dashed',
      'border-color': containerBorder, 'background-color': bg, 'background-opacity': 0.3,
      'padding': '30px', 'label': 'data(label)', 'text-valign': 'top', 'text-halign': 'center',
      'font-size': '14px', 'font-weight': 'bold', 'color': containerLabel,
      'font-family': 'Montserrat, sans-serif',
    }},
    { selector: '.vm', style: {
      'shape': 'roundrectangle', 'width': 180, 'height': 70,
      'background-color': dark ? 'data(state_bg_dark)' : 'data(state_bg)',
      'border-width': 2, 'border-color': dark ? 'data(state_color_dark)' : 'data(state_color)',
      'label': 'data(label)', 'text-valign': 'center', 'text-halign': 'center',
      'font-size': '10px', 'text-wrap': 'wrap', 'text-max-width': '170px',
      'color': vmText, 'font-family': 'Montserrat, sans-serif',
    }},
    { selector: '.network-l2', style: {
      'shape': 'ellipse', 'width': 90, 'height': 80, 'background-color': l2NodeBg,
      'border-width': 2, 'border-color': l2Color, 'label': 'data(label)',
      'text-valign': 'center', 'text-halign': 'center', 'font-size': '9px',
      'text-wrap': 'wrap', 'text-max-width': '80px', 'color': l2Color,
      'font-family': 'Montserrat, sans-serif',
    }},
    { selector: '.network-l3', style: {
      'shape': 'ellipse', 'width': 90, 'height': 80, 'background-color': l3NodeBg,
      'border-width': 2, 'border-color': l3Color, 'label': 'data(label)',
      'text-valign': 'center', 'text-halign': 'center', 'font-size': '9px',
      'text-wrap': 'wrap', 'text-max-width': '80px', 'color': l3Color,
      'font-family': 'Montserrat, sans-serif',
    }},
    { selector: '.edge-l2', style: {
      'width': 3, 'line-color': l2Color, 'target-arrow-color': l2Color,
      'curve-style': 'unbundled-bezier', 'label': 'data(label)', 'font-size': '8px',
      'text-rotation': 'autorotate', 'text-background-color': edgeLabelBg,
      'text-background-opacity': 1, 'text-background-padding': '2px', 'text-wrap': 'wrap',
      'color': edgeText, 'font-family': 'Montserrat, sans-serif',
    }},
    { selector: '.edge-l3', style: {
      'width': 2, 'line-color': l3Color, 'line-style': 'dashed',
      'target-arrow-color': l3Color, 'curve-style': 'unbundled-bezier',
      'label': 'data(label)', 'font-size': '8px', 'text-rotation': 'autorotate',
      'text-background-color': edgeLabelBg, 'text-background-opacity': 1,
      'text-background-padding': '2px', 'text-wrap': 'wrap', 'color': edgeText,
      'font-family': 'Montserrat, sans-serif',
    }},
    { selector: ':selected', style: {
      'overlay-color': selectOverlay, 'overlay-opacity': 0.2, 'overlay-padding': 6,
    }},
  ];
}

/** Layout presets matching fabvis layouts.py */
const LAYOUTS: Record<string, any> = {
  dagre: { name: 'dagre', rankDir: 'TB', rankSep: 100, nodeSep: 60, animate: true, animationDuration: 300 },
  cola: { name: 'cola', nodeSpacing: 60, animate: true, maxSimulationTime: 2000 },
  breadthfirst: { name: 'breadthfirst', spacingFactor: 1.5, animate: true, animationDuration: 300 },
  grid: { name: 'grid', condense: true, animate: true, animationDuration: 300 },
  concentric: { name: 'concentric', minNodeSpacing: 50, animate: true, animationDuration: 300 },
  cose: { name: 'cose', animate: true, animationDuration: 300 },
};

export interface ContextMenuAction {
  type: 'terminal' | 'delete';
  elements: Record<string, string>[];
}

interface CytoscapeGraphProps {
  graph: CyGraph | null;
  layout: string;
  dark: boolean;
  onLayoutChange: (layout: string) => void;
  onNodeClick: (data: Record<string, string>) => void;
  onEdgeClick: (data: Record<string, string>) => void;
  onBackgroundClick: () => void;
  onContextAction: (action: ContextMenuAction) => void;
}

interface MenuState {
  x: number;
  y: number;
  selected: Record<string, string>[];
}

export default function CytoscapeGraph({
  graph,
  layout,
  dark,
  onLayoutChange,
  onNodeClick,
  onEdgeClick,
  onBackgroundClick,
  onContextAction,
}: CytoscapeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Close context menu on clicks or escape
  const menuOpenTime = useRef(0);
  useEffect(() => {
    if (!menu) return;
    menuOpenTime.current = Date.now();
    const close = () => {
      if (Date.now() - menuOpenTime.current < 100) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // Initialize cytoscape
  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      style: buildStylesheet(dark),
      minZoom: 0.2,
      maxZoom: 3,
      wheelSensitivity: 0.3,
      selectionType: 'additive',
      boxSelectionEnabled: true,
    });

    cyRef.current = cy;

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Resize cytoscape when container dimensions change
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      cyRef.current?.resize();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Update stylesheet when dark mode changes
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.style(buildStylesheet(dark) as any);
  }, [dark]);

  // Handle left-click events
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const handleNodeClick = (e: EventObject) => {
      onNodeClick(e.target.data());
    };
    const handleEdgeClick = (e: EventObject) => {
      onEdgeClick(e.target.data());
    };
    const handleBgClick = (e: EventObject) => {
      if (e.target === cy) onBackgroundClick();
    };

    cy.on('tap', 'node', handleNodeClick);
    cy.on('tap', 'edge', handleEdgeClick);
    cy.on('tap', handleBgClick);

    return () => {
      cy.off('tap', 'node', handleNodeClick);
      cy.off('tap', 'edge', handleEdgeClick);
      cy.off('tap', handleBgClick);
    };
  }, [onNodeClick, onEdgeClick, onBackgroundClick]);

  // Right-click context menu: prevent native menu + show custom one
  const onContextActionRef = useRef(onContextAction);
  onContextActionRef.current = onContextAction;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Suppress native context menu on the entire graph panel
    const suppress = (e: MouseEvent) => {
      e.preventDefault();
    };
    container.addEventListener('contextmenu', suppress);

    // Use mouseup with button===2 to show menu after right-click release
    const handleRightClick = (e: MouseEvent) => {
      if (e.button !== 2) return;

      const cy = cyRef.current;
      if (!cy) return;

      // Project screen coords to cytoscape model coords
      const r = (cy as any)._private.renderer;
      if (!r) return;
      const pos = r.projectIntoViewport(e.clientX, e.clientY);
      const near = r.findNearestElement(pos[0], pos[1], true, false);

      if (!near || near.isEdge() || near.hasClass('slice')) return;

      // If the right-clicked element isn't already selected, make it the sole selection
      if (!near.selected()) {
        cy.elements().unselect();
        near.select();
      }

      // Gather all selected non-container nodes
      const selected = cy.nodes(':selected').filter((n: any) => !n.hasClass('slice'));
      if (selected.length === 0) return;

      const items: Record<string, string>[] = [];
      selected.forEach((n: any) => { items.push(n.data()); });

      setMenu({ x: e.clientX, y: e.clientY, selected: items });
    };

    container.addEventListener('mouseup', handleRightClick);

    return () => {
      container.removeEventListener('contextmenu', suppress);
      container.removeEventListener('mouseup', handleRightClick);
    };
  }, []);

  // Update graph data
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) return;

    cy.elements().remove();

    const elements: cytoscape.ElementDefinition[] = [
      ...graph.nodes.map((n) => ({
        group: 'nodes' as const,
        data: n.data,
        classes: n.classes,
      })),
      ...graph.edges.map((e) => ({
        group: 'edges' as const,
        data: e.data,
        classes: e.classes,
      })),
    ];

    cy.add(elements);

    const layoutConfig = LAYOUTS[layout] || LAYOUTS.dagre;
    cy.layout(layoutConfig).run();

    setTimeout(() => cy.fit(undefined, 30), 500);
  }, [graph, layout]);

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 30);
  }, []);

  const handleExport = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const exportBg = dark ? '#1a1a2e' : '#ffffff';
    const png = cy.png({ full: true, scale: 2, bg: exportBg });
    const link = document.createElement('a');
    link.download = 'fabric-slice.png';
    link.href = png;
    link.click();
  }, [dark]);

  // Context menu helpers
  const vmsWithIp = menu?.selected.filter(
    (el) => el.element_type === 'node' && el.management_ip
  ) ?? [];
  const deletable = menu?.selected.filter(
    (el) => el.element_type === 'node' || el.element_type === 'network'
  ) ?? [];

  const handleTerminal = () => {
    if (vmsWithIp.length > 0) {
      onContextAction({ type: 'terminal', elements: vmsWithIp });
    }
    setMenu(null);
  };

  const handleDelete = () => {
    if (deletable.length > 0) {
      onContextAction({ type: 'delete', elements: deletable });
    }
    setMenu(null);
  };

  return (
    <div className="graph-panel">
      <div className="cytoscape-container" ref={containerRef} />
      <div className="graph-controls">
        <label>Layout:</label>
        <select value={layout} onChange={(e) => onLayoutChange(e.target.value)}>
          {Object.keys(LAYOUTS).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button onClick={handleFit}>Fit</button>
        <button onClick={handleExport} title="Export as PNG">Export</button>
      </div>

      {menu && (
        <div
          className="graph-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          {menu.selected.length > 1 && (
            <div className="graph-context-menu-label">
              {menu.selected.length} selected
            </div>
          )}
          {vmsWithIp.length > 0 && (
            <button className="graph-context-menu-item" onClick={handleTerminal}>
              ▸ Open Terminal{vmsWithIp.length > 1 ? ` (${vmsWithIp.length})` : ''}
            </button>
          )}
          {vmsWithIp.length > 0 && deletable.length > 0 && (
            <div className="graph-context-menu-sep" />
          )}
          {deletable.length > 0 && (
            <button className="graph-context-menu-item danger" onClick={handleDelete}>
              ✕ Delete{deletable.length > 1 ? ` (${deletable.length})` : ''}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { LAYOUTS };
