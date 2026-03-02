/** API client for the FABRIC Web GUI backend. */

import type { SliceSummary, SliceData, SiteInfo, SiteDetail, LinkInfo, ComponentModel, ConfigStatus, ProjectsResponse, ValidationResult, SiteMetrics, LinkMetrics, FileEntry, ProvisionRule, BootConfig, BootExecResult, SliceKeySet, VMTemplateSummary, VMTemplateDetail, HostInfo } from '../types/fabric';

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

export function archiveSlice(name: string): Promise<{ status: string; name: string }> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/archive`, { method: 'POST' });
}

export function archiveAllTerminal(): Promise<{ archived: string[]; count: number }> {
  return fetchJson('/slices/archive-terminal', { method: 'POST' });
}

export function renewLease(name: string, endDate: string): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/renew`, {
    method: 'POST',
    body: JSON.stringify({ end_date: endDate }),
  });
}

export function cloneSlice(name: string, newName: string): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/clone?new_name=${encodeURIComponent(newName)}`, { method: 'POST' });
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

export function updateNode(
  sliceName: string,
  nodeName: string,
  updates: { site?: string; host?: string; cores?: number; ram?: number; disk?: number; image?: string }
): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(nodeName)}`,
    { method: 'PUT', body: JSON.stringify(updates) }
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

// --- Facility Ports ---

export function addFacilityPort(
  sliceName: string,
  data: { name: string; site: string; vlan?: string; bandwidth?: number }
): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(sliceName)}/facility-ports`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function removeFacilityPort(sliceName: string, fpName: string): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/facility-ports/${encodeURIComponent(fpName)}`,
    { method: 'DELETE' }
  );
}

// --- Networks ---

export function addNetwork(
  sliceName: string,
  net: {
    name: string;
    type?: string;
    interfaces?: string[];
    subnet?: string;
    gateway?: string;
    ip_mode?: string;
    interface_ips?: Record<string, string>;
  }
): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(sliceName)}/networks`, {
    method: 'POST',
    body: JSON.stringify(net),
  });
}

export function updateNetwork(
  sliceName: string,
  netName: string,
  update: {
    subnet?: string;
    gateway?: string;
    ip_mode?: string;
    interface_ips?: Record<string, string>;
  }
): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/networks/${encodeURIComponent(netName)}`,
    { method: 'PUT', body: JSON.stringify(update) }
  );
}

export function removeNetwork(sliceName: string, netName: string): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/networks/${encodeURIComponent(netName)}`,
    { method: 'DELETE' }
  );
}

// --- Post-boot config ---

export function setPostBootConfig(
  sliceName: string,
  nodeName: string,
  script: string
): Promise<SliceData> {
  return fetchJson(
    `/slices/${encodeURIComponent(sliceName)}/nodes/${encodeURIComponent(nodeName)}/post-boot`,
    { method: 'PUT', body: JSON.stringify({ script }) }
  );
}

// --- Slice export/import ---

export async function exportSlice(name: string): Promise<void> {
  const res = await fetch(`${BASE}/slices/${encodeURIComponent(name)}/export`);
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.fabric.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function saveToStorage(name: string): Promise<{ status: string; path: string }> {
  return fetchJson(`/slices/${encodeURIComponent(name)}/save-to-storage`, { method: 'POST' });
}

export function listStorageFiles(): Promise<Array<{ name: string; size: number; modified: number }>> {
  return fetchJson('/slices/storage-files');
}

export function openFromStorage(filename: string): Promise<SliceData> {
  return fetchJson('/slices/open-from-storage', {
    method: 'POST',
    body: JSON.stringify({ filename }),
  });
}

export interface SliceModel {
  format: string;
  name: string;
  nodes: Array<{
    name: string;
    site: string;
    cores: number;
    ram: number;
    disk: number;
    image: string;
    post_boot_script?: string;
    components: Array<{ name: string; model: string }>;
  }>;
  networks: Array<{
    name: string;
    type: string;
    interfaces: string[];
    subnet?: string;
    gateway?: string;
    ip_mode?: string;
    interface_ips?: Record<string, string>;
  }>;
}

export function importSlice(model: SliceModel): Promise<SliceData> {
  return fetchJson('/slices/import', {
    method: 'POST',
    body: JSON.stringify(model),
  });
}

// --- Templates ---

export interface TemplateSummary {
  name: string;
  description: string;
  source_slice: string;
  created: string;
  node_count: number;
  network_count: number;
  dir_name: string;
  builtin?: boolean;
}

export function listTemplates(): Promise<TemplateSummary[]> {
  return fetchJson('/templates');
}

export function saveTemplate(data: { name: string; description: string; slice_name: string }): Promise<TemplateSummary> {
  return fetchJson('/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function loadTemplate(name: string, sliceName?: string): Promise<SliceData> {
  return fetchJson(`/templates/${encodeURIComponent(name)}/load`, {
    method: 'POST',
    body: JSON.stringify({ slice_name: sliceName || '' }),
  });
}

export function deleteTemplate(name: string): Promise<{ status: string; name: string }> {
  return fetchJson(`/templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// --- VM Templates ---

