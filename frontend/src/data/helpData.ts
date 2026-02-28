export interface HelpEntry {
  id: string;
  label: string;
  tooltip: string;
  description: string;
  section: string;
}

export interface HelpSection {
  id: string;
  title: string;
  entries: HelpEntry[];
}

const entries: HelpEntry[] = [
  // --- Title Bar ---
  { id: 'titlebar.view', label: 'View Selector', tooltip: 'Switch between Topology, Map, and Files views', section: 'titlebar',
    description: 'The View selector lets you switch between three main views: Topology (Cytoscape graph editor), Map (geographic Leaflet view showing FABRIC sites), and Files (dual-panel file manager for VM file transfer). The current view is shown in the pill button.' },
  { id: 'titlebar.project', label: 'Project Selector', tooltip: 'Switch active FABRIC project', section: 'titlebar',
    description: 'Select which FABRIC project to work with. Changing the project resets the current slice and reloads the slice list for the new project. Projects are determined by your FABRIC token.' },
  { id: 'titlebar.settings', label: 'Settings', tooltip: 'Open configuration panel', section: 'titlebar',
    description: 'Opens the Settings panel where you can manage your FABRIC token, SSH keys, bastion username, project selection, and site preferences. The settings panel must be configured before you can use other features.' },
  { id: 'titlebar.theme', label: 'Theme Toggle', tooltip: 'Switch between light and dark mode', section: 'titlebar',
    description: 'Toggles between light and dark color themes. Your preference is saved in the browser and persists across sessions.' },
  { id: 'titlebar.help', label: 'Help', tooltip: 'Open the help page', section: 'titlebar',
    description: 'Opens this help page with documentation for all features and controls.' },

  // --- Toolbar: Slice ---
  { id: 'toolbar.slice-selector', label: 'Slice Selector', tooltip: 'Choose a slice to work with', section: 'toolbar',
    description: 'Dropdown listing all your FABRIC slices grouped by state. FABRIC slices show their current state (StableOK, Configuring, etc.) while local drafts appear separately. Select a slice then click Load to open it.' },
  { id: 'toolbar.load', label: 'Load / Reload / Revert', tooltip: 'Load or reload slice data from FABRIC', section: 'toolbar',
    description: 'Loads the selected slice from FABRIC. If a slice is already loaded, the button changes to "Reload" (fetch latest state) or "Revert" (discard unsaved local changes). Revert asks for confirmation before discarding changes.' },
  { id: 'toolbar.new', label: 'New Slice', tooltip: 'Create a new empty draft slice', section: 'toolbar',
    description: 'Creates a new empty draft slice. Enter a name and press Enter or click Create. The new slice appears in the editor as a local draft that you can add nodes and networks to before submitting to FABRIC.' },
  { id: 'toolbar.submit', label: 'Submit', tooltip: 'Submit slice to FABRIC for provisioning', section: 'toolbar',
    description: 'Submits the current slice to FABRIC. For draft slices, this creates and provisions the slice on the testbed. For existing slices with modifications, this applies the changes. The button color indicates validation status: green if valid, yellow if there are warnings.' },
  { id: 'toolbar.delete', label: 'Delete Slice', tooltip: 'Delete this slice from FABRIC', section: 'toolbar',
    description: 'Permanently deletes the current slice from FABRIC, releasing all resources. Requires confirmation before proceeding. This action cannot be undone.' },

  // --- Toolbar: Templates ---
  { id: 'toolbar.save-template', label: 'Save Template', tooltip: 'Save topology as a reusable template', section: 'toolbar',
    description: 'Saves the current slice topology as a .fabric.json template file. Templates capture the node configurations, components, and network topology so you can recreate similar experiments later.' },
  { id: 'toolbar.open-template', label: 'Open Template', tooltip: 'Load a saved topology template', section: 'toolbar',
    description: 'Opens a previously saved topology template to create a new draft slice with the same layout. Select from available .fabric.json files in the storage directory.' },

  // --- Toolbar: Refresh ---
  { id: 'toolbar.refresh-resources', label: 'Refresh Resources', tooltip: 'Refresh site and link data from FABRIC', section: 'toolbar',
    description: 'Fetches the latest site availability, resource capacity, and network link information from FABRIC. This updates the site selector in the editor, the geographic map, and metrics displays.' },

  // --- Editor Panel: Sliver Selector ---
  { id: 'editor.sliver-selector', label: 'Sliver Selector', tooltip: 'Select or filter existing slivers in the slice', section: 'editor',
    description: 'The combo box at the top of the editor lets you select an existing sliver (VM, network, or facility port) to view or edit. Type to filter by name. Slivers are grouped by type. Clicking a node in the topology graph also selects it here.' },
  { id: 'editor.add-button', label: 'Add Sliver', tooltip: 'Add a new sliver to the slice', section: 'editor',
    description: 'The "+" button opens a menu to add a new sliver. Choose from: VM Node, Network (L2), Network (L3), or Facility Port. Each option opens a blank form for configuring the new element.' },

  // --- Editor Panel: Tabs ---
  { id: 'editor.node-tab', label: 'Node Tab', tooltip: 'Add virtual machines to the slice', section: 'editor',
    description: 'Configure and add virtual machine nodes. Set the node name, target site (or "auto" for automatic placement), CPU cores, RAM, disk size, and operating system image. Click "Add Node" to add to the current slice.\n\nFABlib code:\n```python\nslice.add_node(name="node1", site="RENC", cores=4, ram=16, disk=100, image="default_ubuntu_22")\n```\nDocs: https://fabric-fablib.readthedocs.io/en/latest/node.html' },
  { id: 'editor.devices-tab', label: 'Devices Tab', tooltip: 'Add components (NICs, GPUs, etc.) to nodes', section: 'editor',
    description: 'Attach hardware components to existing nodes. Select a target node, choose a component model (NIC_Basic, NIC_ConnectX_5, GPU_Tesla_T4, FPGA_Xilinx_U280, NVMe_P4510, etc.), name it, and click "Add Component".\n\nFABlib code:\n```python\nnode.add_component(model="NIC_Basic", name="nic1")\n```\nDocs: https://fabric-fablib.readthedocs.io/en/latest/component.html' },
  { id: 'editor.network-tab', label: 'Network Tab', tooltip: 'Create L2/L3 networks between nodes', section: 'editor',
    description: 'Create network connections between node interfaces. Choose L2 (Bridge, STS, PTP) or L3 (IPv4, IPv6, with external options). Select unattached interfaces, optionally configure subnet/gateway/IP assignment, then click "Add Network".\n\nFABlib code (L2):\n```python\nslice.add_l2network(name="net1", interfaces=[iface1, iface2], type="L2Bridge")\n```\nFABlib code (L3):\n```python\nslice.add_l3network(name="net1", interfaces=[iface1, iface2], type="IPv4")\n```\nDocs: https://fabric-fablib.readthedocs.io/en/latest/network_service.html' },
  { id: 'editor.facility-port', label: 'Facility Port', tooltip: 'Add a facility port for external connectivity', section: 'editor',
    description: 'Facility ports connect your slice to external networks (e.g. campus networks, other testbeds) via a dedicated VLAN at a specific site. Configure the name, site, VLAN ID, and bandwidth.\n\nFABlib code:\n```python\nslice.add_facility_port(name="fp1", site="RENC", vlan="100", bandwidth=10)\n```\nDocs: https://fabric-fablib.readthedocs.io/en/latest/facility_port.html' },

  // --- Editor: Node fields ---
  { id: 'editor.node.name', label: 'Node Name', tooltip: 'Unique name for this VM within the slice', section: 'editor',
    description: 'A unique identifier for the virtual machine within this slice. Must be unique across all nodes in the slice. Use alphanumeric characters, hyphens, and underscores. This name is used in the topology graph, terminal tabs, and as the VM hostname.' },
  { id: 'editor.node.site', label: 'Site', tooltip: 'FABRIC site where the VM will be deployed', section: 'editor',
    description: 'The FABRIC data center site where this VM will be provisioned. Choose "auto" to let FABRIC pick the best available site based on resource availability. Selecting a specific site guarantees placement there but may fail if the site lacks sufficient resources. Some component models (GPUs, FPGAs, SmartNICs) are only available at certain sites — check site capacity before choosing.' },
  { id: 'editor.node.cores', label: 'Cores', tooltip: 'Number of CPU cores (1–64)', section: 'editor',
    description: 'The number of virtual CPU cores allocated to this VM. Range: 1–64. Higher core counts consume more of the site\'s capacity and may limit which sites can host the node. Most experiments work well with 2–8 cores. Requesting more than 32 cores may require specific sites with large hosts.' },
  { id: 'editor.node.ram', label: 'RAM', tooltip: 'Memory in GB (2–256)', section: 'editor',
    description: 'Amount of RAM in gigabytes allocated to this VM. Range: 2–256 GB. Memory is drawn from the host machine\'s pool. Large allocations (>64 GB) may only be available at sites with high-memory hosts. The RAM-to-core ratio should generally stay within 1:1 to 8:1 for efficient resource utilization.' },
  { id: 'editor.node.disk', label: 'Disk', tooltip: 'Root disk size in GB (10–500)', section: 'editor',
    description: 'Size of the VM\'s root disk in gigabytes. Range: 10–500 GB. This is the primary storage volume where the OS and user data reside. For additional storage, attach NVMe components via the Devices tab. Very large disks (>200 GB) may take longer to provision.' },
  { id: 'editor.node.image', label: 'Image', tooltip: 'Operating system image for the VM', section: 'editor',
    description: 'The operating system image to install on this VM. Available images include various Ubuntu, CentOS, Debian, Rocky Linux, and Fedora versions. The "default_ubuntu_22" image is recommended for most use cases. Some images may have specific driver support needed for GPU or FPGA components. The image determines the base OS, pre-installed packages, and kernel version.' },

  // --- Editor: Component fields ---
  { id: 'editor.comp.target-node', label: 'Target Node', tooltip: 'Node to attach this component to', section: 'editor',
    description: 'The VM node that will receive this hardware component. The component will be physically attached to the host machine where this node is deployed. Only nodes already added to the slice are listed. Some component models constrain which sites can host the node.' },
  { id: 'editor.comp.model', label: 'Model', tooltip: 'Hardware component type to attach', section: 'editor',
    description: 'The hardware component model to attach. Available models include: NIC_Basic (shared virtual NIC, available everywhere), NIC_ConnectX_5/6 (dedicated 25 Gbps SmartNIC, limited sites), GPU_Tesla_T4/A30/A40/RTX6000 (GPU accelerators, specific sites only), FPGA_Xilinx_U280 (FPGA accelerator, very limited), NVMe_P4510 (fast NVMe storage, adds a dedicated disk). Dedicated NICs (ConnectX) are required for SR-IOV and high-performance networking. GPU and FPGA models constrain the node to sites that have those resources.' },
  { id: 'editor.comp.name', label: 'Component Name', tooltip: 'Unique name for this component on the node', section: 'editor',
    description: 'A unique name for this component within its parent node. Must be unique among all components on the same node. Use descriptive names like "nic1", "gpu0", or "storage1". This name appears in the topology graph and is used to reference the component\'s interfaces when creating networks.' },

  // --- Editor: Network fields ---
  { id: 'editor.net.name', label: 'Network Name', tooltip: 'Unique name for this network in the slice', section: 'editor',
    description: 'A unique identifier for this network within the slice. Must be unique across all networks in the slice. Use descriptive names like "net1", "data-net", or "mgmt-lan". This name appears in the topology graph and is used to identify the network in API operations.' },
  { id: 'editor.net.layer', label: 'Layer', tooltip: 'L2 (data link) or L3 (IP routed)', section: 'editor',
    description: 'The network layer determines how traffic is handled. L2 (Layer 2): Ethernet-level switching — nodes see each other\'s MAC addresses and you manage IP configuration yourself. Best for custom protocols, VLANs, or when you need full control. L3 (Layer 3): IP-routed networking — FABRIC assigns subnets, gateways, and IPs automatically. Simpler setup but less flexibility. L3 networks cannot have manually assigned IPs.' },
  { id: 'editor.net.type', label: 'Network Type', tooltip: 'Specific network service type', section: 'editor',
    description: 'L2 types: L2Bridge (multi-point bridge, connects 2+ interfaces at one site), L2STS (site-to-site, connects exactly 2 interfaces across different sites), L2PTP (point-to-point, dedicated link between exactly 2 interfaces). L3 types: IPv4/IPv6 (auto-configured IP network), IPv4Ext/IPv6Ext (provides external internet connectivity). PTP gives the best performance but only links two nodes. Bridge supports multiple nodes but only within one site. STS connects nodes across sites.' },
  { id: 'editor.net.interfaces', label: 'Interfaces', tooltip: 'Node interfaces to connect to this network', section: 'editor',
    description: 'Select which node interfaces to attach to this network. Only unattached interfaces (not already in a network) are shown. Interfaces are created when you add NIC components to nodes via the Devices tab. PTP networks require exactly 2 interfaces. Bridge networks require 2+ interfaces at the same site. STS networks require exactly 2 interfaces at different sites. Hold Ctrl/Cmd to select multiple interfaces.' },
  { id: 'editor.net.subnet', label: 'Subnet', tooltip: 'Optional IPv4 subnet in CIDR notation', section: 'editor',
    description: 'An optional IPv4 subnet for this L2 network in CIDR notation (e.g., 192.168.1.0/24). If provided, FABRIC can assign IPs to interfaces from this range. Use private address ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x). The subnet size must be large enough to accommodate all connected interfaces plus a gateway. Leave blank to handle IP configuration manually after deployment.' },
  { id: 'editor.net.gateway', label: 'Gateway', tooltip: 'Optional gateway IP within the subnet', section: 'editor',
    description: 'An optional gateway IP address within the configured subnet (e.g., 192.168.1.1). The gateway must be a valid IP within the subnet range. This is typically the first or last usable address in the subnet. If omitted, no default route is configured on the interfaces.' },
  { id: 'editor.net.ip-mode', label: 'IP Assignment', tooltip: 'How IPs are assigned to interfaces', section: 'editor',
    description: 'Controls how IP addresses are assigned to interfaces on this network. None: no automatic IP assignment (configure manually after deployment). Auto-assign: FABRIC assigns sequential IPs from the subnet to each interface. Manual: you specify the exact IP for each interface in the fields below. Auto-assign is simplest; manual gives precise control over addressing.' },
  { id: 'editor.net.interface-ips', label: 'Interface IPs', tooltip: 'Manually assigned IP for each interface', section: 'editor',
    description: 'When IP Assignment is set to Manual, specify the exact IP address for each connected interface. Each IP must be within the configured subnet range and unique across all interfaces on this network. Do not use the network address, broadcast address, or the gateway address.' },

  // --- Topology View ---
  { id: 'topology.graph', label: 'Topology Graph', tooltip: 'Interactive slice topology visualization', section: 'topology',
    description: 'The Cytoscape.js graph shows your slice topology with nodes (VMs), components, and network connections. Click elements to view details. Box-select or shift-click for multi-selection. Right-click nodes for context menu actions (open terminal, delete, manage components).' },
  { id: 'topology.layout', label: 'Layout Selector', tooltip: 'Change graph layout algorithm', section: 'topology',
    description: 'Choose from 6 layout algorithms: dagre (hierarchical, default), cola (force-directed), breadthfirst (tree), grid (aligned), concentric (radial), and cose (physics-based). Each arranges nodes differently to suit various topology shapes.' },
  { id: 'topology.fit', label: 'Fit', tooltip: 'Fit graph to viewport', section: 'topology',
    description: 'Zooms and pans the graph to fit all elements within the visible area with comfortable padding.' },
  { id: 'topology.export', label: 'Export', tooltip: 'Export topology as PNG image', section: 'topology',
    description: 'Exports the current topology graph as a high-resolution PNG image file. The export uses the current theme colors (light or dark background).' },
  { id: 'topology.context-menu', label: 'Context Menu', tooltip: 'Right-click nodes for actions', section: 'topology',
    description: 'Right-click any node in the graph to access a context menu with: Open Terminal (SSH into the VM if it has a management IP), component management (view and delete components), and Delete (remove from slice). Multi-select nodes to batch operations.' },

  // --- Detail Panel ---
  { id: 'detail.panel', label: 'Detail Panel', tooltip: 'View properties of selected elements', section: 'detail',
    description: 'Shows detailed properties for the currently selected graph element: node configuration, site information, network details, or link metrics. Use the collapse button to hide and reclaim screen space.' },

  // --- Map View ---
  { id: 'map.view', label: 'Map View', tooltip: 'Geographic view of FABRIC sites', section: 'map',
    description: 'Interactive Leaflet map showing all FABRIC site locations. Site markers show availability status and resource capacity. Network links are drawn between connected sites. Click sites or links to view metrics. Use the metrics refresh controls to set auto-refresh intervals.' },

  // --- Files View ---
  { id: 'files.view', label: 'Files View', tooltip: 'Dual-panel file manager with VM file transfer', section: 'files',
    description: 'A dual-panel file manager for transferring files between your local storage and slice VMs. The left panel shows server-side files; the right panel shows files on a selected VM node. Supports upload, download, and text file editing.' },

  // --- Bottom Panel ---
  { id: 'bottom.validation', label: 'Validation Tab', tooltip: 'View slice validation results', section: 'bottom',
    description: 'Shows validation results for the current slice. Errors (red) prevent submission; warnings (yellow) are informational. Each issue includes a remedy suggestion. The tab indicator shows validation status at a glance.' },
  { id: 'bottom.log', label: 'Log Tab', tooltip: 'View application log messages', section: 'bottom',
    description: 'Displays application log messages including API calls, responses, and errors. Useful for debugging issues with slice operations or connectivity.' },
  { id: 'bottom.local-terminal', label: 'Local Terminal', tooltip: 'Open a shell on the backend container', section: 'bottom',
    description: 'Opens a terminal session on the backend container. Useful for running FABlib commands directly, checking configuration, or debugging connectivity to FABRIC resources.' },
  { id: 'bottom.node-terminals', label: 'Node Terminals', tooltip: 'SSH terminal sessions to slice VMs', section: 'bottom',
    description: 'Terminal tabs for SSH sessions to slice VMs. Open them via the graph context menu (right-click a node with a management IP). Each tab shows the node name and maintains an independent SSH connection via WebSocket.' },

  // --- Settings ---
  { id: 'settings.token', label: 'FABRIC Token', tooltip: 'Manage your FABRIC authentication token', section: 'settings',
    description: 'Your FABRIC identity token provides authentication for all API operations. Login via the FABRIC portal or paste a token directly. The token contains your project memberships and determines what resources you can access.' },
  { id: 'settings.ssh-keys', label: 'SSH Keys', tooltip: 'Manage SSH keys for slice access', section: 'settings',
    description: 'SSH keys are used to connect to slice VMs. A bastion key authenticates to the FABRIC bastion host; a slice key authenticates to individual VMs. Keys can be generated or uploaded.' },
  { id: 'settings.project', label: 'Project Selection', tooltip: 'Choose your active project', section: 'settings',
    description: 'Select which FABRIC project to use for creating and managing slices. Your available projects are determined by your FABRIC token and membership.' },
];

export const helpSections: HelpSection[] = [
  { id: 'titlebar', title: 'Title Bar', entries: entries.filter(e => e.section === 'titlebar') },
  { id: 'toolbar', title: 'Toolbar', entries: entries.filter(e => e.section === 'toolbar') },
  { id: 'editor', title: 'Editor Panel', entries: entries.filter(e => e.section === 'editor') },
  { id: 'topology', title: 'Topology View', entries: entries.filter(e => e.section === 'topology') },
  { id: 'detail', title: 'Detail Panel', entries: entries.filter(e => e.section === 'detail') },
  { id: 'map', title: 'Map View', entries: entries.filter(e => e.section === 'map') },
  { id: 'files', title: 'Files View', entries: entries.filter(e => e.section === 'files') },
  { id: 'bottom', title: 'Bottom Panel', entries: entries.filter(e => e.section === 'bottom') },
  { id: 'settings', title: 'Settings', entries: entries.filter(e => e.section === 'settings') },
];

export const helpEntryMap: Record<string, HelpEntry> = {};
for (const entry of entries) {
  helpEntryMap[entry.id] = entry;
}
