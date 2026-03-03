# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

fabric-webgui is a standalone web GUI that replicates the Jupyter-based **fabvis** (from `fabrictestbed-extensions` fabvis branch) as a browser application. It uses the same visual language, layout, and interaction patterns: three-panel editor with Cytoscape.js topology graph, geographic Leaflet map view, and matching FABRIC brand styling.

## Architecture

- **Backend**: FastAPI (Python) wrapping FABlib for all FABRIC operations → `backend/`
- **Frontend**: React 18 + TypeScript with Cytoscape.js and react-leaflet → `frontend/`
- **Deployment**: Docker Compose (backend + nginx-served frontend)
- **Full architecture reference**: See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for complete endpoint tables, data flow diagrams, storage layout, and type system documentation.

## Agent Team

Specialist agents available as slash commands for development:
- `/lead <goal>` — Team lead: breaks goals into tasks, delegates to specialists
- `/backend <task>` — Backend specialist: FastAPI, FABlib, Python
- `/frontend <task>` — Frontend specialist: React, TypeScript, CSS
- `/graph <task>` — Graph/visualization: Cytoscape.js, Leaflet, graph_builder
- `/libraries <task>` — Slice libraries: templates, recipes, seeding
- `/infra <task>` — Infrastructure: Docker, builds, deployment, nginx

Agents share state via `docs/TEAM_STATUS.md`.

## Build & Run

### Local Development (no Docker)
```bash
./run-dev.sh
# Backend: http://localhost:8000 (API docs at /docs)
# Frontend: http://localhost:3000 (Vite proxies /api/* to backend)
```

### Docker
```bash
docker-compose up --build
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
```

### Backend Only
```bash
cd backend && python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend Only
```bash
cd frontend && npm install && npm run dev
```

### Build Frontend for Production
```bash
cd frontend && npm run build   # outputs to frontend/dist/
```

## Key Files

### Backend (`backend/`)
- `app/main.py` — FastAPI app, CORS, router mounting
- `app/fablib_manager.py` — Singleton FablibManager (reads `FABRIC_CONFIG_DIR` env)
- `app/slice_serializer.py` — Converts FABlib objects to JSON-serializable dicts
- `app/graph_builder.py` — Converts slice data to Cytoscape.js graph JSON (nodes, edges, classes, state colors)
- `app/site_resolver.py` — Maps `@group` tags and `auto` sites to concrete FABRIC sites using resource availability (including host-level checks)
- `app/routes/slices.py` — CRUD + submit/modify/refresh/delete for slices, nodes, components, networks; `POST /resolve-sites` for re-resolving site assignments
- `app/routes/resources.py` — Sites (with GPS coords + host-level availability), images, component models; `GET /sites/{name}/hosts` for per-host resources
- `app/routes/templates.py` — Slice template CRUD (list, load, save, delete)
- `app/routes/vm_templates.py` — VM template CRUD (list, get, save, delete)
- `app/routes/files.py` — Dual-panel file manager (container storage + VM SFTP)

### Frontend (`frontend/src/`)
- `App.tsx` — Root component, state management, API orchestration
- `api/client.ts` — Typed fetch wrappers for all backend endpoints
- `components/CytoscapeGraph.tsx` — Cytoscape.js with fabvis-matching stylesheet and 6 layout algorithms
- `components/EditorPanel.tsx` — Node/component/network editor with Site Mapping view for group-to-site assignments, boot config, and VM template integration
- `components/DetailPanel.tsx` — Properties display for clicked element
- `components/GeoView.tsx` — Leaflet map with site markers and network connections
- `components/Toolbar.tsx` — Slice selector, action buttons, clone, save-as-template
- `components/TemplatePanel.tsx` — Slice template browser with load/delete
- `components/VMTemplatePanel.tsx` — VM template browser with add-to-slice/delete
- `components/BottomPanel.tsx` — Console with errors, validation, log, local terminal, and SSH node terminals
- `components/TitleBar.tsx` — FABRIC branded gradient header
- `components/Tooltip.tsx` — Hover tooltip component used across all panels
- `components/HelpView.tsx` — Full help page with searchable documentation
- `data/helpData.ts` — Help entries and section definitions for contextual help system
- `types/fabric.ts` — TypeScript interfaces matching backend response shapes

## Key Features

### Template System
- **Slice Templates**: Pre-built topologies (e.g., "Wide-Area L2 Network") with `@group` site tags for co-location. Load creates a new draft. Save any slice as a reusable template.
- **VM Templates**: Single-node configurations (image + boot config). Add a VM from a template to quickly create nodes with pre-configured settings. Save any node as a VM template.

### Site Resolution & Resource Mapping
- **Site Resolver** (`site_resolver.py`): Maps `@group` tags to concrete sites using live availability data. Performs host-level feasibility checks — verifies at least one physical host can fit each VM, not just site-level totals.
- **Site Mapping View**: Toggle "Sites" in EditorPanel to see group-to-site assignments, manually override via dropdown, or click "Auto-Assign" to re-resolve with fresh data.
- **Submit-time Resolution**: On submit, resources are force-refreshed (bypassing cache) and all nodes are re-resolved to sites with current availability.
- **`POST /slices/{name}/resolve-sites`**: Backend endpoint for manual/auto site re-resolution with optional group overrides.

### Boot Configuration
- Per-node boot scripts (commands, file uploads, network config) that run on first boot
- Stored as part of slice templates and VM templates
- Execute and view results from the Boot Config tab in the editor

### Help System
- **Tooltip**: Hover over any labeled element for a brief description
- **Right-click context help**: Right-click elements with `data-help-id` for detailed help
- **Help page**: Full searchable documentation accessible from the title bar
- **`helpData.ts`**: Central registry of all help entries organized by section

### Console (Bottom Panel)
- **Errors**: API and operation error log with clear-all
- **Validation**: Real-time slice validation with errors, warnings, and remedies
- **Log**: Application event log with timestamps
- **Local Terminal**: Shell on the backend container for FABlib/SSH debugging
- **Node Terminals**: SSH sessions to provisioned VMs via WebSocket

## FABRIC Brand Colors (from fabvis)
- Primary: `#5798bc`, Dark: `#1f6a8c`, Teal: `#008e7a`, Orange: `#ff8542`, Coral: `#e25241`

## Configuration
- `FABRIC_CONFIG_DIR` env var (default: `~/work/fabric_config`) — must contain `fabric_rc`, SSH keys, tokens
- Vite dev server proxies `/api/*` to `localhost:8000` (configured in `vite.config.ts`)

## FABRIC Ecosystem Context

- **FABlib** (`fabrictestbed_extensions`): Python library the backend imports directly
- **FABRIC Reports API**: `https://reports.fabric-testbed.net/reports`
- **FABRIC UIS API**: `https://uis.fabric-testbed.net`
- **fabvis source**: `https://github.com/fabric-testbed/fabrictestbed-extensions/tree/fabvis` — the Jupyter GUI this project replicates

## MCP Tool Integration

Two MCP servers are available for querying FABRIC data directly:
- **fabric-api**: Query sites, hosts, slices, slivers; build/modify/delete slices
- **fabric-reports**: Query usage statistics, project membership, resource utilization
