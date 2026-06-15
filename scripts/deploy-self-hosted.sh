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

# --- Stop running app (moved to GitHub Actions workflow) ---
# The cleanup is now handled by the GitHub Actions workflow or a separate script with appropriate permissions.
# Removing redundant cleanup from here to avoid 'Operation not permitted' errors.
# The application itself should not be responsible for killing its own processes during startup.
# stop_app() { ... } # Commented out original function content

# --- Python environment ---
setup_python() {
  echo "Setting up Python environment..."
  PYTHON_BIN="python3"

  if [[ -d "$ROOT_DIR/backend/myenv/bin" ]]; then
    source "$ROOT_DIR/backend/myenv/bin/activate"
    PYTHON_BIN="python"
  elif [[ ! -d "$ROOT_DIR/backend/.venv" ]]; then
    "$PYTHON_BIN" -m venv "$ROOT_DIR/backend/.venv"
    source "$ROOT_DIR/backend/.venv/bin/activate"
    PYTHON_BIN="python"
  else
    source "$ROOT_DIR/backend/.venv/bin/activate"
    PYTHON_BIN="python"
  fi

  "$PYTHON_BIN" -m pip install --upgrade pip
  "$PYTHON_BIN" -m pip install -r "$ROOT_DIR/backend/requirements.txt"
  export PYTHON_BIN
}

# --- Node dependencies & build ---
setup_node() {
  echo "Installing Node dependencies (including devDependencies for build tools)..."
  unset NODE_ENV
  export NPM_CONFIG_PRODUCTION=false

  if [[ -f package-lock.json ]]; then
    npm ci --legacy-peer-deps --include=dev
  else
    npm install --legacy-peer-deps --include=dev
  fi

  echo "Building frontend + production server..."
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
  echo "Using NODE_OPTIONS=${NODE_OPTIONS}"
  free -h 2>/dev/null || true
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

  nohup npm run start > "$LOG_DIR/app.log" 2>&1 &
  echo $! > "$PID_FILE"

# Health check is now handled by the GitHub Actions workflow.
# Removing redundant health check from here.
}

# The stop_app function is removed, as cleanup should be handled by the CI/CD environment.
# The health check is also removed, as it will be handled by the GitHub Actions workflow.

setup_python
run_migrations
setup_node
start_app