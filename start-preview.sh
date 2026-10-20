#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24 或更高版本，再运行 npm install。' >&2
  exit 1
fi
exec node scripts/start-desk.cjs "$@"
