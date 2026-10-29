#!/usr/bin/env bash
# A test server for the 3D room on its own port with a scratch copy of the data (Git Bash on Windows).
#   test_env.sh setup <dir> <library.db to copy> [settings.json to copy] [port]   make <dir>, copy the data in
#   test_env.sh start <dir> [port]                                               run the server (run in the background)
#   test_env.sh stop [port]                                                       kill whatever listens on the port
# Then, when done: test_env.sh stop, and rm -rf <dir>.
# Never use port 8000 or the user's own database or settings: the server writes to the database it is given.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
cmd="$1"; shift
case "$cmd" in
  setup)
    dir="$1"; db="$2"; settings="${3:-}"
    mkdir -p "$dir/cfg/joey-library" "$dir/bk"
    cp "$db" "$dir/library.db"
    # no backups of the scratch data into the user's backup folder
    "$REPO/.venv/Scripts/python.exe" -I - "$dir" "$settings" <<'EOF'
import json, sys
d, src = sys.argv[1], sys.argv[2]
s = json.load(open(src, encoding='utf-8')) if src else {}
s['backup_on_exit'] = False; s['backup_dir'] = d + '/bk'
json.dump(s, open(d + '/cfg/joey-library/settings.json', 'w', encoding='utf-8'))
EOF
    echo "ready: $dir" ;;
  start)
    dir="$1"; port="${2:-8812}"
    cd "$REPO"
    JOEY_LIBRARY_DB="$dir/library.db" XDG_CONFIG_HOME="$dir/cfg" .venv/Scripts/python.exe -m joeylibrary --browser --port "$port" --no-show ;;
  stop)
    port="${1:-8812}"
    for p in $(netstat -ano | grep ":$port " | grep LISTEN | awk '{print $5}' | sort -u); do taskkill //PID "$p" //F; done ;;
  *) echo "usage: test_env.sh setup|start|stop ..." >&2; exit 2 ;;
esac
