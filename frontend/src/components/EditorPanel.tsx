import { useState, useEffect } from 'react';
import type { SliceData, SiteInfo, ComponentModel } from '../types/fabric';
import * as api from '../api/client';
import '../styles/editor.css';

type Tab = 'node' | 'component' | 'network' | 'remove' | 'configure';

interface EditorPanelProps {
  sliceData: SliceData | null;
  sliceName: string;
  onSliceUpdated: (data: SliceData) => void;
  onCollapse: () => void;
}

export default function EditorPanel({ sliceData, sliceName, onSliceUpdated, onCollapse }: EditorPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('node');
  const [sites, setSites] = useState<SiteInfo[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [componentModels, setComponentModels] = useState<ComponentModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.listImages().then(setImages).catch(() => {});
    api.listComponentModels().then(setComponentModels).catch(() => {});
    api.listSites().then(setSites).catch(() => {});
  }, []);

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
  onSubmit: (data: { name: string; type: string; interfaces: string[] }) => void;
}) {
  const [name, setName] = useState('');
  const [layer, setLayer] = useState<'L2' | 'L3'>('L2');
  const [netType, setNetType] = useState('L2Bridge');
  const [selectedIfaces, setSelectedIfaces] = useState<string[]>([]);

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
      <div className="form-actions">
        <button
          className="primary"
          disabled={!name || loading}
          onClick={() => onSubmit({ name, type: netType, interfaces: selectedIfaces })}
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

  useEffect(() => {
    if (node) {
      setSite(node.site);
      setCores(node.cores);
      setRam(node.ram);
      setDisk(node.disk);
      setImage(node.image);
    }
  }, [node]);

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
                  // Use the updateNode API — not yet implemented, but we have PUT
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
        </>
      )}
    </>
  );
}
