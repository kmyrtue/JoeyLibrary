#!/usr/bin/env bash
# Installs Joey's Library on Fedora: system packages, a Python environment and a launcher in the app menu.
# Safe to run again, e.g. after "git pull" to pick up new Python packages.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$APP_DIR/.venv"
APPS="$HOME/.local/share/applications"
ICONS="$HOME/.local/share/icons/hicolor/scalable/apps"

echo "==> Installing system packages (sudo will ask for your password)"
# python3-gobject + webkit2gtk4.1 let the app open in its own window instead of a browser tab
sudo dnf install -y python3 python3-pip python3-gobject gtk3 webkit2gtk4.1 sqlite

echo "==> Setting up the Python environment in $VENV"
# --system-site-packages lets the environment use Fedora's python3-gobject
python3 -m venv --system-site-packages "$VENV"
"$VENV/bin/python" -m pip install --quiet --upgrade pip
"$VENV/bin/python" -m pip install --quiet -r "$APP_DIR/requirements.txt"

echo "==> Adding Joey's Library to the app menu"
mkdir -p "$APPS" "$ICONS"
cp "$APP_DIR/joeylibrary/static/icon.svg" "$ICONS/joey-library.svg"
cat > "$APPS/joey-library.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Joey's Library
Comment=Catalogue, lend and track books
Exec="$VENV/bin/python" -m joeylibrary
Path=$APP_DIR
Icon=joey-library
Terminal=false
Categories=Office;Education;
EOF
chmod +x "$APPS/joey-library.desktop"
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo
echo "Done. Open Activities, search for \"Joey's Library\" and click it."
echo "Books are stored in ${XDG_DATA_HOME:-$HOME/.local/share}/joey-library/library.db"
echo "Set the Dropbox backup folder under SETTINGS the first time you open the app."
