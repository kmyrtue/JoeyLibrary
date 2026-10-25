#!/usr/bin/env bash
# Installs Joey's Library on Fedora: system packages, a Python environment and a launcher in the app menu.
# Safe to run again, e.g. after "git pull" to pick up new Python packages.
# Run it as yourself, NOT with sudo: it asks for the password itself when it needs it.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Please run this without sudo:  bash install.sh"
    echo "(With sudo the app would be installed for the admin user instead of you.)"
    exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$APP_DIR/.venv"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
APPS="$DATA/applications"

# Folders left owned by root (e.g. by an earlier "sudo" run) would make the steps below fail.
# Give anything in them that is not ours back to us.
fix_owner() {
    for path in "$@"; do
        if [ -e "$path" ] && [ -n "$(sudo find "$path" ! -user "$(id -u)" -print -quit)" ]; then
            echo "==> Giving $path back to $USER (it was owned by another user)"
            sudo chown -R "$(id -u):$(id -g)" "$path"
        fi
    done
}

echo "==> Installing system packages (sudo will ask for your password)"
# python3-gobject + webkit2gtk4.1 let the app open in its own window instead of a browser tab
sudo dnf install -y python3 python3-pip python3-gobject gtk3 webkit2gtk4.1 sqlite

fix_owner "$APP_DIR" "$APPS" "$DATA/joey-library"
mkdir -p "$DATA" 2>/dev/null || true
if [ ! -w "$DATA" ]; then
    echo "==> Giving $DATA back to $USER"
    sudo chown "$(id -u):$(id -g)" "$DATA"
fi

echo "==> Setting up the Python environment in $VENV"
# --system-site-packages lets the environment use Fedora's python3-gobject
python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$APP_DIR/requirements.txt"

echo "==> Adding Joey's Library to the app menu"
mkdir -p "$APPS"
# the icon is used straight from the app folder, so no shared icon folders are needed
cat > "$APPS/joey-library.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Joey's Library
Comment=Catalogue, lend and track books
Exec="$VENV/bin/python" -m joeylibrary
Path=$APP_DIR
Icon=$APP_DIR/joeylibrary/static/icon.svg
Terminal=false
Categories=Office;Education;
EOF
chmod +x "$APPS/joey-library.desktop"
update-desktop-database "$APPS" 2>/dev/null || true

echo
echo "Done. Open Activities, search for \"Joey's Library\" and click it."
echo "Books are stored in $DATA/joey-library/library.db"
echo "Set the Dropbox backup folder under SETTINGS the first time you open the app."
