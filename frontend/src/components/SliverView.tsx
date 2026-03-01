import { useState, useMemo, useCallback, useRef } from 'react';
import type { SliceData } from '../types/fabric';
import '../styles/sliver-view.css';

interface SliverViewProps {
  sliceData: SliceData | null;
  selectedElement: Record<string, string> | null;
  onRowClick: (data: Record<string, string>) => void;
  onBackgroundClick: () => void;
  dark: boolean;
}

// --- VM rows ---

interface VMRow {
  type: string;
  name: string;
  site: string;
  host: string;
  state: string;
  cores: string;
  ram: string;
  disk: string;
  image: string;
  mgmtIp: string;
  components: string;
  interfaces: string;
  clickData: Record<string, string>;
}

type VMSortKey = keyof Pick<VMRow, 'type' | 'name' | 'site' | 'host' | 'state' | 'cores' | 'ram' | 'disk' | 'image' | 'mgmtIp' | 'components' | 'interfaces'>;

const VM_COLUMNS: { key: VMSortKey; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'name', label: 'Name' },
  { key: 'site', label: 'Site' },
  { key: 'host', label: 'Host' },
  { key: 'state', label: 'State' },
  { key: 'cores', label: 'Cores' },
  { key: 'ram', label: 'RAM' },
  { key: 'disk', label: 'Disk' },
  { key: 'image', label: 'Image' },
  { key: 'mgmtIp', label: 'Mgmt IP' },
  { key: 'components', label: 'Components' },
  { key: 'interfaces', label: 'Interfaces' },
];

// --- Network rows ---

interface NetRow {
  type: 'network' | 'facility-port';
  typeLabel: string;
  name: string;
  site: string;
  layerType: string;
  subnet: string;
  gateway: string;
  interfaces: string;
  interfaceList: string;
  clickData: Record<string, string>;
}

type NetSortKey = keyof Pick<NetRow, 'type' | 'name' | 'site' | 'layerType' | 'subnet' | 'gateway' | 'interfaces' | 'interfaceList'>;

const NET_COLUMNS: { key: NetSortKey; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'name', label: 'Name' },
  { key: 'site', label: 'Site' },
  { key: 'layerType', label: 'Layer / Type' },
  { key: 'subnet', label: 'Subnet' },
  { key: 'gateway', label: 'Gateway' },
  { key: 'interfaces', label: 'Ifaces' },
  { key: 'interfaceList', label: 'Connected Interfaces' },
];

// --- Shared helpers ---

function stateClass(state: string): string {
  const s = state.toLowerCase();
  if (s.includes('active')) return 'active';
  if (s.includes('configuring')) return 'configuring';
  if (s.includes('nascent')) return 'nascent';
  if (s.includes('closing')) return 'closing';
  if (s.includes('dead')) return 'dead';
  if (s.includes('ticketed')) return 'ticketed';
  if (s.includes('allocat')) return 'allocating';
  return '';
}

function genericSort<T>(rows: T[], column: keyof T, direction: 'asc' | 'desc', numericKeys: string[]): T[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    const av = String(a[column] ?? '');
    const bv = String(b[column] ?? '');
    if (numericKeys.includes(column as string)) {
      const an = parseFloat(av) || 0;
      const bn = parseFloat(bv) || 0;
      return direction === 'asc' ? an - bn : bn - an;
    }
    const al = av.toLowerCase();
    const bl = bv.toLowerCase();
    if (al < bl) return direction === 'asc' ? -1 : 1;
    if (al > bl) return direction === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}

// --- Main component ---

