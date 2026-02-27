import { useState, useEffect, useRef } from 'react';
import type { SliceData, SliceNode, SliceNetwork, SiteDetail, SiteMetrics, LinkMetrics, PrometheusResult } from '../types/fabric';
import { getSiteDetail, getSiteMetrics, getLinkMetrics } from '../api/client';
import '../styles/editor.css';

interface DetailPanelProps {
  sliceData: SliceData | null;
  selectedElement: Record<string, string> | null;
  onCollapse?: () => void;
}

export default function DetailPanel({ sliceData, selectedElement, onCollapse }: DetailPanelProps) {
  if (!selectedElement) {
    return (
      <div className="detail-panel">
        <div className="detail-header">
          <span>Details</span>
          {onCollapse && <button className="collapse-btn" onClick={onCollapse} title="Collapse detail panel">▶</button>}
        </div>
        <div className="detail-body">
          <div className="detail-empty">Click an element to view details</div>
        </div>
      </div>
    );
  }

  const elementType = selectedElement.element_type;

  const typeLabels: Record<string, string> = {
    node: 'Node',
    network: 'Network',
    interface: 'Interface',
    slice: 'Slice',
    site: 'Site',
    infra_link: 'Link',
  };

  const hasTabs = elementType === 'site' || elementType === 'infra_link';

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <span>
          {typeLabels[elementType] ?? elementType}
          {' — '}
          {selectedElement.name || selectedElement.label}
        </span>
        {onCollapse && <button className="collapse-btn" onClick={onCollapse} title="Collapse detail panel">▶</button>}
      </div>
      <div className="detail-body">
        {elementType === 'node' && sliceData && <NodeDetail node={findNode(sliceData, selectedElement.name)} data={selectedElement} />}
        {elementType === 'network' && sliceData && <NetworkDetail network={findNetwork(sliceData, selectedElement.name)} data={selectedElement} />}
        {elementType === 'interface' && <InterfaceDetail data={selectedElement} />}
        {elementType === 'slice' && sliceData && <SliceDetailView data={selectedElement} sliceData={sliceData} />}
        {elementType === 'site' && <SiteTabbedDetail data={selectedElement} />}
        {elementType === 'infra_link' && <LinkTabbedDetail data={selectedElement} />}
      </div>
    </div>
  );
}

