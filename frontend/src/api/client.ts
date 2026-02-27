/** API client for the FABRIC Web GUI backend. */

import type { SliceSummary, SliceData, SiteInfo, SiteDetail, LinkInfo, ComponentModel, ConfigStatus, ProjectsResponse, ValidationResult, SiteMetrics, LinkMetrics } from '../types/fabric';

const BASE = '/api';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

// --- Slices ---

export function listSlices(): Promise<SliceSummary[]> {
  return fetchJson('/slices');
}

export function getSlice(name: string): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(name)}`);
}

export function createSlice(name: string): Promise<SliceData> {
  return fetchJson(`/slices?name=${encodeURIComponent(name)}`, { method: 'POST' });
}

export function submitSlice(name: string): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/submit`, { method: 'POST' });
}

export function refreshSlice(name: string): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/refresh`, { method: 'POST' });
}

export function validateSlice(name: string): Promise<ValidationResult> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/validate`);
}

export function deleteSlice(name: string): Promise<{ status: string }> {
  return fetchJson(`/slices/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- Nodes ---

export function addNode(
  sliceName: string,
  node: { name: string; site?: string; cores?: number; ram?: number; disk?: number; image?: string }
): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(sliceName)}/nodes`, {
    method: 'POST',
    body: JSON.stringify(node),
  });
}

export function removeNode(sliceName: string, nodeName: string): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(nodeName)}`,
    { method: 'DELETE' }
  );
}

// --- Components ---

export function addComponent(
  sliceName: string,
  nodeName: string,
  comp: { name: string; model: string }
): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(nodeName)}/components`,
    { method: 'POST', body: JSON.stringify(comp) }
  );
}

export function removeComponent(
  sliceName: string,
  nodeName: string,
  compName: string
): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(nodeName)}/components/${encodeURIComponent(compName)}`,
    { method: 'DELETE' }
  );
}

// --- Networks ---

export function addNetwork(
  sliceName: string,
  net: { name: string; type?: string; interfaces?: string[] }
): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(sliceName)}/networks`, {
    method: 'POST',
    body: JSON.stringify(net),
  });
}

export function removeNetwork(sliceName: string, netName: string): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/networks/${encodeURIComponent(netName)}`,
    { method: 'DELETE' }
  );
}

// --- Resources ---

export function listSites(): Promise<SiteInfo[]> {
  return fetchJson('/sites');
}

export function listLinks(): Promise<LinkInfo[]> {
  return fetchJson('/links');
}

export function getSiteDetail(name: string): Promise<SiteDetail> {
  return fetchJson(`/sites/${encodeURIComponent(name)}`);
}

export function getSiteMetrics(name: string): Promise<SiteMetrics> {
  return fetchJson(`/metrics/site/${encodeURIComponent(name)}`);
}

export function getLinkMetrics(siteA: string, siteB: string): Promise<LinkMetrics> {
  return fetchJson(`/metrics/link/${encodeURIComponent(siteA)}/${encodeURIComponent(siteB)}`);
}

export function listImages(): Promise<string[]> {
  return fetchJson('/images');
}

export function listComponentModels(): Promise<ComponentModel[]> {
  return fetchJson('/component-models');
}

// --- Config ---

export function getConfig(): Promise<ConfigStatus> {
  return fetchJson('/config');
}

export async function uploadToken(file: File): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/config/token`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export function getLoginUrl(): Promise<{ login_url: string }> {
  return fetchJson('/config/login');
}

export function pasteToken(tokenText: string): Promise<{ status: string; message: string }> {
  return fetchJson('/config/token/paste', {
    method: 'POST',
    body: JSON.stringify({ token_text: tokenText }),
  });
}

export function getProjects(): Promise<ProjectsResponse> {
  return fetchJson('/config/projects');
}

export async function uploadBastionKey(file: File): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/config/keys/bastion`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export async function uploadSliceKeys(
  privateKey: File,
  publicKey: File
): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append('private_key', privateKey);
  form.append('public_key', publicKey);
  const res = await fetch(`${BASE}/config/keys/slice`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export function generateSliceKeys(): Promise<{ status: string; public_key: string; message: string }> {
  return fetchJson('/config/keys/slice/generate', { method: 'POST' });
}

export function saveConfig(config: {
  project_id: string;
  bastion_username: string;
  credmgr_host?: string;
  orchestrator_host?: string;
  core_api_host?: string;
  bastion_host?: string;
  am_host?: string;
  log_level?: string;
  log_file?: string;
  avoid?: string;
  ssh_command_line?: string;
}): Promise<{ status: string; configured: boolean }> {
  return fetchJson('/config/save', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}
