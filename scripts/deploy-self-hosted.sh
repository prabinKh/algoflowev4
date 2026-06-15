#!/usr/bin/env bash
# Deploy AlgoFlow / FixItAll on a self-hosted runner after each push to main.
set -euo pipefail

ROOT_DIR="${GITHUB_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT_DIR"

APP_NAME="algoflow"
PID_FILE="$ROOT_DIR/.deploy/app.pid"
LOG_DIR="$ROOT_DIR/.deploy/logs"
mkdir -p "$LOG_DIR" "$(dirname "$PID_FILE")"

echo "=== Deploy started at $(date -u +"%Y-%m-%dT%H:%M:%SZ") ==="
echo "Deploy directory: $ROOT_DIR"

# --- Stop running app ---
stop_app() {
  echo "Stopping existing frontend/backend processes..."

  if [[ -f "$PID_FILE" ]]; then
    OLD_PID="$(cat "$PID_FILE" || true)"
    if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
      kill "$OLD_PID" 2>/dev/null || true
      sleep 2
      kill -9 "$OLD_PID" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  fi

  # FIX: Use kill only on PIDs we OWN (no sudo needed, no permission errors)
  pkill -f "dist/server.cjs" 2>/dev/null || true
  pkill -f "dist/server.mjs" 2>/dev/null || true
  pkill -f "manage.py runserver" 2>/dev/null || true
  pkill -f "gunicorn" 2>/dev/null || true

  # FIX: fuser may fail if port owned by another user; use lsof as fallback
  fuser -k 3000/tcp 2>/dev/null || lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  fuser -k 8001/tcp 2>/dev/null || lsof -ti:8001 | xargs kill -9 2>/dev/null || true

  sleep 1
}

# --- Python virtual environment ---
setup_python() {
  echo "Setting up Python virtual environment..."
  PYTHON_BIN="python3"

  VENV_DIR="$ROOT_DIR/backend/.venv"

  if [[ -d "$ROOT_DIR/backend/myenv/bin" ]]; then
    source "$ROOT_DIR/backend/myenv/bin/activate"
    PYTHON_BIN="python"
  elif [[ ! -d "$VENV_DIR" ]]; then
    "$PYTHON_BIN" -m venv "$VENV_DIR"
    source "$VENV_DIR/bin/activate"
    PYTHON_BIN="python"
  else
    source "$VENV_DIR/bin/activate"
    PYTHON_BIN="python"
  fi

  "$PYTHON_BIN" -m pip install --upgrade pip --quiet
  "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/backend/requirements.txt" --quiet
  # FIX: Ensure gunicorn is always installed inside the venv
  "$PYTHON_BIN" -m pip install gunicorn --quiet
  export PYTHON_BIN
}

# --- Node dependencies & build ---
setup_node() {
  echo "Installing Node dependencies..."
  unset NODE_ENV
  export NPM_CONFIG_PRODUCTION=false

  if [[ -f package-lock.json ]]; then
    npm ci --legacy-peer-deps --include=dev
  else
    npm install --legacy-peer-deps --include=dev
  fi

  echo "Building frontend + production server..."
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
  NODE_ENV=production npm run build:prod
}

# --- Django migrations ---
run_migrations() {
  echo "Running Django migrations..."
  cd "$ROOT_DIR/backend"
  "$PYTHON_BIN" manage.py makemigrations --noinput || true
  "$PYTHON_BIN" manage.py migrate --noinput
  "$PYTHON_BIN" manage.py collectstatic --noinput --clear 2>/dev/null || true
  cd "$ROOT_DIR"
}

# --- Start app ---
start_app() {
  echo "Starting production server (frontend + backend proxy)..."
  export NODE_ENV=production
  export PORT="${PORT:-3000}"

  # FIX: Pass the activated venv's PATH so node can find gunicorn/python3
  nohup env PATH="$PATH" npm run start > "$LOG_DIR/app.log" 2>&1 &
  echo $! > "$PID_FILE"
  echo "Server PID: $(cat $PID_FILE)"

  echo "Waiting for services to become ready..."
  # FIX: Wait longer (60s) because Django seeding takes time on first run
  for i in {1..30}; do
    if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
      echo "Health check passed on port ${PORT}"
      echo "=== Deploy finished successfully ==="
      return 0
    fi
    echo "  Attempt $i/30 — waiting 3s..."
    sleep 3
  done

  echo "Health check failed. Printing FULL logs to help debug:"
  cat "$LOG_DIR/app.log" || true
  exit 1
}

stop_app
setup_python
setup_node
run_migrations
start_app