export default function SliverView({ sliceData, selectedElement, onRowClick, onBackgroundClick }: SliverViewProps) {
  const [vmSort, setVmSort] = useState<VMSortKey>('name');
  const [vmDir, setVmDir] = useState<'asc' | 'desc'>('asc');
  const [netSort, setNetSort] = useState<NetSortKey>('name');
  const [netDir, setNetDir] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');

  // Vertical resize: split percentage for VM panel (0-100)
  const [vmPct, setVmPct] = useState(60);
  const panelsRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    const startY = e.clientY;
    const startPct = vmPct;
    const container = panelsRef.current;
    if (!container) return;
    const containerHeight = container.getBoundingClientRect().height;

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = ev.clientY - startY;
      const deltaPct = (delta / containerHeight) * 100;
      const newPct = Math.min(85, Math.max(15, startPct + deltaPct));
      setVmPct(newPct);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [vmPct]);

  // Build VM rows
  const vmRows = useMemo<VMRow[]>(() => {
    if (!sliceData) return [];
    return sliceData.nodes.map(node => ({
      type: 'VM',
      name: node.name,
      site: node.site || '',
      host: node.host || '',
      state: node.reservation_state || '',
      cores: String(node.cores ?? ''),
      ram: node.ram ? `${node.ram} GB` : '',
      disk: node.disk ? `${node.disk} GB` : '',
      image: node.image || '',
      mgmtIp: node.management_ip || '',
      components: node.components?.map(c => `${c.name} (${c.model})`).join(', ') || '',
      interfaces: String(node.interfaces?.length ?? 0),
      clickData: {
        element_type: 'node',
        name: node.name,
        site: node.site || '',
        cores: String(node.cores ?? ''),
        ram: String(node.ram ?? ''),
        disk: String(node.disk ?? ''),
        image: node.image || '',
        reservation_state: node.reservation_state || '',
        management_ip: node.management_ip || '',
      },
    }));
  }, [sliceData]);

  // Build network + facility port rows
  const netRows = useMemo<NetRow[]>(() => {
    if (!sliceData) return [];
    const result: NetRow[] = [];
    for (const net of sliceData.networks) {
      result.push({
        type: 'network',
        typeLabel: 'Net',
        name: net.name,
        site: '',
        layerType: [net.layer, net.type].filter(Boolean).join(' / '),
        subnet: net.subnet || '',
        gateway: net.gateway || '',
        interfaces: String(net.interfaces?.length ?? 0),
        interfaceList: net.interfaces?.map(i => `${i.node_name}:${i.network_name}`).join(', ') || '',
        clickData: {
          element_type: 'network',
          name: net.name,
          layer: net.layer || '',
          type: net.type || '',
          subnet: net.subnet || '',
          gateway: net.gateway || '',
        },
      });
    }
    for (const fp of (sliceData.facility_ports ?? [])) {
      result.push({
        type: 'facility-port',
        typeLabel: 'FP',
        name: fp.name,
        site: fp.site || '',
        layerType: fp.bandwidth || '',
        subnet: '',
        gateway: '',
        interfaces: String(fp.interfaces?.length ?? 0),
        interfaceList: fp.interfaces?.map(i => `${i.node_name}:${i.network_name}`).join(', ') || '',
        clickData: {
          element_type: 'facility_port',
          name: fp.name,
          site: fp.site || '',
          vlan: fp.vlan || '',
          bandwidth: fp.bandwidth || '',
        },
      });
    }
    return result;
  }, [sliceData]);

  // Filter
  const lower = filterText.toLowerCase();
  const filteredVMs = useMemo(() => {
    if (!filterText) return vmRows;
    return vmRows.filter(r =>
      r.name.toLowerCase().includes(lower) ||
      r.site.toLowerCase().includes(lower) ||
      r.host.toLowerCase().includes(lower) ||
      r.state.toLowerCase().includes(lower) ||
      r.image.toLowerCase().includes(lower)
    );
  }, [vmRows, lower, filterText]);

  const filteredNets = useMemo(() => {
    if (!filterText) return netRows;
    return netRows.filter(r =>
      r.name.toLowerCase().includes(lower) ||
      r.site.toLowerCase().includes(lower) ||
      r.layerType.toLowerCase().includes(lower) ||
      r.typeLabel.toLowerCase().includes(lower)
    );
  }, [netRows, lower, filterText]);

  // Sort
  const sortedVMs = useMemo(() =>
    genericSort(filteredVMs, vmSort, vmDir, ['cores', 'ram', 'disk', 'interfaces']),
    [filteredVMs, vmSort, vmDir]);

  const sortedNets = useMemo(() =>
    genericSort(filteredNets, netSort, netDir, ['interfaces']),
    [filteredNets, netSort, netDir]);

  const handleVmHeader = (key: VMSortKey) => {
    if (vmSort === key) setVmDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setVmSort(key); setVmDir('asc'); }
  };

  const handleNetHeader = (key: NetSortKey) => {
    if (netSort === key) setNetDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setNetSort(key); setNetDir('asc'); }
  };

  const isSelected = (clickData: Record<string, string>) =>
    selectedElement?.name === clickData.name && selectedElement?.element_type === clickData.element_type;

  if (!sliceData) {
    return <div className="sliver-view"><div className="sliver-empty">No slice loaded</div></div>;
  }

  if (vmRows.length === 0 && netRows.length === 0) {
    return <div className="sliver-view"><div className="sliver-empty">No slivers in this slice</div></div>;
  }

  const totalCount = vmRows.length + netRows.length;
  const filteredCount = filteredVMs.length + filteredNets.length;

  return (
    <div className="sliver-view" onClick={(e) => { if (e.target === e.currentTarget) onBackgroundClick(); }} data-help-id="sliver.table">
      <div className="sliver-filter">
        <input
          type="text"
          placeholder="Filter by name, site, state, image..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        <span className="sliver-filter-count">
          {filteredCount} of {totalCount}
        </span>
      </div>

      <div className="sliver-panels" ref={panelsRef}>
        {/* VM Panel */}
        <div className="sliver-panel" style={{ flex: `0 0 calc(${vmPct}% - 3px)` }}>
          <div className="sliver-panel-header">
            <span className="sliver-panel-title">
              <span className="sliver-type-badge node">VM</span> Nodes
              <span className="sliver-panel-count">{filteredVMs.length}</span>
            </span>
          </div>
          {filteredVMs.length === 0 ? (
            <div className="sliver-panel-empty">{vmRows.length === 0 ? 'No VM nodes' : 'No matches'}</div>
          ) : (
            <div className="sliver-table-wrapper">
              <table className="sliver-table">
                <thead>
                  <tr>
                    {VM_COLUMNS.map(col => (
                      <th key={col.key} onClick={() => handleVmHeader(col.key)}>
                        {col.label}
                        <span className={`sort-arrow ${vmSort === col.key ? 'active' : ''}`}>
                          {vmSort === col.key ? (vmDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B4'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedVMs.map(row => (
                    <tr
                      key={row.name}
                      className={isSelected(row.clickData) ? 'selected' : ''}
                      onClick={() => onRowClick(row.clickData)}
                    >
                      <td><span className="sliver-type-badge node">{row.type}</span></td>
                      <td title={row.name}>{row.name}</td>
                      <td>{row.site || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td title={row.host}>{row.host || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>
                        {row.state
                          ? <span className={`sliver-state-badge ${stateClass(row.state)}`}>{row.state}</span>
                          : <span className="sliver-cell-muted">{'\u2014'}</span>
                        }
                      </td>
                      <td>{row.cores || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.ram || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.disk || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td title={row.image}>{row.image || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.mgmtIp || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td title={row.components}>{row.components || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.interfaces || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Resize handle */}
        <div className="sliver-resize-handle" onMouseDown={handleResizeStart}>
          <div className="sliver-resize-grip" />
        </div>

        {/* Network Services Panel */}
        <div className="sliver-panel" style={{ flex: `0 0 calc(${100 - vmPct}% - 3px)` }}>
          <div className="sliver-panel-header">
            <span className="sliver-panel-title">
              <span className="sliver-type-badge network">Net</span> Network Services
              <span className="sliver-panel-count">{filteredNets.length}</span>
            </span>
          </div>
          {filteredNets.length === 0 ? (
            <div className="sliver-panel-empty">{netRows.length === 0 ? 'No network services' : 'No matches'}</div>
          ) : (
            <div className="sliver-table-wrapper">
              <table className="sliver-table">
                <thead>
                  <tr>
                    {NET_COLUMNS.map(col => (
                      <th key={col.key} onClick={() => handleNetHeader(col.key)}>
                        {col.label}
                        <span className={`sort-arrow ${netSort === col.key ? 'active' : ''}`}>
                          {netSort === col.key ? (netDir === 'asc' ? '\u25B2' : '\u25BC') : '\u25B4'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedNets.map(row => (
                    <tr
                      key={`${row.type}-${row.name}`}
                      className={isSelected(row.clickData) ? 'selected' : ''}
                      onClick={() => onRowClick(row.clickData)}
                    >
                      <td><span className={`sliver-type-badge ${row.type}`}>{row.typeLabel}</span></td>
                      <td title={row.name}>{row.name}</td>
                      <td>{row.site || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.layerType || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.subnet || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.gateway || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                      <td>{row.interfaces}</td>
                      <td title={row.interfaceList}>{row.interfaceList || <span className="sliver-cell-muted">{'\u2014'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
