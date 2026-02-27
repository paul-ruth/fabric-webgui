# FABRIC Web GUI — Project Specification

## Goal

Replicate the Jupyter-based **fabvis** GUI (from `fabrictestbed-extensions` fabvis branch) as a standalone web application. The web GUI should look and behave as close to the Jupyter version as possible, using the same visual language, layout, and interaction patterns.

## What fabvis Does (Source of Truth)

fabvis is a FABRIC slice visualization and editing suite embedded in Jupyter notebooks. It provides:

### Editor View (Primary)
- **Three-panel layout**: Editor panel (left, ~25%) | Cytoscape topology graph (center, ~50%) | Detail panel (right, ~25%)
- **Toolbar** across the top: Submit, Modify, Refresh, Terminal, Delete Selected, Delete Slice buttons
- **Editor panel** with 5 tabs: Node, Component, Network, Remove, Configure
- **Cytoscape graph** showing slice topology: VM nodes (roundrectangles), network nodes (ellipses), edges with labels
- **Detail panel** showing properties of the clicked element (node, network, interface, component)
- **Terminal panel** that slides up from below the graph for SSH access to nodes
- **Layout selector** dropdown (dagre, cola, breadthfirst, grid, concentric, cose) + Fit button

### Geographic View
- ipyleaflet map showing FABRIC sites as markers on a world map
- Slice nodes rendered at their geographic site locations
- Network connections drawn as animated paths between sites
- Infrastructure links between sites shown as dashed lines
- Color-coded by utilization (green/orange/red)

### Unified Shell
- Title bar with FABRIC branding (gradient, logo)
- Slice dropdown + Load + Refresh controls
- View selector toggling between Editor and Geographic views
- Image export (PNG/PDF/SVG)

## Technology Choices

### Frontend
- **React 18** with TypeScript
- **Cytoscape.js** — the browser-native version of the same library fabvis uses (ipycytoscape wraps cytoscape.js). This is the right choice: same layout algorithms, same stylesheet format, same API concepts
- **Leaflet.js** (via react-leaflet) for the geographic map view — same library ipyleaflet wraps
- **Vite** for build tooling
- **CSS Modules** or plain CSS — keep it simple, match fabvis styling directly

### Backend
- **FastAPI** (Python) — natural fit since FABlib is Python
- **fabrictestbed-extensions** (FABlib) — direct import, same library fabvis uses
- Serves REST API + static frontend files in production

### Deployment
- **Docker Compose** — single `docker-compose up` to run everything
- Backend container with FABlib + FastAPI
- Frontend served by the backend (built static files) or via nginx in production
- Mounts `~/work/fabric_config/` for authentication tokens

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Browser                       │
│  ┌─────────┬──────────────┬──────────────────┐  │
│  │ Editor  │  Cytoscape   │  Detail Panel    │  │
│  │ Panel   │  Graph       │                  │  │
│  │ (tabs)  │              │                  │  │
│  ├─────────┴──────────────┴──────────────────┤  │
│  │         Toolbar / View Selector           │  │
│  └───────────────────┬───────────────────────┘  │
│                      │ REST API                  │
└──────────────────────┼──────────────────────────┘
                       │
┌──────────────────────┼──────────────────────────┐
│              FastAPI Backend                      │
│  ┌───────────────────┴───────────────────────┐  │
│  │            API Routes                      │  │
│  │  /api/slices, /api/sites, /api/resources   │  │
│  ├────────────────────────────────────────────┤  │
│  │         FABlib Integration Layer           │  │
│  │  FablibManager → Slice/Node/Network ops    │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

## API Endpoints

### Slices
- `GET /api/slices` — List all slices (name, state, id)
- `GET /api/slices/{name}` — Get full slice data including topology graph (nodes, edges, positions)
- `POST /api/slices` — Create new empty slice
- `POST /api/slices/{name}/submit` — Submit slice to FABRIC
- `POST /api/slices/{name}/modify` — Submit modifications
- `DELETE /api/slices/{name}` — Delete slice
- `POST /api/slices/{name}/refresh` — Refresh slice state from FABRIC

### Nodes
- `POST /api/slices/{name}/nodes` — Add node (name, site, cores, ram, disk, image)
- `DELETE /api/slices/{name}/nodes/{node_name}` — Remove node
- `PUT /api/slices/{name}/nodes/{node_name}` — Update node configuration

### Components
- `POST /api/slices/{name}/nodes/{node_name}/components` — Add component (model, name)
- `DELETE /api/slices/{name}/nodes/{node_name}/components/{comp_name}` — Remove component

### Networks
- `POST /api/slices/{name}/networks` — Add network (name, type, interfaces)
- `DELETE /api/slices/{name}/networks/{net_name}` — Remove network

### Resources
- `GET /api/sites` — List all FABRIC sites with status, location, available resources
- `GET /api/resources` — Get resource availability across sites

