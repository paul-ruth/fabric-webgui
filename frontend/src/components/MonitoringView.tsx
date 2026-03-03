'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import type {
  MonitoringStatus,
  MonitoringHistory,
  NodeMonitoringStatus,
  InfrastructureMetrics,
  SliceData,
  TimeSeriesPoint,
} from '../types/fabric';
import * as api from '../api/client';
import '../styles/monitoring-view.css';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// FABRIC brand palette for chart lines
const LINE_COLORS = ['#5798bc', '#008e7a', '#ff8542', '#e25241', '#1f6a8c', '#6c5ce7', '#00b894', '#fdcb6e'];

const TIME_RANGES = [
  { label: '5m', minutes: 5 },
  { label: '15m', minutes: 15 },
  { label: '30m', minutes: 30 },
  { label: '60m', minutes: 60 },
];

interface MonitoringViewProps {
  sliceName: string | null;
  sliceData: SliceData | null;
  monitoringPending?: boolean;
  nodeActivity?: Record<string, string>;
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function makeChartOptions(title: string, yLabel: string, yMax?: number) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 } as const,
    plugins: {
      legend: { position: 'top' as const, labels: { boxWidth: 12, font: { size: 11 } } },
      title: { display: false },
      tooltip: { mode: 'index' as const, intersect: false },
    },
    scales: {
      x: {
        ticks: { maxTicksToShow: 8, font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        max: yMax,
        title: { display: true, text: yLabel, font: { size: 11 } },
        ticks: { font: { size: 10 } },
      },
    },
    elements: {
      point: { radius: 0 },
      line: { borderWidth: 2 },
    },
  };
}

function buildLineData(
  nodeNames: string[],
  historyByNode: Record<string, TimeSeriesPoint[] | undefined>,
) {
  // Gather all timestamps across nodes
  const allTs = new Set<number>();
  for (const pts of Object.values(historyByNode)) {
    if (pts) pts.forEach((p) => allTs.add(p.t));
  }
  const sorted = Array.from(allTs).sort((a, b) => a - b);
  const labels = sorted.map(formatTime);

  const datasets = nodeNames.map((name, i) => {
    const pts = historyByNode[name] || [];
    const tsMap = new Map(pts.map((p) => [p.t, p.v]));
    return {
      label: name,
      data: sorted.map((ts) => tsMap.get(ts) ?? null),
      borderColor: LINE_COLORS[i % LINE_COLORS.length],
      backgroundColor: LINE_COLORS[i % LINE_COLORS.length] + '20',
      fill: false,
      tension: 0.3,
    };
  });

  return { labels, datasets };
}