export function listVmTemplates(): Promise<VMTemplateSummary[]> {
  return fetchJson('/vm-templates');
}

export function getVmTemplate(name: string): Promise<VMTemplateDetail> {
  return fetchJson(`/vm-templates/${encodeURIComponent(name)}`);
}

export function saveVmTemplate(data: { name: string; description: string; image: string; boot_config: BootConfig }): Promise<VMTemplateDetail> {
  return fetchJson('/vm-templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateVmTemplate(name: string, data: { description?: string; image?: string; boot_config?: BootConfig }): Promise<VMTemplateDetail> {
  return fetchJson(`/vm-templates/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteVmTemplate(name: string): Promise<{ status: string; name: string }> {
  return fetchJson(`/vm-templates/${encodeURIComponent(name)}`, { method: 'DELETE' });
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

export function listSiteHosts(siteName: string): Promise<HostInfo[]> {
  return fetchJson(`/sites/${encodeURIComponent(siteName)}/hosts`);
}

export function resolveSites(sliceName: string, overrides?: Record<string, string>, resolveAll?: boolean): Promise<SliceData> {
  return fetchJson(`/slices/${encodeURIComponent(sliceName)}/resolve-sites`, {
    method: 'POST',
    body: JSON.stringify({ group_overrides: overrides || {}, resolve_all: resolveAll || false }),
  });
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
  publicKey: File,
  keyName = 'default',
): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append('private_key', privateKey);
  form.append('public_key', publicKey);
  const res = await fetch(`${BASE}/config/keys/slice?key_name=${encodeURIComponent(keyName)}`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export function generateSliceKeys(keyName = 'default'): Promise<{ status: string; public_key: string; message: string }> {
  return fetchJson(`/config/keys/slice/generate?key_name=${encodeURIComponent(keyName)}`, { method: 'POST' });
}

// --- Slice Key Sets ---

export function listSliceKeySets(): Promise<SliceKeySet[]> {
  return fetchJson('/config/keys/slice/list');
}

export async function uploadSliceKeysNamed(
  privateKey: File,
  publicKey: File,
  keyName: string,
): Promise<{ status: string; message: string }> {
  const form = new FormData();
  form.append('private_key', privateKey);
  form.append('public_key', publicKey);
  const res = await fetch(`${BASE}/config/keys/slice?key_name=${encodeURIComponent(keyName)}`, { method: 'POST', body: form });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export function setDefaultSliceKey(name: string): Promise<{ status: string; default: string }> {
  return fetchJson(`/config/keys/slice/default?key_name=${encodeURIComponent(name)}`, { method: 'PUT' });
}

export function deleteSliceKeySet(name: string): Promise<{ status: string; deleted: string }> {
  return fetchJson(`/config/keys/slice/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export function getSliceKeyAssignment(sliceName: string): Promise<{ slice_name: string; slice_key_id: string }> {
  return fetchJson(`/config/slice-key/${encodeURIComponent(sliceName)}`);
}

export function setSliceKeyAssignment(sliceName: string, keyId: string): Promise<{ status: string }> {
  return fetchJson(`/config/slice-key/${encodeURIComponent(sliceName)}`, {
    method: 'PUT',
    body: JSON.stringify({ slice_key_id: keyId }),
  });
}

// --- Files (container storage) ---

export function listFiles(path = ''): Promise<FileEntry[]> {
  return fetchJson(`/files?path=${encodeURIComponent(path)}`);
}

export async function uploadFiles(path: string, files: FileList | File[]): Promise<{ uploaded: string[] }> {
  const form = new FormData();
  for (const f of Array.from(files)) {
    form.append('files', f);
  }
  const res = await fetch(`${BASE}/files/upload?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Upload files with explicit relative paths (for folder drag-and-drop). */
export async function uploadFilesWithPaths(path: string, entries: Array<{ file: File; relativePath: string }>): Promise<{ uploaded: string[] }> {
  const form = new FormData();
  for (const { file, relativePath } of entries) {
    form.append('files', file, relativePath);
  }
  const res = await fetch(`${BASE}/files/upload?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

export function createFolder(path: string, name: string): Promise<{ created: string }> {
  return fetchJson(`/files/mkdir?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function downloadFile(path: string): Promise<void> {
  const url = `${BASE}/files/download?path=${encodeURIComponent(path)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = path.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export async function downloadFolder(path: string): Promise<void> {
  const url = `${BASE}/files/download-folder?path=${encodeURIComponent(path)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const folderName = path.split('/').pop() || 'folder';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

export function deleteFile(path: string): Promise<{ deleted: string }> {
  return fetchJson(`/files?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
}

export function readFileContent(path: string): Promise<{ path: string; content: string }> {
  return fetchJson(`/files/content?path=${encodeURIComponent(path)}`);
}

export function writeFileContent(path: string, content: string): Promise<{ path: string; status: string }> {
  return fetchJson('/files/content', {
    method: 'PUT',
    body: JSON.stringify({ path, content }),
  });
}

// --- Files (VM SFTP) ---

export function listVmFiles(sliceName: string, nodeName: string, path = '/home'): Promise<FileEntry[]> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}?path=${encodeURIComponent(path)}`);
}

export function downloadVmFile(sliceName: string, nodeName: string, remotePath: string, destDir: string): Promise<{ downloaded: string; local_path: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/download`, {
    method: 'POST',
    body: JSON.stringify({ remote_path: remotePath, dest_dir: destDir }),
  });
}

export function uploadToVm(sliceName: string, nodeName: string, source: string, dest: string): Promise<{ uploaded: string; remote_path: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/upload`, {
    method: 'POST',
    body: JSON.stringify({ source, dest }),
  });
}

/** Upload files directly from the browser to a VM (bypassing container storage). */
export async function uploadDirectToVm(
  sliceName: string,
  nodeName: string,
  destPath: string,
  files: FileList | File[],
): Promise<{ uploaded: string[] }> {
  const form = new FormData();
  for (const f of Array.from(files)) {
    form.append('files', f);
  }
  const res = await fetch(
    `${BASE}/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/upload-direct?dest_path=${encodeURIComponent(destPath)}`,
    { method: 'POST', body: form },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Upload files with explicit relative paths directly to a VM (for folder drag-and-drop). */
export async function uploadDirectToVmWithPaths(
  sliceName: string,
  nodeName: string,
  destPath: string,
  entries: Array<{ file: File; relativePath: string }>,
): Promise<{ uploaded: string[] }> {
  const form = new FormData();
  for (const { file, relativePath } of entries) {
    form.append('files', file, relativePath);
  }
  const res = await fetch(
    `${BASE}/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/upload-direct?dest_path=${encodeURIComponent(destPath)}`,
    { method: 'POST', body: form },
  );
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`API error ${res.status}: ${detail}`);
  }
  return res.json();
}

/** Download a file from a VM directly to the browser/desktop. */
export async function downloadDirectFromVm(
  sliceName: string,
  nodeName: string,
  remotePath: string,
): Promise<void> {
  const url = `${BASE}/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/download-direct?remote_path=${encodeURIComponent(remotePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = remotePath.split('/').pop() || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** Download a folder from a VM as a zip file to the browser/desktop. */
export async function downloadFolderFromVm(
  sliceName: string,
  nodeName: string,
  remotePath: string,
): Promise<void> {
  const url = `${BASE}/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/download-folder?remote_path=${encodeURIComponent(remotePath)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const folderName = remotePath.split('/').pop() || 'folder';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${folderName}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

/** Create a directory on the VM. */
export function vmMkdir(sliceName: string, nodeName: string, path: string): Promise<{ created: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/mkdir`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/** Delete a file or directory on the VM. */
export function vmDelete(sliceName: string, nodeName: string, path: string): Promise<{ deleted: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/delete`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/** Execute an ad-hoc command on a VM node. */
export function executeOnVm(sliceName: string, nodeName: string, command: string): Promise<{ stdout: string; stderr: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/execute`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  });
}

/** Read a text file from a VM for in-browser editing. */
export function readVmFileContent(sliceName: string, nodeName: string, path: string): Promise<{ path: string; content: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/read-content`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

/** Write a text file on a VM from in-browser editor. */
export function writeVmFileContent(sliceName: string, nodeName: string, path: string, content: string): Promise<{ path: string; status: string }> {
  return fetchJson(`/files/vm/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/write-content`, {
    method: 'POST',
    body: JSON.stringify({ path, content }),
  });
}

// --- Provisioning ---

export function addProvision(rule: { source: string; slice_name: string; node_name: string; dest: string }): Promise<ProvisionRule> {
  return fetchJson('/files/provisions', {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

export function listProvisions(sliceName: string): Promise<ProvisionRule[]> {
  return fetchJson(`/files/provisions/${encodeURIComponent(sliceName)}`);
}

export function deleteProvision(sliceName: string, id: string): Promise<{ deleted: string }> {
  return fetchJson(`/files/provisions/${encodeURIComponent(sliceName)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function executeProvisions(sliceName: string, nodeName?: string): Promise<Array<{ id: string; status: string; detail?: string }>> {
  const q = nodeName ? `?node_name=${encodeURIComponent(nodeName)}` : '';
  return fetchJson(`/files/provisions/${encodeURIComponent(sliceName)}/execute${q}`, { method: 'POST' });
}

// --- Boot Config ---

export function getBootConfig(sliceName: string, nodeName: string): Promise<BootConfig> {
  return fetchJson(`/files/boot-config/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}`);
}

export function saveBootConfig(sliceName: string, nodeName: string, config: BootConfig): Promise<BootConfig> {
  return fetchJson(`/files/boot-config/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function executeBootConfig(sliceName: string, nodeName: string): Promise<BootExecResult[]> {
  return fetchJson(`/files/boot-config/${encodeURIComponent(sliceName)}/${encodeURIComponent(nodeName)}/execute`, {
    method: 'POST',
  });
}

export function executeAllBootConfigs(sliceName: string): Promise<Record<string, BootExecResult[]>> {
  return fetchJson(`/files/boot-config/${encodeURIComponent(sliceName)}/execute-all`, {
    method: 'POST',
  });
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
