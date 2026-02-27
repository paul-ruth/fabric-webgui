#!/bin/bash
# Run FABRIC Web GUI locally for development.
# Backend (FastAPI) on port 8000, Frontend (Vite) on port 3000.
# Vite proxies /api/* to the backend automatically.

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== FABRIC Web GUI — Development Mode ==="
echo ""

# Check for fabric_config
FABRIC_CONFIG="${FABRIC_CONFIG_DIR:-$HOME/work/fabric_config}"
if [ ! -f "$FABRIC_CONFIG/fabric_rc" ]; then
    echo "WARNING: fabric_rc not found at $FABRIC_CONFIG/fabric_rc"
    echo "Set FABRIC_CONFIG_DIR to your FABRIC config directory."
    echo ""
fi

# Start backend
echo "Starting backend (FastAPI)..."
cd "$SCRIPT_DIR/backend"
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start frontend
echo "Starting frontend (Vite)..."
cd "$SCRIPT_DIR/frontend"
if [ ! -d "node_modules" ]; then
    echo "Installing npm dependencies..."
    npm install
fi

npm run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:8000  (API docs: http://localhost:8000/docs)"
echo "Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop both."

# Trap Ctrl+C to stop both processes
cleanup() {
    echo ""
    echo "Stopping..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "Done."
}
trap cleanup INT TERM

wait
