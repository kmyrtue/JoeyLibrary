"""Settings file and Dropbox backup. The app writes a copy into a Dropbox folder; the Dropbox client uploads it."""
import json
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from . import db, roomdb

CONFIG_DIR = Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'joey-library'
SETTINGS_FILE = CONFIG_DIR / 'settings.json'


def find_dropbox() -> Path | None:
    """Find the Dropbox folder from the Dropbox client's own info file, or fall back to ~/Dropbox."""
    info = Path.home() / '.dropbox' / 'info.json'
    try:
        data = json.loads(info.read_text(encoding='utf-8'))
        for account in ('personal', 'business'):
            path = data.get(account, {}).get('path')
            if path and Path(path).is_dir():
                return Path(path)
    except (OSError, ValueError):
        pass
    fallback = Path.home() / 'Dropbox'
    return fallback if fallback.is_dir() else None


DEFAULT_TITLE = 'JOEYCO INDUSTRIES (TM) TERMLINK PROTOCOL'
# the two ready-made colour schemes (text, background); the first one is the standard
THEMES = {
    'GREEN PHOSPHOR': ('#1aff80', '#030a05'),
    'DAEMON CYAN': ('#5df4fe', '#210e15'),  # the Daemon-2.0 icon theme
}
DEFAULT_THEME = 'GREEN PHOSPHOR'


def load_settings() -> dict:
    dropbox = find_dropbox()
    settings = {
        'backup_dir': str(dropbox / 'JoeyLibrary') if dropbox else '',
        'keep': 20,
        'backup_on_exit': True,
        'last_backup': None,
        'reading_goal': 30,
        'title': DEFAULT_TITLE,
        'isbndb_key': '',
        'google_books_key': '',
        'column_order': {},  # page -> column fields in the order they were dragged into
        'text_color': THEMES[DEFAULT_THEME][0],
        'bg_color': THEMES[DEFAULT_THEME][1],
    }
    try:
        settings.update(json.loads(SETTINGS_FILE.read_text(encoding='utf-8')))
    except (OSError, ValueError):
        pass
    return settings


def save_settings(settings: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(settings, indent=2), encoding='utf-8')


def list_backups(backup_dir: str, name: str = 'library') -> list[Path]:
    """The dated copies of one database, newest first: name 'library' (library.db) or 'room' (the 3D room's room.db)."""
    folder = Path(backup_dir)
    return sorted(folder.glob(f'{name}_2*.db'), reverse=True) if folder.is_dir() else []


def backup_now() -> Path:
    """Write a consistent copy of the database into the backup folder and prune old copies."""
    settings = load_settings()
    if not settings['backup_dir']:
        raise ValueError('No backup folder set. Choose one under SETTINGS.')
    folder = Path(settings['backup_dir']).expanduser()
    if not folder.parent.is_dir():
        raise FileNotFoundError(f'{folder.parent} does not exist. Is Dropbox installed and running?')
    folder.mkdir(exist_ok=True)

    stamp = f'{datetime.now():%Y-%m-%d_%H%M%S}'
    dest = _copy(db.DB_PATH, folder, 'library', stamp, int(settings['keep']))
    # the 3D room is backed up next to it in files of its own, so either one can be restored without the other
    if roomdb.DB_PATH.exists():
        _copy(roomdb.DB_PATH, folder, 'room', stamp, int(settings['keep']))

    settings['last_backup'] = datetime.now().isoformat(timespec='seconds')
    save_settings(settings)
    return dest


def _copy(path: Path, folder: Path, name: str, stamp: str, keep: int) -> Path:
    """A consistent copy of one database as name_<stamp>.db and name_latest.db; keeps the newest `keep` dated copies."""
    dest = folder / f'{name}_{stamp}.db'
    src = sqlite3.connect(path)
    out = sqlite3.connect(dest)
    try:
        src.backup(out)  # safe even while the app has the database open
    finally:
        out.close()
        src.close()
    # name_latest.db is always the newest copy, so restoring means copying one file back
    latest = folder / f'{name}_latest.db'
    tmp = folder / f'{name}_latest.db.tmp'
    tmp.write_bytes(dest.read_bytes())
    tmp.replace(latest)
    for old in list_backups(str(folder), name)[max(1, keep):]:
        old.unlink(missing_ok=True)
    return dest