function PropTable({ rows }: { rows: [string, string | number | undefined][] }) {
  return (
    <table>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <td className="label-cell">{label}</td>
            <td>{value ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NodeDetail({ node, data }: { node: SliceNode | null; data: Record<string, string> }) {
  return (
    <>
      <PropTable rows={[
        ['Name', data.name],
        ['Site', data.site],
        ['Host', data.host || '—'],
        ['State', data.state],
        ['Cores', data.cores],
        ['RAM', `${data.ram} GB`],
        ['Disk', `${data.disk} GB`],
        ['Image', data.image || '—'],
        ['Mgmt IP', data.management_ip || '—'],
        ['Username', data.username || '—'],
      ]} />

      {node?.components && node.components.length > 0 && (
        <>
          <div className="section-title">Components</div>
          <table>
            <thead>
              <tr><th>Name</th><th>Model</th></tr>
            </thead>
            <tbody>
              {node.components.map((c) => (
                <tr key={c.name}>
                  <td>{c.name}</td>
                  <td>{c.model}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {node?.interfaces && node.interfaces.length > 0 && (
        <>
          <div className="section-title">Interfaces</div>
          <table>
            <thead>
              <tr><th>Name</th><th>Network</th><th>VLAN</th></tr>
            </thead>
            <tbody>
              {node.interfaces.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td>{i.network_name || '—'}</td>
                  <td>{i.vlan || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function NetworkDetail({ network, data }: { network: SliceNetwork | null; data: Record<string, string> }) {
  return (
    <>
      <PropTable rows={[
        ['Name', data.name],
        ['Type', data.type],
        ['Layer', data.layer],
        ['Subnet', data.subnet || '—'],
        ['Gateway', data.gateway || '—'],
      ]} />

      {network?.interfaces && network.interfaces.length > 0 && (
        <>
          <div className="section-title">Connected Interfaces</div>
          <table>
            <thead>
              <tr><th>Interface</th><th>Node</th><th>IP</th></tr>
            </thead>
            <tbody>
              {network.interfaces.map((i) => (
                <tr key={i.name}>
                  <td>{i.name}</td>
                  <td>{i.node_name}</td>
                  <td>{i.ip_addr || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function InterfaceDetail({ data }: { data: Record<string, string> }) {
  return (
    <PropTable rows={[
      ['Interface', data.interface_name],
      ['Node', data.node_name],
      ['Network', data.network_name],
      ['VLAN', data.vlan || '—'],
      ['MAC', data.mac || '—'],
      ['IP', data.ip_addr || '—'],
      ['Bandwidth', data.bandwidth || '—'],
    ]} />
  );
}

function SliceDetailView({ data, sliceData }: { data: Record<string, string>; sliceData: SliceData }) {
  return (
    <>
      <PropTable rows={[
        ['Name', sliceData.name],
        ['ID', sliceData.id],
        ['State', sliceData.state],
        ['Lease End', sliceData.lease_end || '—'],
        ['Nodes', String(sliceData.nodes.length)],
        ['Networks', String(sliceData.networks.length)],
      ]} />
    </>
  );
}

/* ============ Site Tabbed Detail ============ */

function SiteTabbedDetail({ data }: { data: Record<string, string> }) {
  const [tab, setTab] = useState<'resources' | 'metrics'>('resources');
  const elementKey = data.name;

  // Reset tab when site changes
  useEffect(() => { setTab('resources'); }, [elementKey]);

  return (
    <>
      <div className="detail-tabs">
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>Resources</button>
        <button className={tab === 'metrics' ? 'active' : ''} onClick={() => setTab('metrics')}>Metrics</button>
      </div>
      {tab === 'resources' && <SiteResourcesTab data={data} />}
      {tab === 'metrics' && <SiteMetricsTab siteName={data.name} />}
    </>
  );
}

function SiteResourcesTab({ data }: { data: Record<string, string> }) {
  const [siteDetail, setSiteDetail] = useState<SiteDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSiteDetail(data.name)
      .then((d) => { if (!cancelled) setSiteDetail(d); })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [data.name]);

  return (
    <>
      <PropTable rows={[
        ['Name', data.name],
        ['State', data.state || '—'],
        ['Hosts', data.hosts || '—'],
        ['Location', `${data.lat}, ${data.lon}`],
      ]} />
      <div className="section-title">Compute Resources</div>
      <PropTable rows={[
        ['Cores', `${data.cores_available} / ${data.cores_capacity} available`],
        ['RAM', `${data.ram_available} / ${data.ram_capacity} GB available`],
        ['Disk', `${data.disk_available} / ${data.disk_capacity} GB available`],
      ]} />

      {loading && <div className="detail-loading">Loading component details...</div>}
      {error && <div className="metrics-error">Failed to load components</div>}
      {siteDetail && Object.keys(siteDetail.components).length > 0 && (
        <>
          <div className="section-title">Components</div>
          <table>
            <thead>
              <tr><th>Type</th><th>Avail</th><th>Alloc</th><th>Total</th></tr>
            </thead>
            <tbody>
              {Object.entries(siteDetail.components).map(([name, res]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{res.available}</td>
                  <td>{res.allocated}</td>
                  <td>{res.capacity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {siteDetail && Object.keys(siteDetail.components).length === 0 && (
        <div className="detail-loading">No specialized components at this site</div>
      )}
    </>
  );
}

function SiteMetricsTab({ siteName }: { siteName: string }) {
  const [metrics, setMetrics] = useState<SiteMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = () => {
    getSiteMetrics(siteName)
      .then((m) => { setMetrics(m); setError(null); setLastUpdated(new Date()); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setMetrics(null);
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [siteName]);

  if (loading && !metrics) return <div className="detail-loading">Loading metrics...</div>;
  if (error && !metrics) return <div className="metrics-error">Failed to load metrics: {error}</div>;
  if (!metrics) return null;

  // Build CPU load table: group by worker instance
  const workers = new Map<string, { load1?: string; load5?: string; load15?: string }>();
  for (const r of metrics.node_load1) {
    const instance = r.metric.instance || r.metric.job || 'unknown';
    if (!workers.has(instance)) workers.set(instance, {});
    workers.get(instance)!.load1 = parseFloat(r.value[1]).toFixed(2);
  }
  for (const r of metrics.node_load5) {
    const instance = r.metric.instance || r.metric.job || 'unknown';
    if (!workers.has(instance)) workers.set(instance, {});
    workers.get(instance)!.load5 = parseFloat(r.value[1]).toFixed(2);
  }
  for (const r of metrics.node_load15) {
    const instance = r.metric.instance || r.metric.job || 'unknown';
    if (!workers.has(instance)) workers.set(instance, {});
    workers.get(instance)!.load15 = parseFloat(r.value[1]).toFixed(2);
  }

  // Build network traffic table
  const traffic: { destination: string; inBits: string; outBits: string }[] = [];
  const destMap = new Map<string, { inBits?: string; outBits?: string }>();
  for (const r of metrics.dataplaneInBits) {
    const dest = r.metric.destination || 'unknown';
    if (!destMap.has(dest)) destMap.set(dest, {});
    destMap.get(dest)!.inBits = formatBits(r.value[1]);
  }
  for (const r of metrics.dataplaneOutBits) {
    const dest = r.metric.destination || 'unknown';
    if (!destMap.has(dest)) destMap.set(dest, {});
    destMap.get(dest)!.outBits = formatBits(r.value[1]);
  }
  for (const [dest, vals] of destMap) {
    traffic.push({ destination: dest.toUpperCase(), inBits: vals.inBits || '—', outBits: vals.outBits || '—' });
  }

  return (
    <>
      {workers.size > 0 && (
        <>
          <div className="section-title">CPU Load</div>
          <table>
            <thead>
              <tr><th>Worker</th><th>1m</th><th>5m</th><th>15m</th></tr>
            </thead>
            <tbody>
              {[...workers.entries()].map(([instance, loads]) => (
                <tr key={instance}>
                  <td>{shortenInstance(instance)}</td>
                  <td>{loads.load1 ?? '—'}</td>
                  <td>{loads.load5 ?? '—'}</td>
                  <td>{loads.load15 ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {traffic.length > 0 && (
        <>
          <div className="section-title">Network Traffic</div>
          <table>
            <thead>
              <tr><th>Destination</th><th>In</th><th>Out</th></tr>
            </thead>
            <tbody>
              {traffic.map((t) => (
                <tr key={t.destination}>
                  <td>{t.destination}</td>
                  <td>{t.inBits}</td>
                  <td>{t.outBits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {workers.size === 0 && traffic.length === 0 && (
        <div className="detail-loading">No metrics available for this site</div>
      )}

      {lastUpdated && (
        <div className="metrics-timestamp">
          Updated: {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </>
  );
}

/* ============ Link Tabbed Detail ============ */

function LinkTabbedDetail({ data }: { data: Record<string, string> }) {
  const [tab, setTab] = useState<'resources' | 'metrics'>('resources');
  const elementKey = `${data.site_a}-${data.site_b}`;

  useEffect(() => { setTab('resources'); }, [elementKey]);

  return (
    <>
      <div className="detail-tabs">
        <button className={tab === 'resources' ? 'active' : ''} onClick={() => setTab('resources')}>Info</button>
        <button className={tab === 'metrics' ? 'active' : ''} onClick={() => setTab('metrics')}>Metrics</button>
      </div>
      {tab === 'resources' && <LinkResourcesTab data={data} />}
      {tab === 'metrics' && <LinkMetricsTab siteA={data.site_a} siteB={data.site_b} />}
    </>
  );
}

function LinkResourcesTab({ data }: { data: Record<string, string> }) {
  return (
    <PropTable rows={[
      ['Name', data.name],
      ['From', data.site_a],
      ['To', data.site_b],
    ]} />
  );
}

function LinkMetricsTab({ siteA, siteB }: { siteA: string; siteB: string }) {
  const [metrics, setMetrics] = useState<LinkMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMetrics = () => {
    getLinkMetrics(siteA, siteB)
      .then((m) => { setMetrics(m); setError(null); setLastUpdated(new Date()); })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    setMetrics(null);
    fetchMetrics();
    intervalRef.current = setInterval(fetchMetrics, 30000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [siteA, siteB]);

  if (loading && !metrics) return <div className="detail-loading">Loading metrics...</div>;
  if (error && !metrics) return <div className="metrics-error">Failed to load metrics: {error}</div>;
  if (!metrics) return null;

  const hasData = metrics.a_to_b_in.length > 0 || metrics.a_to_b_out.length > 0 ||
                  metrics.b_to_a_in.length > 0 || metrics.b_to_a_out.length > 0;

  if (!hasData) {
    return <div className="detail-loading">No traffic metrics available for this link</div>;
  }

  return (
    <>
      <div className="section-title">{siteA} → {siteB}</div>
      <PropTable rows={[
        ['In', metrics.a_to_b_in.length > 0 ? formatBits(metrics.a_to_b_in[0].value[1]) : '—'],
        ['Out', metrics.a_to_b_out.length > 0 ? formatBits(metrics.a_to_b_out[0].value[1]) : '—'],
      ]} />

      <div className="section-title">{siteB} → {siteA}</div>
      <PropTable rows={[
        ['In', metrics.b_to_a_in.length > 0 ? formatBits(metrics.b_to_a_in[0].value[1]) : '—'],
        ['Out', metrics.b_to_a_out.length > 0 ? formatBits(metrics.b_to_a_out[0].value[1]) : '—'],
      ]} />

      {lastUpdated && (
        <div className="metrics-timestamp">
          Updated: {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </>
  );
}

/* ============ Helpers ============ */

function formatBits(value: string): string {
  const bits = parseFloat(value);
  if (isNaN(bits)) return '—';
  if (bits >= 1e9) return `${(bits / 1e9).toFixed(2)} Gbps`;
  if (bits >= 1e6) return `${(bits / 1e6).toFixed(2)} Mbps`;
  if (bits >= 1e3) return `${(bits / 1e3).toFixed(2)} Kbps`;
  return `${bits.toFixed(0)} bps`;
}

function shortenInstance(instance: string): string {
  // Extract hostname from "host:port" format
  const host = instance.split(':')[0];
  // Further shorten if it's a FQDN
  const short = host.split('.')[0];
  return short || instance;
}

function findNode(slice: SliceData, name: string): SliceNode | null {
  return slice.nodes.find((n) => n.name === name) ?? null;
}

function findNetwork(slice: SliceData, name: string): SliceNetwork | null {
  return slice.networks.find((n) => n.name === name) ?? null;
}
