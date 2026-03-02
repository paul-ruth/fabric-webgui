/** Types matching the backend API response shapes. */

export interface SliceSummary {
  name: string;
  id: string;
  state: string;
  archived?: boolean;
  has_errors?: boolean;
}

export interface SliceInterface {
  name: string;
  node_name: string;
  network_name: string;
  vlan: string;
  mac: string;
  ip_addr: string;
  bandwidth: string;
  mode: string;
}

export interface SliceComponent {
  name: string;
  model: string;
  type: string;
  interfaces: SliceInterface[];
}

export interface SliceNode {
  name: string;
  site: string;
  site_group?: string;
  host: string;
  cores: number;
  ram: number;
  disk: number;
  image: string;
  image_type: string;
  management_ip: string;
  reservation_state: string;
  error_message: string;
  username: string;
  components: SliceComponent[];
  interfaces: SliceInterface[];
}

export interface SliceNetwork {
  name: string;
  type: string;
  layer: string;
  subnet: string;
  gateway: string;
  interfaces: SliceInterface[];
}

export interface CyNode {
  data: Record<string, string>;
  classes: string;
}

export interface CyEdge {
  data: Record<string, string>;
  classes: string;
}

export interface CyGraph {
  nodes: CyNode[];
  edges: CyEdge[];
}

export interface SliceFacilityPort {
  name: string;
  site: string;
  vlan: string;
  bandwidth: string;
  interfaces: SliceInterface[];
}

export interface SliceErrorMessage {
  sliver: string;
  message: string;
}

export interface SliceData {
  name: string;
  id: string;
  state: string;
  dirty: boolean;
  lease_start: string;
  lease_end: string;
  error_messages: SliceErrorMessage[];
  nodes: SliceNode[];
  networks: SliceNetwork[];
  facility_ports: SliceFacilityPort[];
  graph: CyGraph;
}

export interface SiteInfo {
  name: string;
  lat: number;
  lon: number;
  state: string;
  hosts: number;
  cores_available: number;
  cores_capacity: number;
  ram_available: number;
  ram_capacity: number;
  disk_available: number;
  disk_capacity: number;
}

export interface ComponentModel {
  model: string;
  type: string;
  description: string;
}

export interface HostInfo {
  name: string;
  cores_available: number;
  cores_capacity: number;
  ram_available: number;
  ram_capacity: number;
  disk_available: number;
  disk_capacity: number;
  components: Record<string, { available: number; capacity: number }>;
}

export interface LinkInfo {
  site_a: string;
  site_b: string;
}

export interface ComponentResource {
  available: number;
  allocated: number;
  capacity: number;
}

export interface SiteDetail extends SiteInfo {
  cores_allocated: number;
  ram_allocated: number;
  disk_allocated: number;
  components: Record<string, ComponentResource>;
}

export interface PrometheusResult {
  metric: Record<string, string>;
  value: [number, string];
}

export interface SiteMetrics {
  site: string;
  node_load1: PrometheusResult[];
  node_load5: PrometheusResult[];
  node_load15: PrometheusResult[];
  dataplaneInBits: PrometheusResult[];
  dataplaneOutBits: PrometheusResult[];
}

export interface LinkMetrics {
  site_a: string;
  site_b: string;
  a_to_b_in: PrometheusResult[];
  a_to_b_out: PrometheusResult[];
  b_to_a_in: PrometheusResult[];
  b_to_a_out: PrometheusResult[];
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  remedy: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface SliceKeySet {
  name: string;
  is_default: boolean;
  fingerprint: string;
  pub_key: string;
}

export interface ConfigStatus {
  configured: boolean;
  has_token: boolean;
  has_bastion_key: boolean;
  has_slice_key: boolean;
  token_info: {
    email?: string;
    name?: string;
    exp?: number;
    projects?: ProjectInfo[];
    error?: string;
  } | null;
  project_id: string;
  bastion_username: string;
  bastion_pub_key?: string;
  bastion_key_fingerprint?: string;
  slice_pub_key?: string;
  slice_key_fingerprint?: string;
  default_slice_key?: string;
  slice_key_sets?: string[];
}

export interface ProjectInfo {
  uuid: string;
  name: string;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
  bastion_login: string;
  email: string;
  name: string;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modified: string;
}

export interface ProvisionRule {
  id: string;
  source: string;
  slice_name: string;
  node_name: string;
  dest: string;
}

export interface BootUpload {
  id: string;
  source: string;   // path relative to container storage
  dest: string;      // absolute path on VM
}

export interface BootCommand {
  id: string;
  command: string;
  order: number;
}

export interface BootNetConfig {
  id: string;
  iface: string;
  mode: 'auto' | 'manual';
  ip?: string;
  subnet?: string;
  gateway?: string;
  order: number;
}

export interface BootConfig {
  uploads: BootUpload[];
  commands: BootCommand[];
  network: BootNetConfig[];
}

export interface VMTemplateSummary {
  name: string;
  description: string;
  image: string;
  created: string;
  builtin: boolean;
  dir_name: string;
}

export interface VMTemplateDetail extends VMTemplateSummary {
  boot_config: BootConfig;
}

export interface BootExecResult {
  type: 'upload' | 'command' | 'network';
  id: string;
  status: 'ok' | 'error';
  detail?: string;
}