export default function MonitoringView({ sliceName, sliceData, monitoringPending, nodeActivity }: MonitoringViewProps) {
  const [status, setStatus] = useState<MonitoringStatus | null>(null);
  const [history, setHistory] = useState<MonitoringHistory | null>(null);
  const [infra, setInfra] = useState<InfrastructureMetrics | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [enabling, setEnabling] = useState(false);
  const [togglingNode, setTogglingNode] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!sliceName) return;
    try {
      const s = await api.getMonitoringStatus(sliceName);
      setStatus(s);
    } catch { /* ignore */ }
  }, [sliceName]);

  const fetchHistory = useCallback(async () => {
    if (!sliceName) return;
    try {
      const h = await api.getMonitoringHistory(sliceName, minutes);
      setHistory(h);
    } catch { /* ignore */ }
  }, [sliceName, minutes]);

  const fetchInfra = useCallback(async () => {
    if (!sliceName) return;
    try {
      const inf = await api.getInfrastructureMetrics(sliceName);
      setInfra(inf);
    } catch { /* ignore */ }
  }, [sliceName]);

  // Initial fetch and polling
  useEffect(() => {
    fetchStatus();
    fetchHistory();
    fetchInfra();

    intervalRef.current = setInterval(() => {
      fetchStatus();
      fetchHistory();
    }, 15000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus, fetchHistory, fetchInfra]);

  // Refetch history when time range changes
  useEffect(() => {
    fetchHistory();
  }, [minutes, fetchHistory]);

  const handleEnable = async () => {
    if (!sliceName) return;
    setEnabling(true);
    try {
      await api.enableMonitoring(sliceName);
      await fetchStatus();
      // Small delay for first scrape
      setTimeout(() => { fetchHistory(); fetchStatus(); }, 5000);
    } catch (e) {
      console.error('Failed to enable monitoring:', e);
    }
    setEnabling(false);
  };

  const handleDisable = async () => {
    if (!sliceName) return;
    setEnabling(true);
    try {
      await api.disableMonitoring(sliceName);
      await fetchStatus();
    } catch (e) {
      console.error('Failed to disable monitoring:', e);
    }
    setEnabling(false);
  };

  const handleNodeToggle = async (nodeName: string, currentlyEnabled: boolean) => {
    if (!sliceName) return;
    setTogglingNode(nodeName);
    try {
      if (currentlyEnabled) {
        await api.disableNodeMonitoring(sliceName, nodeName);
      } else {
        await api.enableNodeMonitoring(sliceName, nodeName);
      }
      await fetchStatus();
    } catch (e) {
      console.error('Failed to toggle node monitoring:', e);
    }
    setTogglingNode(null);
  };

  if (!sliceName) {
    return <div className="mv-root"><div className="mv-empty">Select a slice to view monitoring</div></div>;
  }

  // Filter nodeActivity to monitoring-related entries
  const monitoringActivities = nodeActivity
    ? Object.entries(nodeActivity).filter(([, msg]) => msg && (msg.toLowerCase().includes('monitor') || msg.toLowerCase().includes('node_exporter')))
    : [];
  const hasMonitoringProgress = monitoringActivities.length > 0;
  const isEnabled = status?.enabled ?? false;
  const nodes = status?.nodes ?? [];
  const nodeNames = Object.keys(history?.nodes ?? {});

  // Group network metrics by node
  const netMetrics: Record<string, { iface: string; dir: string; key: string }[]> = {};
  if (history) {
    for (const [nodeName, nodeData] of Object.entries(history.nodes)) {
      for (const key of Object.keys(nodeData)) {
        const rxMatch = key.match(/^net_rx_bytes\.(.+)$/);
        const txMatch = key.match(/^net_tx_bytes\.(.+)$/);
        if (rxMatch) {
          (netMetrics[nodeName] ??= []).push({ iface: rxMatch[1], dir: 'rx', key });
        } else if (txMatch) {
          (netMetrics[nodeName] ??= []).push({ iface: txMatch[1], dir: 'tx', key });
        }
      }
    }
  }

  // Collect unique interfaces across all nodes
  const allIfaces = new Set<string>();
  for (const entries of Object.values(netMetrics)) {
    for (const e of entries) allIfaces.add(e.iface);
  }

  function getNodeStatusColor(n: NodeMonitoringStatus): string {
    if (!n.enabled) return 'gray';
    if (n.last_error) return 'red';
    if (!n.exporter_installed) return 'yellow';
    if (n.last_scrape > 0 && (Date.now() / 1000 - n.last_scrape) < 60) return 'green';
    return 'yellow';
  }

  return (
    <div className="mv-root">
      {/* Header */}
      <div className="mv-header">
        <h2>Monitoring: <span className="mv-header-slice">{sliceName}</span></h2>
        <button
          className={`mv-toggle-btn ${isEnabled ? 'disable' : 'enable'}`}
          onClick={isEnabled ? handleDisable : handleEnable}
          disabled={enabling}
        >
          {enabling ? 'Working...' : isEnabled ? 'Disable Monitoring' : 'Enable Monitoring'}
        </button>
        {isEnabled && <div className="mv-refresh-dot" title="Auto-refreshing every 15s" />}
        <div className="mv-time-range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.label}
              className={`mv-time-btn ${minutes === r.minutes ? 'active' : ''}`}
              onClick={() => setMinutes(r.minutes)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Pending banner */}
      {monitoringPending && !isEnabled && !hasMonitoringProgress && (
        <div className="mv-pending-banner" style={{ background: 'var(--fabric-primary)', color: '#fff', padding: '8px 12px', borderRadius: 4, marginBottom: 12, fontSize: 12 }}>
          Monitoring will auto-enable when slice reaches StableOK
        </div>
      )}

      {/* Per-node monitoring enable progress */}
      {hasMonitoringProgress && (
        <div className="mv-section">
          <h3>Enabling Monitoring</h3>
          <div className="mv-progress-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {monitoringActivities.map(([nodeName, msg]) => {
              const isFailed = msg.toLowerCase().includes('failed');
              const isPending = msg.toLowerCase().includes('pending');
              return (
                <div key={nodeName} className="mv-progress-row" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 8px', background: 'var(--bg-secondary, #f5f5f5)', borderRadius: 4 }}>
                  <span style={{ width: 20, textAlign: 'center' }}>
                    {isPending && <span style={{ color: '#999' }}>{'\u25CB'}</span>}
                    {!isPending && !isFailed && <span className="mv-spin" style={{ color: 'var(--fabric-primary)', display: 'inline-block' }}>{'\u21BB'}</span>}
                    {isFailed && <span style={{ color: 'var(--fabric-coral, #e25241)' }}>{'\u2717'}</span>}
                  </span>
                  <span style={{ fontWeight: 500 }}>{nodeName}</span>
                  <span style={{ color: '#888', marginLeft: 'auto' }}>{msg}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Node cards */}
      {nodes.length > 0 && (
        <div className="mv-section">
          <h3>Nodes</h3>
          <div className="mv-node-grid">
            {nodes.map((n) => (
              <div key={n.name} className="mv-node-card">
                <div className="mv-node-card-header">
                  <div className={`mv-status-dot ${getNodeStatusColor(n)}`} />
                  <span className="mv-node-name" title={n.name}>{n.name}</span>
                  <button
                    className={`mv-node-toggle ${n.enabled ? 'on' : ''}`}
                    onClick={() => handleNodeToggle(n.name, n.enabled)}
                    disabled={togglingNode === n.name}
                    title={n.enabled ? 'Disable' : 'Enable'}
                  />
                </div>
                {n.site && <div className="mv-node-meta">Site: {n.site}</div>}
                {n.last_scrape > 0 && (
                  <div className="mv-node-meta">Last: {formatTime(n.last_scrape)}</div>
                )}
                {n.last_error && <div className="mv-node-error">{n.last_error}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CPU chart */}
      {nodeNames.length > 0 && (
        <div className="mv-section">
          <h3>CPU Utilization</h3>
          <div className="mv-chart-grid">
            <div className="mv-chart-container">
              <div className="mv-chart-inner">
                <Line
                  data={buildLineData(
                    nodeNames,
                    Object.fromEntries(nodeNames.map((n) => [n, history!.nodes[n]?.cpu_percent]))
                  )}
                  options={makeChartOptions('CPU %', '%', 100)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Memory chart */}
      {nodeNames.length > 0 && (
        <div className="mv-section">
          <h3>Memory Utilization</h3>
          <div className="mv-chart-grid">
            <div className="mv-chart-container">
              <div className="mv-chart-inner">
                <Line
                  data={buildLineData(
                    nodeNames,
                    Object.fromEntries(nodeNames.map((n) => [n, history!.nodes[n]?.memory_percent]))
                  )}
                  options={makeChartOptions('Memory %', '%', 100)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Load chart */}
      {nodeNames.length > 0 && (
        <div className="mv-section">
          <h3>System Load (1-min avg)</h3>
          <div className="mv-chart-grid">
            <div className="mv-chart-container">
              <div className="mv-chart-inner">
                <Line
                  data={buildLineData(
                    nodeNames,
                    Object.fromEntries(nodeNames.map((n) => [n, history!.nodes[n]?.load1]))
                  )}
                  options={makeChartOptions('Load', 'Load')}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Network charts */}
      {allIfaces.size > 0 && (
        <div className="mv-section">
          <h3>Network I/O (bytes/sec)</h3>
          <div className="mv-chart-grid">
            {Array.from(allIfaces).map((iface) => (
              <div key={`rx-${iface}`} className="mv-chart-container">
                <div className="mv-chart-label">{iface} RX</div>
                <div className="mv-chart-inner">
                  <Line
                    data={buildLineData(
                      nodeNames,
                      Object.fromEntries(
                        nodeNames.map((n) => [n, history!.nodes[n]?.[`net_rx_bytes.${iface}`]])
                      )
                    )}
                    options={makeChartOptions(`${iface} RX`, 'B/s')}
                  />
                </div>
              </div>
            ))}
            {Array.from(allIfaces).map((iface) => (
              <div key={`tx-${iface}`} className="mv-chart-container">
                <div className="mv-chart-label">{iface} TX</div>
                <div className="mv-chart-inner">
                  <Line
                    data={buildLineData(
                      nodeNames,
                      Object.fromEntries(
                        nodeNames.map((n) => [n, history!.nodes[n]?.[`net_tx_bytes.${iface}`]])
                      )
                    )}
                    options={makeChartOptions(`${iface} TX`, 'B/s')}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Infrastructure metrics */}
      {infra && Object.keys(infra.sites).length > 0 && (
        <div className="mv-section">
          <h3>Infrastructure (FABRIC Site Metrics)</h3>
          <div className="mv-infra-grid">
            {Object.entries(infra.sites).map(([siteName, data]) => (
              <div key={siteName} className="mv-infra-card">
                <h4>{siteName}</h4>
                {'error' in data && data.error ? (
                  <div className="mv-node-error">{data.error}</div>
                ) : (
                  <>
                    {data.node_load1 && data.node_load1.length > 0 && (
                      <div className="mv-infra-row">
                        <span className="mv-infra-label">Load (1m avg)</span>
                        <span className="mv-infra-value">
                          {data.node_load1.map((r) => Number(r.value?.[1] ?? 0).toFixed(2)).join(', ')}
                        </span>
                      </div>
                    )}
                    {data.node_load5 && data.node_load5.length > 0 && (
                      <div className="mv-infra-row">
                        <span className="mv-infra-label">Load (5m avg)</span>
                        <span className="mv-infra-value">
                          {data.node_load5.map((r) => Number(r.value?.[1] ?? 0).toFixed(2)).join(', ')}
                        </span>
                      </div>
                    )}
                    {data.dataplaneInBits && data.dataplaneInBits.length > 0 && (
                      <div className="mv-infra-row">
                        <span className="mv-infra-label">Dataplane In</span>
                        <span className="mv-infra-value">
                          {data.dataplaneInBits.map((r) => {
                            const bits = Number(r.value?.[1] ?? 0);
                            return bits > 1e9 ? `${(bits / 1e9).toFixed(2)} Gbps` : `${(bits / 1e6).toFixed(2)} Mbps`;
                          }).join(', ')}
                        </span>
                      </div>
                    )}
                    {data.dataplaneOutBits && data.dataplaneOutBits.length > 0 && (
                      <div className="mv-infra-row">
                        <span className="mv-infra-label">Dataplane Out</span>
                        <span className="mv-infra-value">
                          {data.dataplaneOutBits.map((r) => {
                            const bits = Number(r.value?.[1] ?? 0);
                            return bits > 1e9 ? `${(bits / 1e9).toFixed(2)} Gbps` : `${(bits / 1e6).toFixed(2)} Mbps`;
                          }).join(', ')}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state when enabled but no data yet */}
      {isEnabled && nodeNames.length === 0 && !enabling && (
        <div className="mv-loading">
          <div className="mv-spinner" />
          Waiting for first metrics scrape...
        </div>
      )}
    </div>
  );
}
