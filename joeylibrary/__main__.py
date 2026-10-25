"""Start the library: python -m joeylibrary [--browser] [--port N]"""
import argparse
import os
import sys
from pathlib import Path

from nicegui import app, ui

from . import app as _pages  # noqa: F401  (registers the pages)
from . import db

parser = argparse.ArgumentParser(prog='joeylibrary')
parser.add_argument('--browser', action='store_true', help='open in the web browser instead of an app window')
parser.add_argument('--port', type=int, default=8765, help='port for --browser mode (default 8765)')
parser.add_argument('--no-show', action='store_true', help='do not open a browser tab (with --browser)')
args, _ = parser.parse_known_args()

db.init_db()

native = not args.browser
if native:
    try:
        import webview  # noqa: F401
    except ImportError:
        print('pywebview is not available; opening the library in the web browser instead.')
        native = False

icon = Path(__file__).resolve().parent / 'static' / 'icon.svg'
options = dict(title='JOEY LIBRARY', favicon=icon, dark=True, reload=False, show_welcome_message=False)
if native and sys.platform.startswith('linux'):
    # use GTK even on KDE (pywebview would try Qt first, which is not installed)
    os.environ.setdefault('PYWEBVIEW_GUI', 'gtk')
    # WebKitGTK's DMA-BUF renderer crashes on some Wayland setups ("Error 71 (Protocol error)")
    os.environ.setdefault('WEBKIT_DISABLE_DMABUF_RENDERER', '1')
if native:
    app.native.window_args['text_select'] = True  # pywebview blocks selecting and copying text by default
    ui.run(native=True, window_size=(1400, 880), **options)
else:
    ui.run(port=args.port, show=not args.no_show, **options)
