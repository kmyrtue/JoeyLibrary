# Joey's Library

A home library app in the style of an old green-screen terminal. Add books (with ISBN lookup), filter the
collection on any column, keep track of books on loan and the wishlist, see reading statistics, and back
the database up to Dropbox with one click.

The library is stored in one SQLite file, `~/.local/share/joey-library/library.db`. The 3D room (BOOKSHELF
SIMULATION) keeps its own file next to it, `room.db`, so nothing done in the room can damage the library.

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
| BOOKSHELF SIMULATION | A 3D model of the living room with its bookcases, holding the library's own books (not the wishlist, audiobooks or e-books). Click in it to walk around: W A S D to walk, the mouse to look, Space up, Alt or C down, click to take a book or put it where the green outline is, Esc to stop. Its menu items (BOOKSHELF SIMULATION, BOOK WORKSHOP, ...) can be dragged into another order like the indexes. Under BOOKCASES you choose how bookcases and shelves are written: A, B, C or 1, 2, 3, from 0, or two digits (01, 02) for the bookcases, and 1, 2, 3, from 0, two digits or a, b, c for the shelves, so the third shelf in the second bookcase is B3, 2-3, 02-03, 02c and so on. A book new to the library arrives in a cardboard mailer, piled with any others on the coffee table (and on the floor beside it when the table is full): pick one up and press O to open it, and the book is in your hand. The first time the room is opened, every book of the library arrives this way; the room never puts a book on a shelf by itself. **Universe** at the top keeps the room in several named versions: each has its own places of books, bookcases, zones and furniture, so a layout can be tried out and another one picked up again where it was left. NEW COPY starts one as the room is now, NEW EMPTY one with every book still in its parcel and the furniture where it was built; RENAME and DELETE (asked first; the last one stays) work on the one shown. The books themselves (BOOK WORKSHOP) and BOOK TYPES are the same in all of them. RESET THE SHELVES puts every opened book back on the shelves by author; unopened parcels stay parcels. Everything is saved the moment it happens: every book put down, every piece of furniture moved, and where the room puts new books by itself. If a save fails (the app busy or restarting) it is tried again every few seconds, and the line at the top says so until it gets through. Besides the BILLYs the room has the shelves over the windows and by the stove, the KALLAX, the chatol, the chests of drawers and the coffee table; books can go on all of them. **Move furniture** lets you pick up any of them and put it somewhere else (R turns it, the wheel turns it a little); the books on it go with it, and Delete takes it out of the room. **Add or take out furniture** lists every piece: take one out (its books go to the other shelves), put a piece you took out back, or add another of any kind (a BILLY, the KALLAX, a chest, the chatol, a shelf module, the coffee table), which you then put down where you want it. A new BILLY gets the next free letter and shows up under BOOKCASES. With a book in your hand, Q turns it cover out, Ctrl and the mouse turn it round (left and right) and lean it back or forward (up and down), and T puts it straight again; it stays the way you put it down. A **book stand** (added under Add or take out furniture) goes on a shelf, a table or the top of a bookcase: aim at the board and click. A book put on it leans against its back, cover out. The stand moves with the furniture it is on and is taken away with it. |
| BOOK WORKSHOP | How a book looks in the room: book type and size, spine and back colour, sprayed edges, and photos of its sides. Saving also writes the title, authors, pages and ISBN back to the library, and SPRAYED EDGES; a book made here with NEW BOOK becomes a library book. UNDO MY CHANGES forgets only how the room draws the book. The book type is first guessed from the library's FORMAT, and the spine colour from the cover. |
| BOOKCASES | The bookcases A to D and their shelves: move, add or take out the adjustable shelves and give shelves names. NUMBER gives a bookcase a number of its own instead of its place in the row. The other furniture books can go on (the chatol, the KALLAX, the chests ...) is listed below: name its shelves the same way, or give it a number to have its shelves written like a bookcase's instead of K1, Chatol 2 and so on. |
| ZONES | Gather bookcases and other furniture into zones, the way a library has a fantasy and a science fiction section. A zone's letter or number comes first, so the third shelf in the second bookcase of zone A is A-B3 (or A-02-3, 1-2-3 with other formats). The bookcases in a zone count from the first one in it; use ▲ ▼ to change the order. Zones only change how places are written; the books stay where they are. |
| BOOK TYPES | The book formats the room knows (American, British and Danish hardcovers and paperbacks) and their sizes. |

