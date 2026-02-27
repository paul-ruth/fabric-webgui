import { useState, useEffect, useCallback } from 'react';
import type { SliceData, SiteInfo, ComponentModel, BootConfig, BootUpload, BootCommand, BootNetConfig, BootExecResult, FileEntry } from '../types/fabric';
import * as api from '../api/client';
import '../styles/editor.css';

type Tab = 'node' | 'component' | 'network' | 'remove' | 'configure';

interface EditorPanelProps {
  sliceData: SliceData | null;
  sliceName: string;
  onSliceUpdated: (data: SliceData) => void;
  onCollapse: () => void;
  sites: SiteInfo[];
  images: string[];
  componentModels: ComponentModel[];
}

export default function EditorPanel({ sliceData, sliceName, onSliceUpdated, onCollapse, sites, images, componentModels }: EditorPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('node');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'node', label: 'Node' },
    { key: 'component', label: 'Comp' },
    { key: 'network', label: 'Net' },
    { key: 'remove', label: 'Remove' },
    { key: 'configure', label: 'Config' },
  ];

  return (
    <div className="editor-panel">
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={activeTab === t.key ? 'active' : ''}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
        <button className="collapse-btn" onClick={onCollapse} title="Collapse editor panel">◀</button>
      </div>
      <div className="tab-content">
        {error && <div style={{ color: 'var(--fabric-coral)', fontSize: 12, marginBottom: 8 }}>{error}</div>}

        {activeTab === 'node' && (
          <NodeTab
            sites={sites}
            images={images}
            sliceName={sliceName}
            loading={loading}
            onSubmit={async (data) => {
              setLoading(true);
              setError('');
              try {
                const result = await api.addNode(sliceName, data);
                onSliceUpdated(result);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
        {activeTab === 'component' && (
          <ComponentTab
            sliceData={sliceData}
            componentModels={componentModels}
            sliceName={sliceName}
            loading={loading}
            onSubmit={async (nodeName, data) => {
              setLoading(true);
              setError('');
              try {
                const result = await api.addComponent(sliceName, nodeName, data);
                onSliceUpdated(result);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
        {activeTab === 'network' && (
          <NetworkTab
            sliceData={sliceData}
            sliceName={sliceName}
            loading={loading}
            onSubmit={async (data) => {
              setLoading(true);
              setError('');
              try {
                const result = await api.addNetwork(sliceName, data);
                onSliceUpdated(result);
              } catch (e: any) {
                setError(e.message);
              } finally {
                setLoading(false);
              }
            }}
          />
        )}
        {activeTab === 'remove' && (
          <RemoveTab
            sliceData={sliceData}
            sliceName={sliceName}
            loading={loading}
            onSliceUpdated={onSliceUpdated}
            setError={setError}
          />
        )}
        {activeTab === 'configure' && (
          <ConfigureTab
            sliceData={sliceData}
            sites={sites}
            images={images}
            sliceName={sliceName}
            loading={loading}
            onSliceUpdated={onSliceUpdated}
            setError={setError}
          />
        )}
      </div>
    </div>
  );
}

// --- Node Tab ---
function NodeTab({
  sites, images, sliceName, loading, onSubmit,
}: {
  sites: SiteInfo[]; images: string[]; sliceName: string; loading: boolean;
  onSubmit: (data: { name: string; site: string; cores: number; ram: number; disk: number; image: string }) => void;
}) {
  const [name, setName] = useState('');
  const [site, setSite] = useState('auto');
  const [cores, setCores] = useState(2);
  const [ram, setRam] = useState(8);
  const [disk, setDisk] = useState(10);
  const [image, setImage] = useState('default_ubuntu_22');

  return (
    <>
      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="node1" />
      </div>
      <div className="form-group">
        <label>Site</label>
        <select value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="auto">auto</option>
          {sites.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Cores <span className="range-value">{cores}</span></label>
        <input type="range" min={1} max={64} value={cores} onChange={(e) => setCores(+e.target.value)} />
      </div>
      <div className="form-group">
        <label>RAM (GB) <span className="range-value">{ram}</span></label>
        <input type="range" min={2} max={256} value={ram} onChange={(e) => setRam(+e.target.value)} />
      </div>
      <div className="form-group">
        <label>Disk (GB) <span className="range-value">{disk}</span></label>
        <input type="range" min={10} max={500} value={disk} onChange={(e) => setDisk(+e.target.value)} />
      </div>
      <div className="form-group">
        <label>Image</label>
        <select value={image} onChange={(e) => setImage(e.target.value)}>
          {images.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
      </div>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!name || !sliceName || loading}
          onClick={() => onSubmit({ name, site, cores, ram, disk, image })}
        >
          Add Node
        </button>
      </div>
    </>
  );
}

// --- Component Tab ---
function ComponentTab({
  sliceData, componentModels, sliceName, loading, onSubmit,
}: {
  sliceData: SliceData | null; componentModels: ComponentModel[]; sliceName: string;
  loading: boolean;
  onSubmit: (nodeName: string, data: { name: string; model: string }) => void;
}) {
  const [targetNode, setTargetNode] = useState('');
  const [model, setModel] = useState('NIC_Basic');
  const [name, setName] = useState('');

  const nodeNames = sliceData?.nodes.map((n) => n.name) ?? [];

  return (
    <>
      <div className="form-group">
        <label>Target Node</label>
        <select value={targetNode} onChange={(e) => setTargetNode(e.target.value)}>
          <option value="">-- Select --</option>
          {nodeNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {componentModels.map((c) => (
            <option key={c.model} value={c.model}>{c.model} — {c.description}</option>
          ))}
        </select>
      </div>
      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="nic1" />
      </div>
      <div className="form-actions">
        <button
          className="primary"
          disabled={!targetNode || !name || loading}
          onClick={() => onSubmit(targetNode, { name, model })}
        >
          Add Component
        </button>
      </div>
    </>
  );
}

// --- Network Tab ---
function NetworkTab({
  sliceData, sliceName, loading, onSubmit,
}: {
  sliceData: SliceData | null; sliceName: string; loading: boolean;
  onSubmit: (data: {
    name: string; type: string; interfaces: string[];
    subnet?: string; gateway?: string; ip_mode?: string;
    interface_ips?: Record<string, string>;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [layer, setLayer] = useState<'L2' | 'L3'>('L2');
  const [netType, setNetType] = useState('L2Bridge');
  const [selectedIfaces, setSelectedIfaces] = useState<string[]>([]);
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [ipMode, setIpMode] = useState<'none' | 'auto' | 'manual'>('none');
  const [interfaceIps, setInterfaceIps] = useState<Record<string, string>>({});

  const l2Types = ['L2Bridge', 'L2STS', 'L2PTP'];
  const l3Types = ['IPv4', 'IPv6', 'IPv4Ext', 'IPv6Ext'];
  const types = layer === 'L2' ? l2Types : l3Types;

  // Get all unattached interfaces
  const allIfaces: string[] = [];
  for (const node of sliceData?.nodes ?? []) {
    for (const iface of node.interfaces) {
      if (!iface.network_name) {
        allIfaces.push(iface.name);
      }
    }
  }

  return (
    <>
      <div className="form-group">
        <label>Name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="net1" />
      </div>
      <div className="form-group">
        <label>Layer</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['L2', 'L3'] as const).map((l) => (
            <button
              key={l}
              className={layer === l ? 'primary' : ''}
              style={{ flex: 1 }}
              onClick={() => {
                setLayer(l);
                setNetType(l === 'L2' ? 'L2Bridge' : 'IPv4');
                if (l === 'L3') {
                  setSubnet('');
                  setGateway('');
                  setIpMode('none');
                  setInterfaceIps({});
                }
              }}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label>Type</label>
        <select value={netType} onChange={(e) => setNetType(e.target.value)}>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label>Interfaces</label>
        <select
          multiple
          value={selectedIfaces}
          onChange={(e) => {
            const opts = Array.from(e.target.selectedOptions, (o) => o.value);
            setSelectedIfaces(opts);
          }}
        >
          {allIfaces.map((i) => <option key={i} value={i}>{i}</option>)}
        </select>
        {allIfaces.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--fabric-text-muted)', marginTop: 4 }}>
            No unattached interfaces. Add components with NICs first.
          </div>
        )}
      </div>

      {layer === 'L3' && (
        <div style={{ fontSize: 11, color: 'var(--fabric-text-muted)', marginTop: 4, marginBottom: 8 }}>
          Subnet, gateway, and IPs are auto-assigned by FABRIC for L3 networks.
        </div>
      )}

      {layer === 'L2' && (
        <>
          <div className="form-group">
            <label>Subnet (optional)</label>
            <input
              type="text"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
              placeholder="192.168.1.0/24"
            />
          </div>
          {subnet && (
            <>
              <div className="form-group">
                <label>Gateway (optional)</label>
                <input
                  type="text"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  placeholder="192.168.1.1"
                />
              </div>
              <div className="form-group">
                <label>IP Assignment</label>
                <select value={ipMode} onChange={(e) => setIpMode(e.target.value as 'none' | 'auto' | 'manual')}>
                  <option value="none">None</option>
                  <option value="auto">Auto-assign</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              {ipMode === 'manual' && selectedIfaces.length > 0 && (
                <div className="form-group">
                  <label>Interface IPs</label>
                  {selectedIfaces.map((ifName) => (
                    <div key={ifName} style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, minWidth: 80 }}>{ifName}</span>
                      <input
                        type="text"
                        value={interfaceIps[ifName] || ''}
                        onChange={(e) => setInterfaceIps((prev) => ({ ...prev, [ifName]: e.target.value }))}
                        placeholder="10.0.0.1"
                        style={{ flex: 1 }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="form-actions">
        <button
          className="primary"
          disabled={!name || loading}
          onClick={() => onSubmit({
            name,
            type: netType,
            interfaces: selectedIfaces,
            ...(layer === 'L2' && subnet ? { subnet, gateway: gateway || undefined, ip_mode: ipMode } : {}),
            ...(layer === 'L2' && ipMode === 'manual' ? { interface_ips: interfaceIps } : {}),
          })}
        >
          Add Network
        </button>
      </div>
    </>
  );
}

// --- Remove Tab ---
function RemoveTab({
  sliceData, sliceName, loading, onSliceUpdated, setError,
}: {
  sliceData: SliceData | null; sliceName: string; loading: boolean;
  onSliceUpdated: (data: SliceData) => void; setError: (e: string) => void;
}) {
  const [nodeToRemove, setNodeToRemove] = useState('');
  const [netToRemove, setNetToRemove] = useState('');
  const [compToRemove, setCompToRemove] = useState(''); // "node:comp"

  const nodeNames = sliceData?.nodes.map((n) => n.name) ?? [];
  const netNames = sliceData?.networks.map((n) => n.name) ?? [];
  const compEntries: string[] = [];
  for (const node of sliceData?.nodes ?? []) {
    for (const comp of node.components) {
      compEntries.push(`${node.name}:${comp.name}`);
    }
  }

  return (
    <>
      <div className="remove-section">
        <h4>Remove Node</h4>
        <div className="remove-row">
          <select value={nodeToRemove} onChange={(e) => setNodeToRemove(e.target.value)}>
            <option value="">-- Select --</option>
            {nodeNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            className="danger"
            disabled={!nodeToRemove || loading}
            onClick={async () => {
              try {
                const result = await api.removeNode(sliceName, nodeToRemove);
                onSliceUpdated(result);
                setNodeToRemove('');
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="remove-section">
        <h4>Remove Network</h4>
        <div className="remove-row">
          <select value={netToRemove} onChange={(e) => setNetToRemove(e.target.value)}>
            <option value="">-- Select --</option>
            {netNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button
            className="danger"
            disabled={!netToRemove || loading}
            onClick={async () => {
              try {
                const result = await api.removeNetwork(sliceName, netToRemove);
                onSliceUpdated(result);
                setNetToRemove('');
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>

      <div className="remove-section">
        <h4>Remove Component</h4>
        <div className="remove-row">
          <select value={compToRemove} onChange={(e) => setCompToRemove(e.target.value)}>
            <option value="">-- Select --</option>
            {compEntries.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button
            className="danger"
            disabled={!compToRemove || loading}
            onClick={async () => {
              try {
                const [nodeName, compName] = compToRemove.split(':');
                const result = await api.removeComponent(sliceName, nodeName, compName);
                onSliceUpdated(result);
                setCompToRemove('');
              } catch (e: any) {
                setError(e.message);
              }
            }}
          >
            Remove
          </button>
        </div>
      </div>
    </>
  );
}

// --- Configure Tab ---
function ConfigureTab({
  sliceData, sites, images, sliceName, loading, onSliceUpdated, setError,
}: {
  sliceData: SliceData | null; sites: SiteInfo[]; images: string[]; sliceName: string;
  loading: boolean; onSliceUpdated: (data: SliceData) => void; setError: (e: string) => void;
}) {
  const [selectedNode, setSelectedNode] = useState('');
  const nodeNames = sliceData?.nodes.map((n) => n.name) ?? [];
  const node = sliceData?.nodes.find((n) => n.name === selectedNode);

  const [site, setSite] = useState('');
  const [cores, setCores] = useState(2);
  const [ram, setRam] = useState(8);
  const [disk, setDisk] = useState(10);
  const [image, setImage] = useState('');

  // Boot config state
  const [bootConfig, setBootConfig] = useState<BootConfig>({ uploads: [], commands: [], network: [] });
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [bootExecuting, setBootExecuting] = useState(false);
  const [bootResults, setBootResults] = useState<BootExecResult[]>([]);
  const [bootSaved, setBootSaved] = useState(false);

  useEffect(() => {
    if (node) {
      setSite(node.site);
      setCores(node.cores);
      setRam(node.ram);
      setDisk(node.disk);
      setImage(node.image);
    }
  }, [node]);

  // Load boot config when node changes
  useEffect(() => {
    if (selectedNode && sliceName) {
      api.getBootConfig(sliceName, selectedNode)
        .then((cfg) => {
          setBootConfig(cfg);
          setBootResults([]);
          setBootSaved(false);
        })
        .catch(() => setBootConfig({ uploads: [], commands: [], network: [] }));
    }
  }, [selectedNode, sliceName]);

  const addUpload = useCallback((source: string, isDir: boolean) => {
    const filename = source.split('/').pop() || source;
    const dest = `/home/ubuntu/${filename}`;
    const upload: BootUpload = { id: crypto.randomUUID(), source, dest };
    setBootConfig((prev) => ({ ...prev, uploads: [...prev.uploads, upload] }));
    setBootSaved(false);
  }, []);

  const removeUpload = useCallback((id: string) => {
    setBootConfig((prev) => ({ ...prev, uploads: prev.uploads.filter((u) => u.id !== id) }));
    setBootSaved(false);
  }, []);

  const updateUploadDest = useCallback((id: string, dest: string) => {
    setBootConfig((prev) => ({
      ...prev,
      uploads: prev.uploads.map((u) => u.id === id ? { ...u, dest } : u),
    }));
    setBootSaved(false);
  }, []);

  const addCommand = useCallback(() => {
    const cmd: BootCommand = { id: crypto.randomUUID(), command: '', order: bootConfig.commands.length };
    setBootConfig((prev) => ({ ...prev, commands: [...prev.commands, cmd] }));
    setBootSaved(false);
  }, [bootConfig.commands.length]);

  const removeCommand = useCallback((id: string) => {
    setBootConfig((prev) => ({
      ...prev,
      commands: prev.commands.filter((c) => c.id !== id).map((c, i) => ({ ...c, order: i })),
    }));
    setBootSaved(false);
  }, []);

  const updateCommand = useCallback((id: string, command: string) => {
    setBootConfig((prev) => ({
      ...prev,
      commands: prev.commands.map((c) => c.id === id ? { ...c, command } : c),
    }));
    setBootSaved(false);
  }, []);

  const moveCommand = useCallback((id: string, dir: -1 | 1) => {
    setBootConfig((prev) => {
      const cmds = [...prev.commands];
      const idx = cmds.findIndex((c) => c.id === id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= cmds.length) return prev;
      [cmds[idx], cmds[newIdx]] = [cmds[newIdx], cmds[idx]];
      return { ...prev, commands: cmds.map((c, i) => ({ ...c, order: i })) };
    });
    setBootSaved(false);
  }, []);

  // Network config helpers
  const addNetConfig = useCallback(() => {
    const net: BootNetConfig = { id: crypto.randomUUID(), iface: '', mode: 'auto', order: bootConfig.network.length };
    setBootConfig((prev) => ({ ...prev, network: [...prev.network, net] }));
    setBootSaved(false);
  }, [bootConfig.network.length]);

  const removeNetConfig = useCallback((id: string) => {
    setBootConfig((prev) => ({
      ...prev,
      network: prev.network.filter((n) => n.id !== id).map((n, i) => ({ ...n, order: i })),
    }));
    setBootSaved(false);
  }, []);

  const updateNetConfig = useCallback((id: string, updates: Partial<BootNetConfig>) => {
    setBootConfig((prev) => ({
      ...prev,
      network: prev.network.map((n) => n.id === id ? { ...n, ...updates } : n),
    }));
    setBootSaved(false);
  }, []);

  const moveNetConfig = useCallback((id: string, dir: -1 | 1) => {
    setBootConfig((prev) => {
      const nets = [...prev.network];
      const idx = nets.findIndex((n) => n.id === id);
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= nets.length) return prev;
      [nets[idx], nets[newIdx]] = [nets[newIdx], nets[idx]];
      return { ...prev, network: nets.map((n, i) => ({ ...n, order: i })) };
    });
    setBootSaved(false);
  }, []);

  const handleSaveBoot = async () => {
    try {
      const saved = await api.saveBootConfig(sliceName, selectedNode, bootConfig);
      setBootConfig(saved);
      setBootSaved(true);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleExecuteBoot = async () => {
    setBootExecuting(true);
    setBootResults([]);
    try {
      const results = await api.executeBootConfig(sliceName, selectedNode);
      setBootResults(results);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBootExecuting(false);
    }
  };

  return (
    <>
      <div className="form-group">
        <label>Node</label>
        <select value={selectedNode} onChange={(e) => setSelectedNode(e.target.value)}>
          <option value="">-- Select --</option>
          {nodeNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      {selectedNode && (
        <>
          <div className="form-group">
            <label>Site</label>
            <select value={site} onChange={(e) => setSite(e.target.value)}>
              {sites.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Cores <span className="range-value">{cores}</span></label>
            <input type="range" min={1} max={64} value={cores} onChange={(e) => setCores(+e.target.value)} />
          </div>
          <div className="form-group">
            <label>RAM (GB) <span className="range-value">{ram}</span></label>
            <input type="range" min={2} max={256} value={ram} onChange={(e) => setRam(+e.target.value)} />
          </div>
          <div className="form-group">
            <label>Disk (GB) <span className="range-value">{disk}</span></label>
            <input type="range" min={10} max={500} value={disk} onChange={(e) => setDisk(+e.target.value)} />
          </div>
          <div className="form-group">
            <label>Image</label>
            <select value={image} onChange={(e) => setImage(e.target.value)}>
              {images.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>
          <div className="form-actions">
            <button
              className="primary"
              disabled={loading}
              onClick={async () => {
                try {
                  const res = await fetch(`/api/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(selectedNode)}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ site, cores, ram, disk, image }),
                  });
                  if (!res.ok) throw new Error(await res.text());
                  const result = await res.json();
                  onSliceUpdated(result);
                } catch (e: any) {
                  setError(e.message);
                }
              }}
            >
              Apply Changes
            </button>
          </div>

          {/* Boot Uploads Section */}
          <div className="boot-section">
            <div className="boot-section-header">
              <span>Boot Uploads</span>
              <button className="boot-btn-sm" onClick={() => setShowFilePicker(true)}>Browse...</button>
            </div>
            {bootConfig.uploads.length === 0 ? (
              <div className="boot-empty">No uploads configured</div>
            ) : (
              <div className="boot-uploads-table">
                {bootConfig.uploads.map((u) => (
                  <div key={u.id} className="boot-upload-row">
                    <div className="boot-upload-source" title={u.source}>{u.source}</div>
                    <input
                      type="text"
                      value={u.dest}
                      onChange={(e) => updateUploadDest(u.id, e.target.value)}
                      placeholder="/home/ubuntu/file"
                      className="boot-upload-dest"
                    />
                    <button className="boot-btn-remove" onClick={() => removeUpload(u.id)} title="Remove">X</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Network Config Section */}
          <div className="boot-section">
            <div className="boot-section-header">
              <span>Network Config</span>
              <button className="boot-btn-sm" onClick={addNetConfig}>Add</button>
            </div>
            {bootConfig.network.length === 0 ? (
              <div className="boot-empty">No network config</div>
            ) : (
              <div className="boot-net-list">
                {bootConfig.network.map((net, idx) => (
                  <div key={net.id} className="boot-net-row">
                    <div className="boot-net-row-top">
                      <input
                        type="text"
                        value={net.iface}
                        onChange={(e) => updateNetConfig(net.id, { iface: e.target.value })}
                        placeholder="eth1"
                        className="boot-net-iface"
                      />
                      <select
                        value={net.mode}
                        onChange={(e) => updateNetConfig(net.id, { mode: e.target.value as 'auto' | 'manual' })}
                        className="boot-net-mode"
                      >
                        <option value="auto">Auto (DHCP)</option>
                        <option value="manual">Manual</option>
                      </select>
                      <div className="boot-cmd-controls">
                        <button onClick={() => moveNetConfig(net.id, -1)} disabled={idx === 0} title="Move up">^</button>
                        <button onClick={() => moveNetConfig(net.id, 1)} disabled={idx === bootConfig.network.length - 1} title="Move down">v</button>
                        <button onClick={() => removeNetConfig(net.id)} title="Remove">X</button>
                      </div>
                    </div>
                    {net.mode === 'manual' && (
                      <div className="boot-net-manual">
                        <input
                          type="text"
                          value={net.ip || ''}
                          onChange={(e) => updateNetConfig(net.id, { ip: e.target.value })}
                          placeholder="IP (e.g. 10.0.0.1)"
                          className="boot-net-ip"
                        />
                        <input
                          type="text"
                          value={net.subnet || ''}
                          onChange={(e) => updateNetConfig(net.id, { subnet: e.target.value })}
                          placeholder="Prefix (e.g. 24)"
                          className="boot-net-subnet"
                        />
                        <input
                          type="text"
                          value={net.gateway || ''}
                          onChange={(e) => updateNetConfig(net.id, { gateway: e.target.value })}
                          placeholder="Gateway (optional)"
                          className="boot-net-gw"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Boot Commands Section */}
          <div className="boot-section">
            <div className="boot-section-header">
              <span>Boot Commands</span>
              <button className="boot-btn-sm" onClick={addCommand}>Add</button>
            </div>
            {bootConfig.commands.length === 0 ? (
              <div className="boot-empty">No commands configured</div>
            ) : (
              <div className="boot-commands-list">
                {bootConfig.commands.map((cmd, idx) => (
                  <div key={cmd.id} className="boot-command-row">
                    <input
                      type="text"
                      value={cmd.command}
                      onChange={(e) => updateCommand(cmd.id, e.target.value)}
                      placeholder="bash command..."
                      className="boot-cmd-input"
                    />
                    <div className="boot-cmd-controls">
                      <button onClick={() => moveCommand(cmd.id, -1)} disabled={idx === 0} title="Move up">^</button>
                      <button onClick={() => moveCommand(cmd.id, 1)} disabled={idx === bootConfig.commands.length - 1} title="Move down">v</button>
                      <button onClick={() => removeCommand(cmd.id)} title="Remove">X</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Boot Config Actions */}
          <div className="boot-actions">
            <button className="primary" onClick={handleSaveBoot} disabled={bootExecuting}>
              {bootSaved ? 'Saved' : 'Save Boot Config'}
            </button>
            <button onClick={handleExecuteBoot} disabled={bootExecuting || bootConfig.uploads.length + bootConfig.commands.length + bootConfig.network.length === 0}>
              {bootExecuting ? 'Executing...' : 'Execute Boot Config'}
            </button>
          </div>

          {/* Boot Results */}
          {bootResults.length > 0 && (
            <div className="boot-results">
              <div className="boot-section-header"><span>Results</span></div>
              {bootResults.map((r, i) => (
                <div key={i} className={`boot-result-row ${r.status}`}>
                  <span className="boot-result-type">{r.type}</span>
                  <span className={`boot-result-status ${r.status}`}>{r.status}</span>
                  {r.detail && <div className="boot-result-detail">{r.detail}</div>}
                </div>
              ))}
            </div>
          )}

          {/* File Picker Modal */}
          {showFilePicker && (
            <BootFilePicker
              onSelect={(path, isDir) => {
                addUpload(path, isDir);
                setShowFilePicker(false);
              }}
              onClose={() => setShowFilePicker(false)}
            />
          )}
        </>
      )}
    </>
  );
}


// --- Boot File Picker ---
function BootFilePicker({ onSelect, onClose }: {
  onSelect: (path: string, isDir: boolean) => void;
  onClose: () => void;
}) {
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selected, setSelected] = useState<{ name: string; type: string } | null>(null);

  useEffect(() => {
    setLoadingFiles(true);
    api.listFiles(currentPath)
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoadingFiles(false));
  }, [currentPath]);

  const breadcrumbs = currentPath ? currentPath.split('/').filter(Boolean) : [];

  return (
    <div className="boot-file-picker-overlay" onClick={onClose}>
      <div className="boot-file-picker" onClick={(e) => e.stopPropagation()}>
        <div className="boot-fp-header">
          <span>Select File or Folder</span>
          <button onClick={onClose}>X</button>
        </div>
        <div className="boot-fp-breadcrumb">
          <button onClick={() => { setCurrentPath(''); setSelected(null); }}>/</button>
          {breadcrumbs.map((part, i) => {
            const path = breadcrumbs.slice(0, i + 1).join('/');
            return (
              <span key={path}>
                {' / '}
                <button onClick={() => { setCurrentPath(path); setSelected(null); }}>{part}</button>
              </span>
            );
          })}
        </div>
        <div className="boot-fp-list">
          {loadingFiles ? (
            <div className="boot-empty">Loading...</div>
          ) : entries.length === 0 ? (
            <div className="boot-empty">Empty directory</div>
          ) : (
            entries.map((e) => (
              <div
                key={e.name}
                className={`boot-fp-entry ${selected?.name === e.name ? 'selected' : ''}`}
                onClick={() => {
                  if (e.type === 'dir') {
                    setSelected({ name: e.name, type: 'dir' });
                  } else {
                    setSelected({ name: e.name, type: 'file' });
                  }
                }}
                onDoubleClick={() => {
                  if (e.type === 'dir') {
                    setCurrentPath(currentPath ? `${currentPath}/${e.name}` : e.name);
                    setSelected(null);
                  } else {
                    const fullPath = currentPath ? `${currentPath}/${e.name}` : e.name;
                    onSelect(fullPath, false);
                  }
                }}
              >
                <span className="boot-fp-icon">{e.type === 'dir' ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                <span className="boot-fp-name">{e.name}</span>
                {e.type === 'file' && <span className="boot-fp-size">{(e.size / 1024).toFixed(1)}K</span>}
              </div>
            ))
          )}
        </div>
        <div className="boot-fp-actions">
          <button
            className="primary"
            disabled={!selected}
            onClick={() => {
              if (!selected) return;
              const fullPath = currentPath ? `${currentPath}/${selected.name}` : selected.name;
              onSelect(fullPath, selected.type === 'dir');
            }}
          >
            {selected?.type === 'dir' ? 'Select Folder' : 'Select File'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
