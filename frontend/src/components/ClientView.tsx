'use client';
import { useState, useEffect, useCallback } from 'react';
import type { SliceSummary, SliceData } from '../types/fabric';
import * as api from '../api/client';
import '../styles/client-view.css';

export interface ClientTarget {
  sliceName: string;
  nodeName: string;
  port: number;
}

interface ClientViewProps {
  slices: SliceSummary[];
  selectedSliceName: string;
  sliceData: SliceData | null;
  clientTarget: ClientTarget | null;
  onTargetChange: (target: ClientTarget | null) => void;
}

export default function ClientView({ slices, selectedSliceName, sliceData, clientTarget, onTargetChange }: ClientViewProps) {
  const [sliceName, setSliceName] = useState(clientTarget?.sliceName || selectedSliceName || '');
  const [nodeName, setNodeName] = useState(clientTarget?.nodeName || '');
  const [port, setPort] = useState(clientTarget?.port || 3000);
  const [iframeSrc, setIframeSrc] = useState('');
  const [iframeDark, setIframeDark] = useState(false);
  const [localSliceData, setLocalSliceData] = useState<SliceData | null>(
    sliceName === selectedSliceName ? sliceData : null
  );

  // When clientTarget changes externally (e.g. from context menu), update local state
  useEffect(() => {
    if (clientTarget) {
      setSliceName(clientTarget.sliceName);
      setNodeName(clientTarget.nodeName);
      setPort(clientTarget.port);
      setIframeSrc(`/api/proxy/${encodeURIComponent(clientTarget.sliceName)}/${encodeURIComponent(clientTarget.nodeName)}/${clientTarget.port}/`);
    }
  }, [clientTarget]);

  // Load slice data when slice selection changes
  useEffect(() => {
    if (sliceName === selectedSliceName && sliceData) {
      setLocalSliceData(sliceData);
      return;
    }
    if (!sliceName) {
      setLocalSliceData(null);
      return;
    }
    let cancelled = false;
    api.getSlice(sliceName).then((data) => {
      if (!cancelled) setLocalSliceData(data);
    }).catch(() => {
      if (!cancelled) setLocalSliceData(null);
    });
    return () => { cancelled = true; };
  }, [sliceName, selectedSliceName, sliceData]);

  // Filter nodes with management_ip
  const nodes = (localSliceData?.nodes ?? []).filter((n) => n.management_ip);

  // Auto-select first node if current nodeName not valid
  useEffect(() => {
    if (nodes.length > 0 && !nodes.find((n) => n.name === nodeName)) {
      setNodeName(nodes[0].name);
    }
  }, [nodes, nodeName]);

  const handleConnect = useCallback(() => {
    if (!sliceName || !nodeName || !port) return;
    const src = `/api/proxy/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/${port}/`;
    setIframeSrc(src);
    onTargetChange({ sliceName, nodeName, port });
  }, [sliceName, nodeName, port, onTargetChange]);

  return (
    <div className="client-view">
      <div className="client-toolbar">
        <label>Slice</label>
        <select value={sliceName} onChange={(e) => { setSliceName(e.target.value); setIframeSrc(''); }}>
          <option value="">-- select --</option>
          {slices.filter((s) => s.state === 'StableOK' || s.state === 'ModifyOK').map((s) => (
            <option key={s.name} value={s.name}>{s.name}</option>
          ))}
        </select>

        <div className="client-sep" />

        <label>Node</label>
        <select value={nodeName} onChange={(e) => { setNodeName(e.target.value); setIframeSrc(''); }}>
          {nodes.length === 0 && <option value="">-- no nodes --</option>}
          {nodes.map((n) => (
            <option key={n.name} value={n.name}>{n.name}</option>
          ))}
        </select>

        <div className="client-sep" />

        <label>Port</label>
        <input
          type="number"
          min={1}
          max={65535}
          value={port}
          onChange={(e) => setPort(parseInt(e.target.value) || 3000)}
        />

        <button onClick={handleConnect}>Connect</button>

        <div className="client-sep" />

        <label>Theme</label>
        <button
          onClick={() => setIframeDark((d) => !d)}
          style={{ minWidth: 56 }}
        >
          {iframeDark ? 'Dark' : 'Light'}
        </button>

        {iframeSrc && (
          <>
            <div className="client-sep" />
            <span className="client-url">{iframeSrc}</span>
          </>
        )}
      </div>

      {iframeSrc ? (
        <div
          className="client-iframe-wrap"
          style={iframeDark ? { filter: 'invert(1) hue-rotate(180deg)' } : undefined}
        >
          <iframe src={iframeSrc} title="Client View" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />
        </div>
      ) : (
        <div className="client-placeholder">
          Select a slice, node, and port, then click Connect to view the web service.
        </div>
      )}
    </div>
  );
}
