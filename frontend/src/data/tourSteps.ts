export type TourRequiredView = 'main' | 'settings' | 'map' | 'files' | 'slivers';

export interface TourStep {
  id: string;
  title: string;
  content: string;
  targetSelector: string;
  requiredView: TourRequiredView;
  tooltipPosition: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  autoStart: boolean;
  helpSections: string[];
  steps: TourStep[];
}

const gettingStarted: TourDef = {
  id: 'getting-started',
  title: 'Getting Started',
  description: 'Set up your FABRIC credentials, load a template, and create your first slice.',
  icon: '\u{1F680}',
  autoStart: true,
  helpSections: [],
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to FABRIC',
      content:
        'This guided tour will walk you through setting up your FABRIC credentials and creating your first slice. You\'ll learn how to configure authentication, load a template, and connect to your VMs.',
      targetSelector: '.title-bar',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'settings-open',
      title: 'Open Settings',
      content:
        'Click the gear icon to open Settings. This is where you\'ll configure your FABRIC token, SSH keys, and project selection.',
      targetSelector: '[data-help-id="titlebar.settings"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'configure-token',
      title: 'Upload Your Token',
      content:
        'Upload your FABRIC identity token (JSON file from the portal) or click "Login with FABRIC" to authenticate. This token identifies you and determines which projects you can access.',
      targetSelector: '[data-tour-id="token"]',
      requiredView: 'settings',
      tooltipPosition: 'right',
    },
    {
      id: 'configure-bastion',
      title: 'Upload Bastion Key',
      content:
        'Upload your FABRIC bastion private key. This key is used to SSH through the bastion host to reach your slice VMs. You can download it from the FABRIC portal under "Manage SSH Keys".',
      targetSelector: '[data-tour-id="bastion-key"]',
      requiredView: 'settings',
      tooltipPosition: 'right',
    },
    {
      id: 'configure-slice-keys',
      title: 'Set Up Slice Keys',
      content:
        'Generate or upload SSH key pairs for slice access. Click "Add Key Set" then "Generate" to create a new pair automatically, or upload your own. These keys let you SSH into provisioned VMs.',
      targetSelector: '[data-tour-id="slice-keys"]',
      requiredView: 'settings',
      tooltipPosition: 'right',
    },
    {
      id: 'close-settings',
      title: 'Save & Close',
      content:
        'Check that all status indicators are green, then click "Save & Close" to apply your configuration. You\'re now ready to create slices!',
      targetSelector: '.status-banner',
      requiredView: 'settings',
      tooltipPosition: 'bottom',
    },
    {
      id: 'load-template',
      title: 'Load a Template',
      content:
        'Open the Slice Templates panel and find the "Hello, FABRIC" template. Click "Load" to create a new draft slice with a pre-built topology. Templates give you a quick starting point for experiments.',
      targetSelector: '.template-panel',
      requiredView: 'main',
      tooltipPosition: 'left',
    },
    {
      id: 'edit-node',
      title: 'Edit Your Nodes',
      content:
        'Use the Editor panel to modify node properties: change the site, adjust cores, RAM, and disk, or pick a different OS image. Click a node in the graph to select it for editing.',
      targetSelector: '.editor-panel',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'terminal-hint',
      title: 'Connect to Your VMs',
      content:
        'After submitting and provisioning your slice, right-click any node in the topology graph and select "Open Terminal" to get an SSH session directly in the browser. The console panel below also shows logs, errors, and validation results.',
      targetSelector: '.bottom-panel',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
    {
      id: 'done',
      title: 'Tour Complete!',
      content:
        'You\'re all set! Remember: you can restart this tour anytime from the Help page. Right-click any UI element for context-sensitive help, or click the "?" icon for the full documentation.',
      targetSelector: '[data-help-id="titlebar.help"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
  ],
};

