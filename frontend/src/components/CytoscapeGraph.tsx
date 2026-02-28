import { useState, useEffect, useRef, useCallback } from 'react';
import cytoscape, { type Core, type EventObject } from 'cytoscape';
import type { CyGraph, SliceData } from '../types/fabric';
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
  const fpColor = dark ? '#ffa562' : '#ff8542';
  const fpNodeBg = dark ? '#3a2008' : '#fff3e0';
  const selectOverlay = dark ? '#ffa562' : '#ff8542';

  // Component badge colors by type
  const nicColor = dark ? '#5bb8d9' : '#1f6a8c';
  const gpuColor = dark ? '#66bb6a' : '#2e7d32';
  const fpgaColor = dark ? '#ba68c8' : '#7b1fa2';
  const nvmeColor = dark ? '#ffa726' : '#e65100';
  const compText = dark ? '#e0e0e0' : '#ffffff';

  return [
    { selector: '.slice', style: {
      'shape': 'roundrectangle', 'border-width': 2, 'border-style': 'dashed',
      'border-color': containerBorder, 'background-color': bg, 'background-opacity': 0.3,
      'padding': '30px', 'label': 'data(label)', 'text-valign': 'top', 'text-halign': 'center',
      'font-size': '14px', 'font-weight': 'bold', 'color': containerLabel,
      'font-family': 'Montserrat, sans-serif',
    }},
    // VM nodes — always fixed size with centered label
    { selector: '.vm', style: {
      'shape': 'roundrectangle', 'width': 180, 'height': 70,
      'background-color': dark ? 'data(state_bg_dark)' : 'data(state_bg)',
      'border-width': 2, 'border-color': dark ? 'data(state_color_dark)' : 'data(state_color)',
      'label': 'data(label)', 'text-valign': 'center', 'text-halign': 'center',
      'font-size': '10px', 'text-wrap': 'wrap', 'text-max-width': '170px',
      'color': vmText, 'font-family': 'Montserrat, sans-serif',
    }},
    // Component badge nodes — small pills that sit at VM edges
    { selector: '.component', style: {
      'shape': 'roundrectangle', 'width': 'label', 'height': 20,
      'padding': '6px',
      'label': 'data(label)', 'text-valign': 'center', 'text-halign': 'center',
      'font-size': '8px', 'font-weight': 'bold',
      'font-family': 'Montserrat, sans-serif',
      'border-width': 1.5, 'border-opacity': 0.9,
      'color': compText,
      'z-index': 10,
    }},
    { selector: '.component-nic', style: {
      'background-color': nicColor, 'border-color': nicColor, 'color': compText,
    }},
    { selector: '.component-gpu', style: {
      'background-color': gpuColor, 'border-color': gpuColor, 'color': compText,
    }},
    { selector: '.component-fpga', style: {
      'background-color': fpgaColor, 'border-color': fpgaColor, 'color': compText,
    }},
    { selector: '.component-nvme', style: {
      'background-color': nvmeColor, 'border-color': nvmeColor, 'color': compText,
    }},
    // Hidden components (when toggled off)
    { selector: '.component-hidden', style: {
      'display': 'none',
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
    { selector: '.facility-port', style: {
      'shape': 'diamond', 'width': 80, 'height': 70, 'background-color': fpNodeBg,
      'border-width': 2, 'border-color': fpColor, 'label': 'data(label)',
      'text-valign': 'center', 'text-halign': 'center', 'font-size': '9px',
      'text-wrap': 'wrap', 'text-max-width': '70px', 'color': fpColor,
      'font-family': 'Montserrat, sans-serif',
    }},
    { selector: ':selected', style: {
      'overlay-color': selectOverlay, 'overlay-opacity': 0.2, 'overlay-padding': 6,
    }},
  ];
}

/**
 * Position component badge nodes at the bottom edge of their parent VM,
 * overlapping the border so they look attached. Badges are spread
 * horizontally and locked in place.
 */
function positionComponentsAtVmEdge(cy: Core) {
  const compNodes = cy.nodes('.component').not('.component-hidden');
  if (compNodes.empty()) return;

  // Group components by parent VM
  const byVm: Record<string, any[]> = {};
  compNodes.forEach((n: any) => {
    const vmId = n.data('parent_vm');
    if (!vmId) return;
    if (!byVm[vmId]) byVm[vmId] = [];
    byVm[vmId].push(n);
  });

  for (const [vmId, comps] of Object.entries(byVm)) {
    const vm = cy.getElementById(vmId);
    if (vm.empty()) continue;

    const vmPos = vm.position();
    const vmH = 70;  // fixed VM height from stylesheet

    // Spread components horizontally along the bottom edge
    const spacing = 50;
    const totalWidth = (comps.length - 1) * spacing;
    const startX = vmPos.x - totalWidth / 2;

    comps.forEach((comp: any, i: number) => {
      comp.unlock();
      comp.position({
        x: startX + i * spacing,
        y: vmPos.y + vmH / 2,  // bottom edge of VM
      });
      comp.lock();
    });
  }
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
  type: 'terminal' | 'delete' | 'delete-component' | 'delete-facility-port';
  elements: Record<string, string>[];
  nodeName?: string;
  componentName?: string;
  fpName?: string;
}

interface CytoscapeGraphProps {
  graph: CyGraph | null;
  layout: string;
  dark: boolean;
  sliceData: SliceData | null;
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
  sliceData,
  onLayoutChange,
  onNodeClick,
  onEdgeClick,
  onBackgroundClick,
  onContextAction,
}: CytoscapeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [showComponents, setShowComponents] = useState(true);
  const showComponentsRef = useRef(showComponents);
  showComponentsRef.current = showComponents;

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

    // Keep component badges attached to their parent VM during drag
    cy.on('drag', '.vm', (e: any) => {
      const vm = e.target;
      const vmId = vm.id();
      const vmPos = vm.position();
      const comps = cy.nodes('.component').filter((n: any) => n.data('parent_vm') === vmId && !n.hasClass('component-hidden'));
      if (comps.empty()) return;

      const spacing = 50;
      const total = (comps.length - 1) * spacing;
      const startX = vmPos.x - total / 2;

      comps.forEach((comp: any, i: number) => {
        comp.unlock();
        comp.position({
          x: startX + i * spacing,
          y: vmPos.y + 35,
        });
        comp.lock();
      });
    });

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
      const node = e.target;
      // Component badge clicked — delegate to parent VM
      if (node.hasClass('component')) {
        const vmId = node.data('parent_vm');
        if (vmId) {
          const vm = cy.getElementById(vmId);
          if (!vm.empty()) {
            onNodeClick(vm.data());
            return;
          }
        }
      }
      onNodeClick(node.data());
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

    const suppress = (e: MouseEvent) => { e.preventDefault(); };
    container.addEventListener('contextmenu', suppress);

    const handleRightClick = (e: MouseEvent) => {
      if (e.button !== 2) return;

      const cy = cyRef.current;
      if (!cy) return;

      const r = (cy as any)._private.renderer;
      if (!r) return;
      const pos = r.projectIntoViewport(e.clientX, e.clientY);
      const near = r.findNearestElement(pos[0], pos[1], true, false);

      if (!near || near.isEdge() || near.hasClass('slice')) return;

      // If right-clicked a component badge, target its parent VM instead
      let target = near;
      if (near.hasClass('component')) {
        const vmId = near.data('parent_vm');
        if (vmId) {
          const vm = cy.getElementById(vmId);
          if (!vm.empty()) target = vm;
          else return;
        } else return;
      }

      if (!target.selected()) {
        cy.elements().unselect();
        target.select();
      }

      const selected = cy.nodes(':selected').filter((n: any) => !n.hasClass('slice') && !n.hasClass('component'));
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

    // Apply component visibility before layout
    applyComponentVisibility(cy, showComponentsRef.current);

    // Run layout on non-component elements; then position components at VM edges
    const layoutElements = cy.elements().not('.component');
    const lay = layoutElements.layout(LAYOUTS[layout] || LAYOUTS.dagre);
    lay.on('layoutstop', () => {
      if (showComponentsRef.current) {
        positionComponentsAtVmEdge(cy);
      }
      setTimeout(() => cy.fit(undefined, 30), 100);
    });
    lay.run();
  }, [graph, layout]);

  // Toggle component visibility
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    applyComponentVisibility(cy, showComponents);
    if (showComponents) {
      positionComponentsAtVmEdge(cy);
    }
  }, [showComponents]);

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
    (el) => el.element_type === 'node' || el.element_type === 'network' || el.element_type === 'facility-port'
  ) ?? [];

  const singleVm = menu?.selected.length === 1 && menu.selected[0].element_type === 'node'
    ? menu.selected[0] : null;
  const vmComponents = singleVm
    ? (sliceData?.nodes.find((n) => n.name === singleVm.name)?.components ?? [])
    : [];

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

  const handleDeleteComponent = (nodeName: string, compName: string) => {
    onContextAction({ type: 'delete-component', elements: [], nodeName, componentName: compName });
    setMenu(null);
  };

  return (
    <div className="graph-panel">
      <div className="cytoscape-container" ref={containerRef} />
      <div className="graph-controls">
        <label>Layout:</label>
        <select value={layout} onChange={(e) => onLayoutChange(e.target.value)} data-help-id="topology.layout">
          {Object.keys(LAYOUTS).map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button onClick={handleFit} data-help-id="topology.fit">Fit</button>
        <button onClick={handleExport} title="Save graph as PNG image" data-help-id="topology.export">Save PNG</button>
        <span className="graph-controls-sep" />
        <label className="graph-toggle">
          <input
            type="checkbox"
            checked={showComponents}
            onChange={(e) => setShowComponents(e.target.checked)}
          />
          Components
        </label>
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
          {vmComponents.length > 0 && vmsWithIp.length > 0 && (
            <div className="graph-context-menu-sep" />
          )}
          {vmComponents.length > 0 && singleVm && (
            <>
              <div className="graph-context-menu-label">Components</div>
              {vmComponents.map((comp) => (
                <button
                  key={comp.name}
                  className="graph-context-menu-item component-delete"
                  onClick={() => handleDeleteComponent(singleVm.name, comp.name)}
                >
                  <span className="component-info">{comp.name} <span className="component-model">{comp.model}</span></span>
                  <span className="component-delete-icon">✕</span>
                </button>
              ))}
            </>
          )}
          {deletable.length > 0 && (vmsWithIp.length > 0 || vmComponents.length > 0) && (
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

/**
 * Show or hide component badge nodes and re-route edges accordingly.
 * When components are visible, edges go from component nodes to networks.
 * When hidden, edges fall back to the parent VM node.
 */
function applyComponentVisibility(cy: Core, show: boolean) {
  cy.batch(() => {
    const compNodes = cy.nodes('.component');

    if (show) {
      compNodes.removeClass('component-hidden');
      // Route edges from component nodes (restore original source)
      cy.edges().forEach((edge: any) => {
        const sourceComp = edge.data('source_comp');
        if (sourceComp && edge.data('source') !== sourceComp) {
          edge.move({ source: sourceComp });
        }
      });
    } else {
      compNodes.addClass('component-hidden');
      // Route edges from VM nodes (fallback source)
      cy.edges().forEach((edge: any) => {
        const sourceVm = edge.data('source_vm');
        if (sourceVm && edge.data('source') !== sourceVm) {
          edge.move({ source: sourceVm });
        }
      });
    }
  });
}

export { LAYOUTS };
