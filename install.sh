#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: Node.js dan npm harus tersedia di egg/container Pterodactyl." >&2
  exit 1
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)' || {
  echo "ERROR: Bot membutuhkan Node.js 20 atau lebih baru." >&2
  exit 1
}

if [[ ! -f package-lock.json ]]; then
  echo "ERROR: package-lock.json tidak ditemukan. Upload seluruh source project." >&2
  exit 1
fi

hash_file() {
  sha256sum "$1" | awk '{ print $1 }'
}

npm_hash="$(hash_file package-lock.json)"
npm_marker="node_modules/.unicorn-md-wa-package-lock.sha256"
if [[ ! -f "$npm_marker" ]] || [[ "$(cat "$npm_marker")" != "$npm_hash" ]]; then
  echo "Menyiapkan dependency Node.js..."
  npm ci --omit=dev --no-audit --no-fund
  printf '%s\n' "$npm_hash" > "$npm_marker"
else
  echo "Dependency Node.js sudah siap."
fi

if [[ -n "${PYTHON:-}" ]]; then
  base_python="$PYTHON"
elif [[ -x .venv/bin/python ]]; then
  base_python=".venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  base_python="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  base_python="$(command -v python)"
else
  echo "ERROR: Python 3.10+ dan pip harus tersedia di egg/container Pterodactyl." >&2
  exit 1
fi

if [[ ! -x .venv/bin/python ]]; then
  echo "Membuat virtual environment Python..."
  "$base_python" -m venv .venv
fi

venv_python=".venv/bin/python"
"$venv_python" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' || {
  echo "ERROR: Fitur scraping/TikTok membutuhkan Python 3.10 atau lebih baru." >&2
  exit 1
}

requirements_hash="$(hash_file requirements.txt)"
python_version="$("$venv_python" -c 'import platform; print(platform.python_version())')"
python_marker=".venv/.unicorn-md-wa-requirements.sha256"
expected_python_marker="${requirements_hash}:${python_version}"
if [[ ! -f "$python_marker" ]] || [[ "$(cat "$python_marker")" != "$expected_python_marker" ]]; then
  echo "Menyiapkan dependency Python..."
  "$venv_python" -m pip install -r requirements.txt
  printf '%s\n' "$expected_python_marker" > "$python_marker"
else
  echo "Dependency Python sudah siap."
fi

echo "Setup selesai. Bot siap dijalankan."
