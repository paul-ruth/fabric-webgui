# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

fabric-webgui is a standalone web GUI that replicates the Jupyter-based **fabvis** (from `fabrictestbed-extensions` fabvis branch) as a browser application. It uses the same visual language, layout, and interaction patterns: three-panel editor with Cytoscape.js topology graph, geographic Leaflet map view, and matching FABRIC brand styling.

## Architecture

- **Backend**: FastAPI (Python) wrapping FABlib for all FABRIC operations → `backend/`
- **Frontend**: React 18 + TypeScript with Cytoscape.js and react-leaflet → `frontend/`
- **Deployment**: Docker Compose (backend + nginx-served frontend)

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
- `app/routes/slices.py` — CRUD + submit/modify/refresh/delete for slices, nodes, components, networks
- `app/routes/resources.py` — Sites (with GPS coords), images, component models

### Frontend (`frontend/src/`)
- `App.tsx` — Root component, state management, API orchestration
- `api/client.ts` — Typed fetch wrappers for all backend endpoints
- `components/CytoscapeGraph.tsx` — Cytoscape.js with fabvis-matching stylesheet and 6 layout algorithms
- `components/EditorPanel.tsx` — 5-tab editor (Node, Component, Network, Remove, Configure)
- `components/DetailPanel.tsx` — Properties display for clicked element
- `components/GeoView.tsx` — Leaflet map with site markers and network connections
- `components/Toolbar.tsx` — Slice selector, action buttons, view toggle, delete confirmation
- `components/TitleBar.tsx` — FABRIC branded gradient header
- `types/fabric.ts` — TypeScript interfaces matching backend response shapes

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
