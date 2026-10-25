# Joey's Library

A home library app in the style of an old green-screen terminal. Add books (with ISBN lookup), filter the
collection on any column, keep track of lent-out books and the wishlist, see reading statistics, and back
the database up to Dropbox with one click.

Everything is stored in one SQLite file: `~/.local/share/joey-library/library.db`.

## Install on Fedora

Open a terminal and paste this. It installs git (if it is not there already), downloads the app into
`~/JoeyLibrary` and runs the installer:

```bash
sudo dnf install -y git && git clone https://github.com/kmyrtue/JoeyLibrary.git ~/JoeyLibrary && cd ~/JoeyLibrary && bash install.sh
```

Then open Activities, search for **Joey's Library** and click it. The installer sets up the system packages,
a Python environment in `.venv` and the launcher in the app menu. The app runs from the folder it was
cloned into, so leave `~/JoeyLibrary` where it is.

**Update to the newest version:**

```bash
cd ~/JoeyLibrary && git pull && bash install.sh
```

Your books are not in this folder (see below), so updating never touches them.

## Using it

| Menu | What it does |
|---|---|
| INSERT BOOK | Type or scan the ISBN and press Enter: title, authors and pages are filled in from Open Library (Google Books as fallback). Choose LIBRARY or WISHLIST at the top. In AUTHOR(S) and GENRES, type a new name and press Enter to add it; put the main author first. |
| BOOKS | Every book you own. Type in the box under a column heading to filter that column (number columns accept `>`, `<` and ranges through the filter icon). The search box searches all columns. Double-click a row to edit, lend, or delete the book. |
| RENTED OUT | Books currently lent out, oldest loan first. Loans of 60 days or more are marked `!`. Lend a book at the bottom. |
| WISHLIST | Books you want. Double-click one and press BOUGHT IT to move it into the library. |
| STATISTICS | Books and pages read per year and month, genres, authors, and a summary of the whole library. |
| SETTINGS | Dropbox backup folder, how many dated copies to keep, backup on close, and the yearly reading goal. |

## Backup to Dropbox

The app finds the Dropbox folder from the Dropbox app's own settings and suggests `~/Dropbox/JoeyLibrary`.
BACK UP NOW (and, if switched on, closing the app) writes:

- `library_YYYY-MM-DD_HHMMSS.db`, a dated copy (the oldest are removed beyond the number you keep)
- `library_latest.db`, always the newest copy

The Dropbox app uploads them. The working database stays outside Dropbox on purpose, since Dropbox syncing a
database while it is being written can damage it.

**Restore:** close the app, then copy a backup over the working file:

```bash
cp ~/Dropbox/JoeyLibrary/library_latest.db ~/.local/share/joey-library/library.db
```

## For developers

- `Library.sql` is the Postgres schema; `Library.sqlite.sql` is the SQLite version the app uses to create a new database.
- `joeylibrary/app.py` holds the pages, `db.py` the SQL, `isbn.py` the lookup, `backup.py` settings and backup,
  `static/terminal.css` the look.
- Run in a browser tab instead of a window: `.venv/bin/python -m joeylibrary --browser`
- Use another database file: `JOEY_LIBRARY_DB=/tmp/test.db .venv/bin/python -m joeylibrary`

Fonts: VT323 and Share Tech Mono, both under the SIL Open Font License (see `joeylibrary/static/fonts`).
