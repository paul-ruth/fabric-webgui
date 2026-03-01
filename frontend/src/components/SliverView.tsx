import { useState, useMemo } from 'react';
import type { SliceData } from '../types/fabric';
import '../styles/sliver-view.css';

interface SliverViewProps {
  sliceData: SliceData | null;
  selectedElement: Record<string, string> | null;
  onRowClick: (data: Record<string, string>) => void;
  onBackgroundClick: () => void;
  dark: boolean;
}

interface SliverRow {
  type: 'node' | 'network' | 'facility-port';
  typeLabel: string;
  name: string;
  site: string;
  state: string;
  cores: string;
  ram: string;
  disk: string;
  image: string;
  layerType: string;
  mgmtIp: string;
  components: string;
  interfaces: string;
  /** data payload for onRowClick — matches CytoscapeGraph onNodeClick shape */
  clickData: Record<string, string>;
}

type SortKey = keyof Pick<SliverRow, 'type' | 'name' | 'site' | 'state' | 'cores' | 'ram' | 'disk' | 'image' | 'layerType' | 'mgmtIp' | 'components' | 'interfaces'>;

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'name', label: 'Name' },
  { key: 'site', label: 'Site' },
  { key: 'state', label: 'State' },
  { key: 'cores', label: 'Cores' },
  { key: 'ram', label: 'RAM' },
  { key: 'disk', label: 'Disk' },
  { key: 'image', label: 'Image' },
  { key: 'layerType', label: 'Layer / Type' },
  { key: 'mgmtIp', label: 'Mgmt IP' },
  { key: 'components', label: 'Components' },
  { key: 'interfaces', label: 'Interfaces' },
];

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

export default function SliverView({ sliceData, selectedElement, onRowClick, onBackgroundClick, dark }: SliverViewProps) {
  const [sortColumn, setSortColumn] = useState<SortKey>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [filterText, setFilterText] = useState('');

  // Build unified rows
  const rows = useMemo<SliverRow[]>(() => {
    if (!sliceData) return [];
    const result: SliverRow[] = [];

    for (const node of sliceData.nodes) {
      result.push({
        type: 'node',
        typeLabel: 'VM',
        name: node.name,
        site: node.site || '',
        state: node.reservation_state || '',
        cores: String(node.cores ?? ''),
        ram: node.ram ? `${node.ram} GB` : '',
        disk: node.disk ? `${node.disk} GB` : '',
        image: node.image || '',
        layerType: '',
        mgmtIp: node.management_ip || '',
        components: String(node.components?.length ?? 0),
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
      });
    }

    for (const net of sliceData.networks) {
      result.push({
        type: 'network',
        typeLabel: 'Net',
        name: net.name,
        site: '',
        state: '',
        cores: '',
        ram: '',
        disk: '',
        image: '',
        layerType: [net.layer, net.type].filter(Boolean).join(' / '),
        mgmtIp: '',
        components: '',
        interfaces: String(net.interfaces?.length ?? 0),
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
        state: '',
        cores: '',
        ram: '',
        disk: '',
        image: '',
        layerType: fp.bandwidth || '',
        mgmtIp: '',
        components: '',
        interfaces: String(fp.interfaces?.length ?? 0),
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
  const filteredRows = useMemo(() => {
    if (!filterText) return rows;
    const lower = filterText.toLowerCase();
    return rows.filter(r =>
      r.name.toLowerCase().includes(lower) ||
      r.site.toLowerCase().includes(lower) ||
      r.state.toLowerCase().includes(lower) ||
      r.image.toLowerCase().includes(lower) ||
      r.typeLabel.toLowerCase().includes(lower) ||
      r.layerType.toLowerCase().includes(lower)
    );
  }, [rows, filterText]);

  // Sort
  const sortedRows = useMemo(() => {
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let av = a[sortColumn];
      let bv = b[sortColumn];
      // Numeric sort for cores, ram, disk, components, interfaces
      if (['cores', 'ram', 'disk', 'components', 'interfaces'].includes(sortColumn)) {
        const an = parseFloat(av) || 0;
        const bn = parseFloat(bv) || 0;
        return sortDirection === 'asc' ? an - bn : bn - an;
      }
      av = av.toLowerCase();
      bv = bv.toLowerCase();
      if (av < bv) return sortDirection === 'asc' ? -1 : 1;
      if (av > bv) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [filteredRows, sortColumn, sortDirection]);

  const handleHeaderClick = (key: SortKey) => {
    if (sortColumn === key) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(key);
      setSortDirection('asc');
    }
  };

  const isSelected = (row: SliverRow) =>
    selectedElement?.name === row.name && selectedElement?.element_type === row.clickData.element_type;

  if (!sliceData) {
    return <div className="sliver-view"><div className="sliver-empty">No slice loaded</div></div>;
  }

  if (rows.length === 0) {
    return <div className="sliver-view"><div className="sliver-empty">No slivers in this slice</div></div>;
  }

  return (
    <div className="sliver-view" onClick={(e) => { if (e.target === e.currentTarget) onBackgroundClick(); }} data-help-id="sliver.table">
      <div className="sliver-filter">
        <input
          type="text"
          placeholder="Filter slivers by name, site, state, image..."
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
        <span className="sliver-filter-count">
          {filteredRows.length} of {rows.length}
        </span>
      </div>
      <div className="sliver-table-wrapper" onClick={(e) => { if (e.target === e.currentTarget) onBackgroundClick(); }}>
        <table className="sliver-table">
          <thead>
            <tr>
              {COLUMNS.map(col => (
                <th key={col.key} onClick={() => handleHeaderClick(col.key)}>
                  {col.label}
                  <span className={`sort-arrow ${sortColumn === col.key ? 'active' : ''}`}>
                    {sortColumn === col.key ? (sortDirection === 'asc' ? '\u25B2' : '\u25BC') : '\u25B4'}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(row => (
              <tr
                key={`${row.type}-${row.name}`}
                className={isSelected(row) ? 'selected' : ''}
                onClick={() => onRowClick(row.clickData)}
              >
                <td><span className={`sliver-type-badge ${row.type}`}>{row.typeLabel}</span></td>
                <td title={row.name}>{row.name}</td>
                <td>{row.site || <span className="sliver-cell-muted">—</span>}</td>
                <td>
                  {row.state
                    ? <span className={`sliver-state-badge ${stateClass(row.state)}`}>{row.state}</span>
                    : <span className="sliver-cell-muted">—</span>
                  }
                </td>
                <td>{row.cores || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.ram || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.disk || <span className="sliver-cell-muted">—</span>}</td>
                <td title={row.image}>{row.image || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.layerType || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.mgmtIp || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.components || <span className="sliver-cell-muted">—</span>}</td>
                <td>{row.interfaces || <span className="sliver-cell-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
