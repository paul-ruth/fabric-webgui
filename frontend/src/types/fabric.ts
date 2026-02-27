/** Types matching the backend API response shapes. */

export interface SliceSummary {
  name: string;
  id: string;
  state: string;
}

export interface SliceInterface {
  name: string;
  node_name: string;
  network_name: string;
  vlan: string;
  mac: string;
  ip_addr: string;
  bandwidth: string;
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
  host: string;
  cores: number;
  ram: number;
  disk: number;
  image: string;
  image_type: string;
  management_ip: string;
  reservation_state: string;
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

export interface SliceData {
  name: string;
  id: string;
  state: string;
  dirty: boolean;
  lease_end: string;
  nodes: SliceNode[];
  networks: SliceNetwork[];
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