### Utility
- `GET /api/images` — List available VM images
- `GET /api/component-models` — List available component models (NIC, GPU, FPGA, etc.)

## Frontend Component Structure

```
App
├── TitleBar              — FABRIC branded header with gradient
├── Toolbar               — Slice selector, Load, Refresh, View toggle, Export
├── ViewContainer
│   ├── EditorView        — Three-panel layout
│   │   ├── EditorPanel   — 5 tabs (Node, Component, Network, Remove, Configure)
│   │   ├── CytoscapeGraph — Interactive topology with click handlers
│   │   ├── DetailPanel   — Shows properties of selected element
│   │   └── TerminalPanel — SSH terminal (xterm.js) sliding up from bottom
│   │
│   └── GeoView           — Leaflet map with sites, nodes, links
│
└── StatusBar             — Layout selector, Fit, connection status
```

## Visual Design (Match fabvis Exactly)

### Brand Colors
- Primary blue: `#5798bc`
- Dark blue: `#1f6a8c`
- Teal: `#008e7a`
- Orange: `#ff8542`
- Coral: `#e25241`
- Light gray background: `#f8f9fa`

### Fonts
- Montserrat (headers, labels)
- System monospace for terminal, code values

### Node Styling in Cytoscape
- **VM nodes**: Roundrectangle, 180×70px, colored by state (Active=green, Configuring=blue, etc.)
- **Network L2 nodes**: Ellipse, 90×80px, blue (`#1f6a8c`)
- **Network L3 nodes**: Ellipse, 90×80px, teal (`#008e7a`)
- **Facility port nodes**: Roundrectangle, 70×70px, orange
- **Switch nodes**: Roundrectangle, 70×70px
- **Slice container**: Dashed roundrectangle border, semi-transparent background
- **Edges**: Bezier curves with auto-rotating labels, L2=solid blue 3px, L3=dashed teal 2px

### Layout
- Default layout: **dagre** (hierarchical top-to-bottom)
- 6 layout options: dagre, cola, breadthfirst, grid, concentric, cose

## State Color Mapping (Node Reservation States)

| State | Background | Border |
|-------|-----------|--------|
| Active / ActiveTicket | `#d4edda` | `#28a745` |
| Configuring / Nascent | `#cce5ff` | `#0d6efd` |
| Closing / Dead | `#e2e3e5` | `#6c757d` |
| Failed / Error states | `#f8d7da` | `#dc3545` |
| Ticketed | `#fff3cd` | `#ffc107` |
| Unknown | `#e2e3e5` | `#6c757d` |

## Multi-line Node Labels

```
{node_name}
@ {site}
{cores}c / {ram}G / {disk}G
{component_summary}
```

Where component_summary shows abbreviated component list (e.g., "NIC x2  GPU").

## Detail Panel Content

### For Nodes
- Name, Site, Host, State
- Cores, RAM, Disk, Image
- Management IP, Username
- Components table (name, model, details)
- Interfaces table (name, network, VLAN, MAC, IPs)

### For Networks
- Name, Type (L2Bridge/L2STS/L2PTP/IPv4/IPv6/etc.)
- Subnet, Gateway
- Connected interfaces list

### For Interfaces
- Name, Node, Network
- VLAN, Bandwidth
- MAC address, IPv4, IPv6

## SSH Terminal

- **xterm.js** in the browser (same library fabvis uses via a widget bridge)
- WebSocket connection from browser → backend → Paramiko SSH through FABRIC bastion
- Terminal opens when user clicks Terminal button after selecting a node
- Slides up from bottom of the graph area
- Dark theme (`#1e1e1e` background), green header bar with node name

## Image Export

- Export current graph as PNG using Cytoscape.js built-in `cy.png()` / `cy.jpg()`
- Export geographic view using Leaflet plugins or html2canvas
- Save button with filename input

## Deployment

### Local Development
```bash
docker-compose up
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API docs: http://localhost:8000/docs
```

### Requirements
- Docker & Docker Compose
- FABRIC configuration at `~/work/fabric_config/` with valid `id_token.json`
- Network access to FABRIC API endpoints

### docker-compose.yml Structure
```yaml
services:
  backend:
    build: ./backend
    ports: ["8000:8000"]
    volumes:
      - ~/work/fabric_config:/fabric_config:ro
    environment:
      - FABRIC_CONFIG_DIR=/fabric_config

  frontend:
    build: ./frontend
    ports: ["3000:3000"]
    depends_on: [backend]
```

## Non-Goals (Phase 1)

- User authentication/login flow (relies on pre-existing fabric_config tokens)
- Multi-user support
- ConfigureGUI (environment setup wizard — users configure fabric_config manually)
- ArtifactBrowser
- Persistent database (all state comes from FABRIC API via FABlib)
- Mobile-responsive design

## Future Phases

- **Phase 2**: SSH terminal via WebSocket, image export, geographic view
- **Phase 3**: ConfigureGUI equivalent, artifact browser, multi-user auth
