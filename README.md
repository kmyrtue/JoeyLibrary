# Joey's Library

A home library app in the style of an old green-screen terminal. Add books (with ISBN lookup), filter the
collection on any column, keep track of books on loan and the wishlist, see reading statistics, and back
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
| INSERT BOOK | Type or scan the ISBN and press Enter: title, authors and pages are filled in from the book databases (see *Book lookup* below). Choose LIBRARY or WISHLIST at the top. In AUTHOR(S), GENRES and TAGS, type a new name and press Enter to add it; put the main author first. |
| BOOKS | Every book you own. Type in the box under a column heading to filter that column (number columns accept `>`, `<` and ranges through the filter icon). The search box searches all columns. Click a heading to sort by it; AUTHORS sorts by last name (of the first author). Double-click a row to edit, check out, or delete the book. The SERIAL column, always the first one, numbers library books L0001, L0002, ... and wishlist books W0001, ... Drag headings to reorder the columns; the `x` in a heading hides that column (the buttons above the table bring it back); right-click a heading to freeze it on the left, right-click again to unfreeze it, or drag it out of the frozen columns. All of this is remembered. STARTED and FINISHED show the latest reading, TIMES READ how many readings were finished. SPICE and KINK are ratings from 0 to 5. |
| ON LOAN | Books currently on loan, oldest loan first. Loans of 60 days or more are marked `!`. Check out a book to a borrower at the bottom. |
| WISHLIST | Books you want. Double-click one and press BOUGHT IT to move it into the library. |
| READING HISTORY | Every time a book was read, newest first. Click one to change its dates or delete it. To read a book again, open it and press NEW READING: the old dates move into the history and a new reading starts today. |
| AUTHORS, GENRES, TAGS, SERIES, FORMATS, EDITIONS | The lists the books use. Add, rename (renaming to an existing name merges the two) or delete entries, and see which books use one. TAGS are your own labels, for anything genres do not cover. Drag them in the menu (press and hold on a phone) to change their order; it is remembered. |
| STATISTICS | Books and pages read per year and month, genres, authors, and a summary of the whole library. Every finished reading counts, so a book read twice counts twice; RE-READS and MOST RE-READ show those. |
| SETTINGS | Dropbox backup folder, how many dated copies to keep, backup on close, the title at the top of the screen, the yearly reading goal, and the colours (GREEN PHOSPHOR is the standard, DAEMON CYAN matches the Daemon-2.0 icon theme, or pick your own text and background colour). |

## Book lookup

An ISBN is looked up in these, in order, until one knows the book:

1. **ISBNdb**, only if an ISBNdb API key is entered under SETTINGS. Paid (isbndb.com); the same data isbnsearch.org shows.
2. **Google Books**. Works without a key, but then shares a daily quota with everyone else and is often used up.
   A free personal key avoids that (see below).
3. **LIBRIS**, the Swedish national library catalogue. Free, no key; good for Nordic and many English books.
4. **Open Library**, last because it often finds the wrong book.

**Free Google Books API key:**

1. Open https://console.cloud.google.com/apis/library/books.googleapis.com and sign in with a Google account
   (create a project when asked, any name).
2. Press **Enable**.
3. Open https://console.cloud.google.com/apis/credentials, press **Create credentials → API key**, and copy the key.
4. Optional but sensible: edit the key and under *API restrictions* choose *Restrict key → Books API*.
5. Paste it into SETTINGS → GOOGLE BOOKS API KEY and press SAVE LIBRARY SETTINGS.

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