const topologyEditor: TourDef = {
  id: 'topology-editor',
  title: 'Topology Editor',
  description: 'Learn how to add nodes, components, and networks to build your slice topology.',
  icon: '\u270E',
  autoStart: false,
  helpSections: ['editor', 'topology'],
  steps: [
    {
      id: 'te-intro',
      title: 'Topology Editor Overview',
      content:
        'The topology editor lets you visually build your slice. You can add VM nodes, attach hardware components, create networks, and connect everything together.',
      targetSelector: '.cytoscape-container',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'te-add-node',
      title: 'Adding Nodes',
      content:
        'Click the "+" button in the Editor panel to add a new VM node, network, or facility port. Each node represents a virtual machine that will be provisioned on a FABRIC site.',
      targetSelector: '[data-help-id="editor.add-button"]',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'te-node-props',
      title: 'Node Properties',
      content:
        'Select a node to edit its properties: site, host, cores, RAM, disk, and OS image. The site dropdown shows feasibility indicators (\u2713/\u26A0) and adjusted resources for each site. Pick a host to pin the VM to a specific physical machine.',
      targetSelector: '.editor-panel',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'te-components',
      title: 'Hardware Components',
      content:
        'Switch to the Components tab to attach NICs, GPUs, FPGAs, or SmartNICs to a node. Components provide specialized hardware capabilities for your experiment.',
      targetSelector: '[data-help-id="editor.devices-tab"]',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'te-networks',
      title: 'Creating Networks',
      content:
        'Use the Network tab to create L2 or L3 networks. Select interfaces from your nodes to connect them. Configure subnets, gateways, and IP assignment modes.',
      targetSelector: '[data-help-id="editor.network-tab"]',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'te-layout',
      title: 'Graph Layout',
      content:
        'Use the layout selector to change how the topology graph is arranged. Choose from Dagre, Breadth-First, Circle, Grid, Concentric, or CoSE algorithms.',
      targetSelector: '[data-help-id="topology.layout"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'te-context-menu',
      title: 'Context Menu',
      content:
        'Right-click any node in the graph for quick actions: edit, delete, open terminal, clone, or view details. The context menu adapts based on the element type and slice state.',
      targetSelector: '.cytoscape-container',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'te-done',
      title: 'Topology Tour Complete!',
      content:
        'You now know how to build and edit slice topologies. Try adding nodes, connecting them with networks, and submitting your slice to FABRIC!',
      targetSelector: '.cytoscape-container',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
  ],
};

const mapResources: TourDef = {
  id: 'map-resources',
  title: 'Map & Resources',
  description: 'Explore the geographic map view showing FABRIC sites, backbone links, and resource availability.',
  icon: '\u{1F30D}',
  autoStart: false,
  helpSections: ['map'],
  steps: [
    {
      id: 'mr-intro',
      title: 'Map View',
      content:
        'The Map view shows all FABRIC sites on a world map with backbone network links. Switch to Map view to explore site locations and resource availability.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'mr-sites',
      title: 'FABRIC Sites',
      content:
        'Each marker represents a FABRIC site. Click a site to see its available resources: cores, RAM, disk, GPUs, and other hardware. Site colors indicate resource utilization levels.',
      targetSelector: '.geo-view',
      requiredView: 'map',
      tooltipPosition: 'top',
    },
    {
      id: 'mr-links',
      title: 'Backbone Links',
      content:
        'Lines between sites represent backbone network links. These high-speed connections enable cross-site experiments. Link capacity and utilization are shown on hover.',
      targetSelector: '.geo-view',
      requiredView: 'map',
      tooltipPosition: 'top',
    },
    {
      id: 'mr-resources',
      title: 'Refresh Resources',
      content:
        'Click "Refresh Resources" in the toolbar to fetch the latest availability data from all FABRIC sites. This updates both the map markers and the site selector dropdowns.',
      targetSelector: '[data-help-id="toolbar.refresh-resources"]',
      requiredView: 'map',
      tooltipPosition: 'bottom',
    },
    {
      id: 'mr-site-mapping',
      title: 'Site Mapping',
      content:
        'When using templates with @group tags, the Site Mapping view (in the Editor panel) shows how groups map to sites. Use Auto-Assign to let the system pick optimal sites based on availability.',
      targetSelector: '[data-help-id="editor.site-mapping"]',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'mr-done',
      title: 'Map Tour Complete!',
      content:
        'You now know how to explore FABRIC sites, check resource availability, and understand the backbone network topology.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
  ],
};

const templatesCloning: TourDef = {
  id: 'templates-cloning',
  title: 'Templates & Cloning',
  description: 'Use slice templates and VM templates to quickly build experiments, plus clone existing slices.',
  icon: '\u{1F4CB}',
  autoStart: false,
  helpSections: ['templates', 'vm-templates'],
  steps: [
    {
      id: 'tc-slice-templates',
      title: 'Slice Templates',
      content:
        'The Slice Templates panel shows pre-built topologies you can load as new draft slices. Templates include nodes, networks, site groups, and boot configurations — a quick way to start experiments.',
      targetSelector: '.template-panel',
      requiredView: 'main',
      tooltipPosition: 'left',
    },
    {
      id: 'tc-load-template',
      title: 'Loading a Template',
      content:
        'Click "Load" on any template to create a new draft slice with that topology. The draft appears in the editor where you can customize it before submitting to FABRIC.',
      targetSelector: '.template-panel',
      requiredView: 'main',
      tooltipPosition: 'left',
    },
    {
      id: 'tc-save-template',
      title: 'Save as Template',
      content:
        'Save your current slice topology as a reusable template. Click "Save as Template" in the toolbar to capture the full configuration including nodes, networks, and boot configs.',
      targetSelector: '[data-help-id="toolbar.save-template"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'tc-vm-templates',
      title: 'VM Templates',
      content:
        'VM Templates are single-node configurations with a pre-set image and boot config. Use them to quickly add pre-configured VMs to any slice.',
      targetSelector: '.vm-template-panel',
      requiredView: 'main',
      tooltipPosition: 'left',
    },
    {
      id: 'tc-clone',
      title: 'Cloning Slices',
      content:
        'Clone any slice to create an editable copy with a new name. The clone preserves the full topology — useful for creating variations of an experiment or reusing expired topologies.',
      targetSelector: '[data-help-id="toolbar.clone"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'tc-done',
      title: 'Templates Tour Complete!',
      content:
        'You now know how to use slice templates, VM templates, and cloning to streamline your workflow. Try loading a template and customizing it!',
      targetSelector: '.template-panel',
      requiredView: 'main',
      tooltipPosition: 'left',
    },
  ],
};

const consoleTerminals: TourDef = {
  id: 'console-terminals',
  title: 'Console & Terminals',
  description: 'Use the console for logs, validation, and SSH terminal sessions to your VMs.',
  icon: '\u{1F5B5}',
  autoStart: false,
  helpSections: ['bottom'],
  steps: [
    {
      id: 'ct-overview',
      title: 'Console Panel',
      content:
        'The console at the bottom shows errors, validation results, and application logs. Drag the top edge to resize it. The tabs organize different types of output.',
      targetSelector: '.bottom-panel',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
    {
      id: 'ct-errors',
      title: 'Errors Tab',
      content:
        'The Errors tab collects all API and operation errors. Each error shows a timestamp and message. Use "Clear" to dismiss resolved errors.',
      targetSelector: '[data-help-id="bottom.errors"]',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
    {
      id: 'ct-validation',
      title: 'Validation Tab',
      content:
        'The Validation tab runs real-time checks on your slice: missing sites, invalid configurations, resource conflicts. Errors block submission; warnings are advisory.',
      targetSelector: '[data-help-id="bottom.validation"]',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
    {
      id: 'ct-local-terminal',
      title: 'Local Terminal',
      content:
        'The Local Terminal opens a shell on the backend container. Use it for FABlib debugging, SSH troubleshooting, or running custom scripts.',
      targetSelector: '[data-help-id="bottom.local-terminal"]',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
    {
      id: 'ct-done',
      title: 'Console Tour Complete!',
      content:
        'You now know how to use the console for monitoring, debugging, and terminal access. After provisioning a slice, right-click a node to open an SSH terminal tab.',
      targetSelector: '.bottom-panel',
      requiredView: 'main',
      tooltipPosition: 'top',
    },
  ],
};

const fileManager: TourDef = {
  id: 'file-manager',
  title: 'File Manager',
  description: 'Transfer files between container storage and slice VMs using the dual-panel file manager.',
  icon: '\u{1F4C1}',
  autoStart: false,
  helpSections: [],
  steps: [
    {
      id: 'fm-intro',
      title: 'File Manager',
      content:
        'The File Manager provides a dual-panel interface for managing files. Switch to the Files view to access container storage and VM file transfer.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'fm-panels',
      title: 'Dual Panel Layout',
      content:
        'The left panel shows your container storage (local files on the backend). The right panel connects to a slice VM via SFTP. You can browse, upload, download, and transfer files between them.',
      targetSelector: '.file-transfer-view',
      requiredView: 'files',
      tooltipPosition: 'top',
    },
    {
      id: 'fm-container',
      title: 'Container Storage',
      content:
        'The container panel shows files stored on the backend. Upload files from your computer here, then transfer them to VMs. Files persist as long as the container is running.',
      targetSelector: '.file-transfer-view',
      requiredView: 'files',
      tooltipPosition: 'top',
    },
    {
      id: 'fm-vm',
      title: 'VM File Access',
      content:
        'Select a provisioned VM from the dropdown to browse its filesystem via SFTP. You can upload, download, rename, and delete files directly on the VM.',
      targetSelector: '.file-transfer-view',
      requiredView: 'files',
      tooltipPosition: 'top',
    },
    {
      id: 'fm-done',
      title: 'File Manager Tour Complete!',
      content:
        'You now know how to use the file manager for transferring files between your container and slice VMs. Switch back to Topology view to continue editing.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
  ],
};

const sliversPlacement: TourDef = {
  id: 'slivers-placement',
  title: 'Slivers & Resource Placement',
  description: 'Explore the split-panel sliver view and learn how to use resource-aware site and host selection.',
  icon: '\u{1F4CA}',
  autoStart: false,
  helpSections: ['sliver', 'editor'],
  steps: [
    {
      id: 'sp-intro',
      title: 'Slivers View',
      content:
        'The Slivers view gives you a data-centric spreadsheet of your slice. Switch to Slivers to see two panels: VM nodes on top and network services below, each with columns tailored to their type.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
    {
      id: 'sp-vm-panel',
      title: 'VM Nodes Panel',
      content:
        'The top panel lists all VM nodes with compute-specific columns: Site, Host, State, Cores, RAM, Disk, Image, Mgmt IP, and attached Components. Click any column header to sort, or click a row to select it in the editor.',
      targetSelector: '.sliver-panels',
      requiredView: 'slivers',
      tooltipPosition: 'bottom',
    },
    {
      id: 'sp-net-panel',
      title: 'Network Services Panel',
      content:
        'The bottom panel lists networks and facility ports with network-specific columns: Layer/Type, Subnet, Gateway, and Connected Interfaces. Drag the resize handle between panels to adjust the split.',
      targetSelector: '.sliver-resize-handle',
      requiredView: 'slivers',
      tooltipPosition: 'top',
    },
    {
      id: 'sp-filter',
      title: 'Filtering',
      content:
        'The search bar at the top filters both panels simultaneously. Type a site name, node name, or image to quickly narrow down what you see.',
      targetSelector: '.sliver-filter',
      requiredView: 'slivers',
      tooltipPosition: 'bottom',
    },
    {
      id: 'sp-site-feasibility',
      title: 'Site Feasibility Indicators',
      content:
        'Back in the editor, the Site dropdown now shows a checkmark (\u2713) or warning (\u26A0) next to each site, with adjusted available cores and RAM. This accounts for other VMs in your draft already placed at that site.',
      targetSelector: '.editor-panel',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'sp-host-pinning',
      title: 'Host Pinning',
      content:
        'Below the site selector, the Host dropdown lets you pin a VM to a specific physical host. Each host shows its available resources and a feasibility badge. Leave it on "Any host (auto)" to let FABRIC choose.',
      targetSelector: '.editor-panel',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'sp-auto-assign',
      title: 'Auto-Assign Sites & Hosts',
      content:
        'The "Auto-Assign Sites & Hosts" button uses live FABRIC resource data to automatically place all nodes on sites with enough capacity. It checks per-host availability to ensure each VM actually fits.',
      targetSelector: '[data-help-id="editor.remap-sites"]',
      requiredView: 'main',
      tooltipPosition: 'right',
    },
    {
      id: 'sp-done',
      title: 'Tour Complete!',
      content:
        'You now know how to use the split-panel sliver view, check site and host feasibility, and auto-assign resources. These tools help you build slices that will provision successfully on the first try.',
      targetSelector: '[data-help-id="titlebar.view"]',
      requiredView: 'main',
      tooltipPosition: 'bottom',
    },
  ],
};

export const tours: Record<string, TourDef> = {
  'getting-started': gettingStarted,
  'topology-editor': topologyEditor,
  'slivers-placement': sliversPlacement,
  'map-resources': mapResources,
  'templates-cloning': templatesCloning,
  'console-terminals': consoleTerminals,
  'file-manager': fileManager,
};

export const tourList: TourDef[] = [
  gettingStarted,
  topologyEditor,
  sliversPlacement,
  mapResources,
  templatesCloning,
  consoleTerminals,
  fileManager,
];

/** Reverse lookup: help section id → tours that cover that section */
export const toursBySection: Record<string, TourDef[]> = {};
for (const tour of tourList) {
  for (const sectionId of tour.helpSections) {
    if (!toursBySection[sectionId]) {
      toursBySection[sectionId] = [];
    }
    toursBySection[sectionId].push(tour);
  }
}