Dates are written dd/mm/yyyy. Type just the digits: the slashes come by themselves, extra digits are ignored, and Backspace takes away the last digit. Or click the calendar at the end of the field: ↑ ↓ go to the month before or after, the month at the top opens a list of months, and Clear and Today are at the bottom. A date that is not finished or does not exist (31/02) is not saved; you are told which field it is.

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
- `room_YYYY-MM-DD_HHMMSS.db` and `room_latest.db`, the same for the 3D room

The Dropbox app uploads them. The working database stays outside Dropbox on purpose, since Dropbox syncing a
database while it is being written can damage it.

**Restore:** close the app, then copy a backup over the working file:

```bash
cp ~/Dropbox/JoeyLibrary/library_latest.db ~/.local/share/joey-library/library.db
```

The room is restored the same way, on its own if only the room went wrong:

```bash
cp ~/Dropbox/JoeyLibrary/room_latest.db ~/.local/share/joey-library/room.db
```

## For developers

- `Library.sql` is the Postgres schema; `Library.sqlite.sql` is the SQLite version the app uses to create a new database.
- `joeylibrary/app.py` holds the pages, `db.py` the SQL, `isbn.py` the lookup, `backup.py` settings and backup,
  `static/terminal.css` the look.
- Date fields are `DateInput` in `app.py`: a text field with a `##/##/####` mask and a calendar drawn in Python
  (styled as `.term-cal` in `terminal.css`), not the browser's own date field; read and set the date with `.iso`.
- Run in a browser tab instead of a window: `.venv/bin/python -m joeylibrary --browser`
- The bookshelf simulation is a web page in `joeylibrary/sim/` (three.js for the 3D, cannon.js for books that fall),
  shown in a frame; `joeylibrary/sim.py` serves it under `/sim-files/` and its data under `/api/sim/`. Its own data
  is in `room.db` (`joeylibrary/roomdb.py`, schema in `Room.sqlite.sql`: SimUniverses, SimSettings, SimBooks,
  SimPlaces, SimCases, SimFurniture, SimPhotos), linked to the library by BookID only. SimPlaces, SimCases and
  SimFurniture are per universe (keyed by UniverseID); SimSettings `universe` is the one the room opens in; the page
  names its universe in every save (`?u=`), so a second window keeps saving into its own. An older library.db that
  still has these tables has them moved to room.db on start, and a room.db from before universes has its rows made
  universe 1, "My room" (a copy is kept as `room.before-universes.db`). The page saves through one queue in `sim/js/store.js`: writes go out in order,
  one at a time, and are retried until the server takes them. The furniture
  is built in `sim/js/furniture.js`, each kind as a type that can be built again (`R.types`); a SimFurniture row is
  where a piece was moved to, `{gone: true}` for one of the room's own pieces taken out, or `{of: type}` for one added; a SimPlaces row with `parcel: true` is a book still in its mailer, and `{opened: true}` one opened but not put anywhere yet (on the next load it lies on the coffee table in the library, outside it it goes on the shelves); in the library a book with no SimPlaces row (or one whose shelf is gone) is delivered as a parcel, the first time the room is opened too; sizes measured in the room are marked there, the rest are estimates from photos. The rounded edges, knobs, handles and mouldings there are only looked at: books stand on the surfaces (`u.surface`) and bump into the plain boxes in `statics`, and the terminal look outlines a rounded board as its plain box (`geometry.userData.outline`). The doors in `room.js` are built the same way: their casings, leaves, hinges and handles are drawn with `trim` and `lever`, and each door is one plain box in `statics` (`solidBox`). How places are written is in SimCases too: `labels` (the bookcase, shelf and zone formats), `zones` (`{list: [{id, name, units}]}`) and a piece's own `no`; `R.code(surface)` in `room.js` writes a place. A book's place can have `face` (cover out), `yaw` and `lean` in degrees; a book stand is furniture of type `stand` mounted on another piece's board, its SimFurniture row saying which (`on`). Covers are fetched from
  Open Library or Google Books once and kept in `sim-covers/` next to the database.
- Use another database file: `JOEY_LIBRARY_DB=/tmp/test.db .venv/bin/python -m joeylibrary` (the room's is then
  `/tmp/room.db`, or set `JOEY_ROOM_DB`)

Fonts: VT323 and Share Tech Mono, both under the SIL Open Font License (see `joeylibrary/static/fonts`).
three.js r128 and cannon.js 0.6.2 (`joeylibrary/sim/vendor`) are under the MIT License. The wood, floor and wall
textures in `joeylibrary/sim/tex` are CC0 from Poly Haven (polyhaven.com).
