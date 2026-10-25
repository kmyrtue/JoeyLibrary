"""The library user interface: one NiceGUI page per menu item."""
import re
from datetime import date, datetime
from pathlib import Path

from nicegui import app, run, ui

from . import backup, db, isbn as isbn_lookup

HERE = Path(__file__).resolve().parent
app.add_static_files('/static', HERE / 'static')
ui.add_css(HERE / 'static' / 'terminal.css', shared=True)

# (label, path) entries; a plain string starts a new section of the menu
MENU = [
    ('INSERT BOOK', '/insert'),
    ('BOOKS', '/'),
    ('RENTED OUT', '/loans'),
    ('WISHLIST', '/wishlist'),
    ('STATISTICS', '/stats'),
    'INDEXES',
    ('AUTHORS', '/authors'),
    ('GENRES', '/genres'),
    ('SERIES', '/series'),
    ('FORMATS', '/formats'),
    ('EDITIONS', '/editions'),
    'SYSTEM',
    ('SETTINGS', '/settings'),
]
KIND_NAMES = {'owned': 'LIBRARY', 'wished': 'WISHLIST'}
RATINGS = {None: '-', 0: '0', 1: '* (1)', 2: '** (2)', 3: '*** (3)', 4: '**** (4)', 5: '***** (5)'}


def button(text: str, on_click=None, danger: bool = False) -> ui.button:
    b = ui.button(f'[ {text} ]', on_click=on_click).props('flat no-caps').classes('term-btn')
    if danger:
        b.classes('danger')
    return b


def number(value, cast=int):
    return None if value in (None, '') else cast(value)


# ---------- colours: two chosen colours, everything else is mixed from them ----------

def hex_color(value, fallback: str) -> str:
    value = (value or '').strip().lower()
    return value if re.fullmatch(r'#[0-9a-f]{6}', value) else fallback


def mix(a: str, b: str, share: float) -> str:
    """share of colour a, the rest colour b"""
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x * share + y * (1 - share)):02x}' for x, y in zip(pa, pb))


def theme_colors(settings: dict) -> tuple[str, str]:
    text_default, bg_default = backup.THEMES[backup.DEFAULT_THEME]
    return hex_color(settings.get('text_color'), text_default), hex_color(settings.get('bg_color'), bg_default)


def apply_theme(settings: dict) -> None:
    text, bg = theme_colors(settings)
    rgb = ', '.join(str(int(text[i:i + 2], 16)) for i in (1, 3, 5))
    ui.add_head_html(f'<style>:root {{ --green: {text}; --green-mid: {mix(text, bg, .75)}; '
                     f'--green-dim: {mix(text, bg, .45)}; --green-faint: {mix(text, bg, .18)}; --bg: {bg}; '
                     f'--bg-raised: {mix(text, bg, .04)}; --bg-odd: {mix(text, bg, .02)}; --text-rgb: {rgb}; }}</style>')
    ui.colors(primary=text, secondary=mix(text, bg, .45), accent='#ffb642', dark=bg,
              positive=text, negative='#ff5a4a', warning='#ffb642', info=text)


def shell() -> None:
    """Header and left menu, built once per window; the pages below only swap the content under them."""
    settings = backup.load_settings()
    apply_theme(settings)
    ui.dark_mode(True)
    with ui.header().classes('term-header'):
        with ui.column().classes('gap-0'):
            banner = ui.label().classes('term-banner')
            status = ui.label().classes('term-status')
    links = {}
    with ui.left_drawer(value=True, fixed=True).props('width=250 behavior=desktop').classes('term-drawer'):
        for entry in MENU:
            if isinstance(entry, str):
                ui.label(f'-- {entry} --').classes('term-menu-section')
                continue
            label, path = entry
            links[label] = ui.link(f'> {label}', path).classes('term-menu')
        ui.label(f'{date.today():%Y-%m-%d}  //  TERMINAL READY').classes('term-hint')
    ui.context.client.shell = {'banner': banner, 'status': status, 'links': links}


def frame(active: str) -> None:
    """Bring the header and menu up to date for the page being shown, and print the page title."""
    settings = backup.load_settings()
    ui.page_title(f'JOEY LIBRARY - {active}')
    last = settings.get('last_backup')
    last = datetime.fromisoformat(last).strftime('%Y-%m-%d %H:%M') if last else 'NEVER'
    owned = db.stats(date.today().year)['owned'][0]
    shell_parts = ui.context.client.shell
    shell_parts['banner'].set_text(settings.get('title') or backup.DEFAULT_TITLE)
    shell_parts['status'].set_text(f'LIBRARY OS v1.0  //  {owned} VOLUMES ON FILE  //  LAST BACKUP: {last}')
    for label, link in shell_parts['links'].items():
        if label == active:
            link.classes(add='active')
        else:
            link.classes(remove='active')
    ui.label(f'> {active}').classes('term-title')


# ---------- the book form, used for inserting and editing ----------

class BookForm:
    def __init__(self, kind: str, book: dict | None = None, allow_kind_switch: bool = False) -> None:
        self.kind = kind
        self.original = book or {}
        b = self.original
        with ui.column().classes('w-full gap-1'):
            if allow_kind_switch:
                ui.toggle(KIND_NAMES, value=kind, on_change=lambda e: self.set_kind(e.value)).props('unelevated')
            with ui.row().classes('w-full items-end gap-2 no-wrap'):
                self.isbn = ui.input('ISBN  (type or scan, then ENTER)', value=b.get('ISBN') or '').classes('grow')
                self.isbn.on('keydown.enter', self.lookup)
                button('LOOKUP', self.lookup)
            self.status = ui.label('').classes('term-faint')
            self.title = ui.input('TITLE', value=b.get('Title') or '').classes('w-full')
            self.authors = ui.select(db.names('Authors'), label='AUTHOR(S)  - main author first, ENTER adds a new name',
                                     multiple=True, with_input=True, new_value_mode='add-unique',
                                     value=b.get('AuthorList', [])).props('use-chips hide-dropdown-icon').classes('w-full')
            self.genres = ui.select(db.names('Genres'), label='GENRES  - ENTER adds a new genre',
                                    multiple=True, with_input=True, new_value_mode='add-unique',
                                    value=b.get('GenreList', [])).props('use-chips hide-dropdown-icon').classes('w-full')
            with ui.element('div').classes('grid grid-cols-1 md:grid-cols-4 gap-x-6 w-full'):
                self.edition = ui.input('EDITION', value=b.get('Edition') or '')
                self.format = ui.select(db.names('Formats'), label='FORMAT', with_input=True, clearable=True,
                                        new_value_mode='add-unique', value=b.get('FormatName'))
                self.series = ui.select(db.names('Series'), label='SERIES', with_input=True, clearable=True,
                                        new_value_mode='add-unique', value=b.get('SeriesTitle'))
                self.number_in_series = ui.number('NO. IN SERIES', value=b.get('NumberInSeries'), min=0)
            self.signed = ui.checkbox('SIGNED', value=bool(b.get('Signed')))
            self.owned_box = ui.column().classes('w-full gap-1')
            with self.owned_box:
                with ui.element('div').classes('grid grid-cols-1 md:grid-cols-4 gap-x-6 w-full'):
                    self.pages = ui.number('PAGES', value=b.get('PageCount'), min=0, precision=0)
                    self.shelf = ui.number('SHELF NO.', value=b.get('ShelfNumber'), min=0, precision=0)
                    self.rating = ui.select(RATINGS, label='RATING', value=b.get('Rating'))
                    ui.element('div')
                    self.started = ui.input('STARTED', value=b.get('StartedDate') or '').props('type=date stack-label')
                    self.finished = ui.input('FINISHED', value=b.get('FinishedDate') or '').props('type=date stack-label')
                with ui.row().classes('gap-6'):
                    self.read = ui.checkbox('READ', value=bool(b.get('Read')))
                    self.edge = ui.checkbox('SPRAYED EDGES', value=bool(b.get('EdgeOut')))
                self.comments = ui.textarea('COMMENTS', value=b.get('Comments') or '').props('autogrow').classes('w-full')
        self.set_kind(kind)

    def set_kind(self, kind: str) -> None:
        self.kind = kind
        self.owned_box.set_visibility(kind == 'owned')

    async def lookup(self) -> None:
        code = isbn_lookup.clean(self.isbn.value)
        if not code:
            self.status.set_text('ENTER AN ISBN FIRST.')
            return
        already = [KIND_NAMES[k] for k in db.find_isbn(code)
                   if not (k == self.kind and isbn_lookup.clean(self.original.get('ISBN')) == code)]
        settings = backup.load_settings()
        key = (settings.get('isbndb_key') or '').strip()
        google_key = (settings.get('google_books_key') or '').strip()
        self.status.set_text('SEARCHING THE BOOK DATABASES ...')
        self.status.classes(remove='term-warn term-error')
        try:
            found = await run.io_bound(isbn_lookup.lookup, code, key, google_key)
        except (ValueError, ConnectionError, isbn_lookup.BadKey) as e:
            self.status.set_text(f'ERROR: {e}'.upper())
            self.status.classes('term-error')
            return
        if not found:
            self.status.set_text('NO RECORD FOUND FOR THIS ISBN. ENTER THE DETAILS BY HAND.')
            self.status.classes('term-warn')
            return
        self.title.value = found['Title']
        if found['AuthorList']:
            self.authors.set_options(sorted(set(self.authors.options) | set(found['AuthorList']), key=str.lower))
            self.authors.value = found['AuthorList']
        if found.get('PageCount'):
            self.pages.value = found['PageCount']
        details = ', '.join(x for x in (found.get('Publisher'), found.get('Year')) if x)
        message = f"RECORD FOUND IN {found['Source'].upper()}" + (f'  //  {details}' if details else '')
        if already:
            message += f"  //  NOTE: THIS ISBN IS ALREADY IN THE {' AND '.join(already)}"
            self.status.classes('term-warn')
        self.status.set_text(message)

    def values(self) -> dict | None:
        """Collect the form, or show what is missing and return None."""
        title = (self.title.value or '').strip()
        if not title or not self.authors.value:
            ui.notify('A BOOK NEEDS A TITLE AND AT LEAST ONE AUTHOR.', type='warning')
            return None
        data = {
            'Title': title,
            'AuthorList': list(self.authors.value),
            'GenreList': list(self.genres.value or []),
            'Edition': (self.edition.value or '').strip() or None,
            'FormatName': self.format.value,
            'SeriesTitle': self.series.value,
            'NumberInSeries': number(self.number_in_series.value, float),
            'Signed': int(bool(self.signed.value)),
            'ISBN': (self.isbn.value or '').strip() or None,
        }
        if self.kind == 'owned':
            finished = self.finished.value or None
            data.update({
                'PageCount': number(self.pages.value),
                'ShelfNumber': number(self.shelf.value),
                'Rating': self.rating.value,
                'StartedDate': self.started.value or None,
                'FinishedDate': finished,
                'Read': int(bool(self.read.value or finished)),  # a finished date means it has been read
                'EdgeOut': int(bool(self.edge.value)),
                'Comments': (self.comments.value or '').strip() or None,
                # loans are changed on their own buttons; keep whatever the book had
                'LoanedTo': self.original.get('LoanedTo'),
                'LoanedDate': self.original.get('LoanedDate'),
            })
        return data

    def clear(self) -> None:
        for field in (self.isbn, self.title, self.edition, self.started, self.finished, self.comments):
            field.value = ''
        for field in (self.format, self.series, self.number_in_series, self.pages, self.shelf, self.rating):
            field.value = None
        for field in (self.signed, self.read, self.edge):
            field.value = False
        self.authors.set_options(db.names('Authors'), value=[])
        self.genres.set_options(db.names('Genres'), value=[])
        self.format.set_options(db.names('Formats'), value=None)
        self.series.set_options(db.names('Series'), value=None)
        self.status.set_text('')
        self.isbn.run_method('focus')


def open_editor(kind: str, book_id: int, on_change) -> None:
    """Edit one book in a dialog, with lend/return, 'bought it' and delete."""
    book = db.get_book(kind, book_id)

    def done(message: str) -> None:
        dialog.close()
        ui.notify(message)
        on_change()

    def save() -> None:
        data = form.values()
        if data:
            db.save_book(kind, data, book_id)
            done(f"{data['Title'].upper()} SAVED.")

    def delete() -> None:
        if delete_btn.text != '[ CONFIRM DELETE ]':
            delete_btn.set_text('[ CONFIRM DELETE ]')
            return
        db.delete_book(kind, book_id)
        done(f"{book['Title'].upper()} DELETED.")

    def lend() -> None:
        if not borrower.value:
            ui.notify('WHO IS BORROWING IT?', type='warning')
            return
        db.lend(book_id, borrower.value, lend_date.value or None)
        done(f"{book['Title'].upper()} LENT TO {borrower.value.upper()}.")

    with ui.dialog() as dialog, ui.card().classes('term-card w-full max-w-5xl'):
        ui.label(f'> RECORD #{book_id:04d}  //  {KIND_NAMES[kind]}').classes('term-sub')
        ui.element('div').classes('term-rule')
        form = BookForm(kind, book)
        ui.element('div').classes('term-rule')
        if kind == 'owned':
            if book.get('LoanedTo'):
                with ui.row().classes('items-center gap-4'):
                    ui.label(f"LENT TO {book['LoanedTo'].upper()} SINCE {book['LoanedDate'] or '?'}").classes('term-warn')
                    button('RETURNED', lambda: (db.return_book(book_id), done(f"{book['Title'].upper()} IS BACK ON THE SHELF.")))
            else:
                with ui.row().classes('items-end gap-4 w-full'):
                    borrower = ui.select(db.borrowers(), label='LEND TO', with_input=True,
                                         new_value_mode='add-unique').classes('min-w-[220px]')
                    lend_date = ui.input('DATE', value=date.today().isoformat()).props('type=date stack-label')
                    button('LEND', lend)
        with ui.row().classes('gap-2 flex-wrap'):
            button('SAVE', save)
            if kind == 'wished':
                button('BOUGHT IT', lambda: (db.move_to_library(book_id),
                                             done(f"{book['Title'].upper()} MOVED TO THE LIBRARY.")))
            delete_btn = button('DELETE', delete, danger=True)
            button('CANCEL', dialog.close)
    dialog.on('hide', dialog.delete)
    dialog.open()


# ---------- pages ----------

def insert_page(kind: str = 'owned') -> None:
    frame('INSERT BOOK')
    form = BookForm(kind if kind in db.TABLES else 'owned', allow_kind_switch=True)
    form.isbn.props('autofocus')

    def save() -> None:
        data = form.values()
        if data:
            db.save_book(form.kind, data)
            ui.notify(f"{data['Title'].upper()} ADDED TO THE {KIND_NAMES[form.kind]}.")
            form.clear()

    with ui.row().classes('gap-2 mt-2'):
        button('SAVE', save)
        button('CLEAR', form.clear)


def book_grid(kind: str, columns: list[dict]) -> None:
    """Search box plus a grid with a filter under every column header; double-click a row to edit."""
    def rows() -> list[dict]:
        books = db.list_books(kind)
        for b in books:
            for col in ('Read', 'Signed', 'EdgeOut'):
                b[col + 'Text'] = 'YES' if b.get(col) else 'NO'
        return books

    def refresh() -> None:
        grid.options['rowData'] = rows()
        grid.update()
        count.set_text(f"{len(grid.options['rowData'])} RECORDS")

    # put the columns in the order last dragged into on this page; new or unknown columns go last
    saved = backup.load_settings().get('column_order', {}).get(kind, [])
    columns = sorted(columns, key=lambda c: saved.index(c['field']) if c['field'] in saved else len(saved))

    async def save_order(e) -> None:
        if not e.args.get('finished'):  # still dragging
            return
        state = await grid.run_grid_method('getColumnState')
        current = backup.load_settings()
        current.setdefault('column_order', {})[kind] = [c['colId'] for c in state]
        backup.save_settings(current)

    with ui.row().classes('w-full items-end gap-4'):
        search = ui.input('SEARCH ALL COLUMNS').classes('grow')
        count = ui.label('').classes('term-dim')
        if kind == 'wished':
            button('ADD TO WISHLIST', lambda: ui.navigate.to('/insert?kind=wished'))
    ui.label('TYPE IN THE BOXES UNDER THE HEADINGS TO FILTER A COLUMN  //  DOUBLE-CLICK A ROW TO OPEN IT').classes('term-faint')
    grid = ui.aggrid({
        'defaultColDef': {'filter': 'agTextColumnFilter', 'floatingFilter': True, 'sortable': True,
                          'resizable': True, 'minWidth': 90, 'suppressHeaderMenuButton': True},
        'columnDefs': columns,
        'rowData': [],
        'autoSizeStrategy': {'type': 'fitCellContents'},
        'animateRows': False,
        'enableCellTextSelection': True,
        'ensureDomOrder': True,
    }, auto_size_columns=False).classes('w-full').style('height: calc(100vh - 290px); min-height: 320px')
    search.on_value_change(lambda e: grid.run_grid_method('setGridOption', 'quickFilterText', e.value or ''))
    grid.on('rowDoubleClicked', lambda e: open_editor(kind, e.args['data']['BookID'], refresh), ['data'])
    grid.on('columnMoved', save_order, ['finished'])
    refresh()


NUM = {'filter': 'agNumberColumnFilter'}
STARS = {':valueFormatter': 'p => p.value == null ? "" : "*".repeat(p.value)', **NUM}


def books_page() -> None:
    frame('BOOKS')
    book_grid('owned', [
        {'headerName': 'Title', 'field': 'Title', 'pinned': 'left', 'minWidth': 200},
        {'headerName': 'Authors', 'field': 'Authors'},
        {'headerName': 'Series', 'field': 'SeriesTitle'},
        {'headerName': '#', 'field': 'NumberInSeries', **NUM},
        {'headerName': 'Genres', 'field': 'Genres'},
        {'headerName': 'Format', 'field': 'FormatName'},
        {'headerName': 'Pages', 'field': 'PageCount', **NUM},
        {'headerName': 'Rating', 'field': 'Rating', **STARS},
        {'headerName': 'Read', 'field': 'ReadText'},
        {'headerName': 'Started', 'field': 'StartedDate'},
        {'headerName': 'Finished', 'field': 'FinishedDate'},
        {'headerName': 'Shelf', 'field': 'ShelfNumber', **NUM},
        {'headerName': 'Signed', 'field': 'SignedText'},
        {'headerName': 'Sprayed', 'field': 'EdgeOutText'},
        {'headerName': 'Lent to', 'field': 'LoanedTo'},
        {'headerName': 'Edition', 'field': 'Edition'},
        {'headerName': 'ISBN', 'field': 'ISBN'},
        {'headerName': 'Comments', 'field': 'Comments', 'maxWidth': 320},
    ])


def wishlist_page() -> None:
    frame('WISHLIST')
    book_grid('wished', [
        {'headerName': 'Title', 'field': 'Title', 'pinned': 'left', 'minWidth': 200},
        {'headerName': 'Authors', 'field': 'Authors'},
        {'headerName': 'Series', 'field': 'SeriesTitle'},
        {'headerName': '#', 'field': 'NumberInSeries', **NUM},
        {'headerName': 'Genres', 'field': 'Genres'},
        {'headerName': 'Format', 'field': 'FormatName'},
        {'headerName': 'Edition', 'field': 'Edition'},
        {'headerName': 'Signed', 'field': 'SignedText'},
        {'headerName': 'ISBN', 'field': 'ISBN'},
    ])


def index_page(active: str, table: str, singular: str) -> None:
    """Add, rename, merge and delete the entries of one index (authors, genres, ...)."""
    frame(active)
    selected: dict = {}

    def refresh() -> None:
        grid.options['rowData'] = db.list_index(table)
        grid.update()
        count.set_text(f"{len(grid.options['rowData'])} ENTRIES")

    def add() -> None:
        name = (new.value or '').strip()
        if not name:
            return
        try:
            db.add_index(table, name)
        except ValueError as e:
            ui.notify(str(e).upper(), type='warning')
            return
        new.value = ''
        ui.notify(f'{name.upper()} ADDED.')
        refresh()

    def rename(e) -> None:
        old, name = e.args['oldValue'], (e.args['newValue'] or '').strip()
        if not name or name == old:
            refresh()
            return
        result = db.rename_index(table, e.args['data']['ID'], name)
        ui.notify(f'{old.upper()} MERGED INTO {name.upper()}.' if result == 'merged' else f'RENAMED TO {name.upper()}.')
        detail.clear()
        refresh()

    def show(row: dict) -> None:
        selected.clear()
        selected.update(row)
        books = db.books_using(table, row['ID'])
        detail.clear()
        with detail:
            ui.label(f"> {row['Name'].upper()}").classes('term-sub')
            ui.label(f'USED BY {len(books)} BOOK(S)').classes('term-dim')
            for kind, title in books:
                ui.label(f"  {title}" + ('  (WISHLIST)' if kind == 'wished' else ''))
            note = 'THE BOOKS ARE KEPT; THEY JUST LOSE THIS ENTRY.' if books else 'NO BOOKS USE IT.'
            ui.label(note).classes('term-faint mt-2')
            delete_btn = button('DELETE', lambda: delete(delete_btn), danger=True)

    def delete(btn) -> None:
        if btn.text != '[ CONFIRM DELETE ]':
            btn.set_text('[ CONFIRM DELETE ]')
            return
        db.delete_index(table, selected['ID'])
        ui.notify(f"{selected['Name'].upper()} DELETED.")
        detail.clear()
        refresh()

    with ui.row().classes('w-full items-end gap-4'):
        if table != 'Edition':  # editions only exist as text on the books
            new = ui.input(f'NEW {singular}').classes('min-w-[320px]')
            new.on('keydown.enter', add)
            button('ADD', add)
        search = ui.input('SEARCH').classes('min-w-[220px]')
        count = ui.label('').classes('term-dim')
    hint = 'CLICK A ROW TO SEE ITS BOOKS  //  DOUBLE-CLICK A NAME TO RENAME IT'
    if table != 'Edition':
        hint += '  //  RENAMING TO A NAME THAT EXISTS MERGES THE TWO'
    ui.label(hint).classes('term-faint')
    with ui.row().classes('w-full gap-8 no-wrap items-start'):
        grid = ui.aggrid({
            'defaultColDef': {'sortable': True, 'resizable': True, 'suppressHeaderMenuButton': True},
            'columnDefs': [
                {'headerName': singular, 'field': 'Name', 'editable': True, 'flex': 3,
                 'filter': 'agTextColumnFilter', 'floatingFilter': True},
                {'headerName': 'Books', 'field': 'Owned', 'flex': 1, 'filter': 'agNumberColumnFilter'},
                {'headerName': 'Wishlist', 'field': 'Wished', 'flex': 1, 'filter': 'agNumberColumnFilter'},
            ],
            'rowData': [],
            'rowSelection': {'mode': 'singleRow', 'checkboxes': False, 'enableClickSelection': True},
            'stopEditingWhenCellsLoseFocus': True,
            'enableCellTextSelection': True,
            'ensureDomOrder': True,
        }).style('height: calc(100vh - 290px); min-height: 320px; max-width: 720px').classes('grow')
        detail = ui.column().classes('gap-1 min-w-[300px]')
    search.on_value_change(lambda e: grid.run_grid_method('setGridOption', 'quickFilterText', e.value or ''))
    grid.on('rowClicked', lambda e: show(e.args['data']), ['data'])
    grid.on('cellValueChanged', rename, ['data', 'oldValue', 'newValue'])
    refresh()


def authors_page() -> None:
    index_page('AUTHORS', 'Authors', 'AUTHOR')


def genres_page() -> None:
    index_page('GENRES', 'Genres', 'GENRE')


def series_page() -> None:
    index_page('SERIES', 'Series', 'SERIES')


def formats_page() -> None:
    index_page('FORMATS', 'Formats', 'FORMAT')


def editions_page() -> None:
    index_page('EDITIONS', 'Edition', 'EDITION')


def loans_page() -> None:
    frame('RENTED OUT')
    listing = ui.column().classes('w-full gap-0')
    ui.label('> LEND A BOOK').classes('term-sub')
    with ui.row().classes('items-end gap-4 w-full'):
        book = ui.select({}, label='BOOK', with_input=True).classes('min-w-[340px] grow')
        borrower = ui.select(db.borrowers(), label='LEND TO', with_input=True, new_value_mode='add-unique').classes('min-w-[220px]')
        when = ui.input('DATE', value=date.today().isoformat()).props('type=date stack-label')

        def lend() -> None:
            if not book.value or not borrower.value:
                ui.notify('CHOOSE A BOOK AND WHO IS BORROWING IT.', type='warning')
                return
            db.lend(book.value, borrower.value, when.value or None)
            ui.notify(f'LENT TO {borrower.value.upper()}.')
            book.value = None
            render()
        button('LEND', lend)

    def returned(book_id: int, title: str) -> None:
        db.return_book(book_id)
        ui.notify(f'{title.upper()} IS BACK ON THE SHELF.')
        render()

    def render() -> None:
        books = db.list_books('owned')
        out = sorted((b for b in books if b['LoanedTo']), key=lambda b: b['LoanedDate'] or '')
        book.set_options({b['BookID']: f"{b['Title']}  -  {b['Authors'] or '?'}" for b in books if not b['LoanedTo']})
        borrower.set_options(db.borrowers())
        listing.clear()
        with listing:
            if not out:
                ui.label('NO BOOKS ARE OUT. ALL VOLUMES ACCOUNTED FOR.').classes('term-dim')
                return
            ui.label(f'{len(out)} VOLUMES OUT ON LOAN').classes('term-dim mb-2')
            with ui.element('div').classes('loan-grid'):
                for head in ('TITLE', 'AUTHOR', 'BORROWER', 'SINCE', 'DAYS', ''):
                    ui.label(head).classes('head')
                for b in out:
                    days = (date.today() - date.fromisoformat(b['LoanedDate'])).days if b['LoanedDate'] else None
                    late = days is not None and days >= 60  # no due date in the database; flag long loans
                    ui.label(b['Title'])
                    ui.label(b['Authors'] or '')
                    ui.label(b['LoanedTo'])
                    ui.label(b['LoanedDate'] or '?')
                    ui.label('?' if days is None else f"{days}{' !' if late else ''}").classes('term-warn' if late else '')
                    button('RETURNED', lambda b=b: returned(b['BookID'], b['Title']))
    render()


def bar(value: float, top: float, width: int = 24) -> str:
    filled = round(value / top * width) if top else 0
    return '█' * filled + '·' * (width - filled)


def stats_text(year: int, goal: int) -> str:
    s = db.stats(year)
    fmt = lambda n: f'{n:,}'.replace(',', '.')  # noqa: E731  Danish thousands separator
    dots = lambda label, value: f"  {label} {'.' * (24 - len(label))} {value}"  # noqa: E731
    lines = [f'> QUERY READING_LOG --YEAR={year}', '']
    pct = min(100, round(s['books'] / goal * 100)) if goal else 0
    lines.append(dots('BOOKS READ', f"{s['books']:<5} GOAL {goal}  [{bar(s['books'], goal or 1, 20) if goal else ''}] {pct}%"))
    lines.append(dots('PAGES READ', fmt(s['pages'])))
    lines.append(dots('AVG PAGES PER BOOK', fmt(round(s['avg_pages'])) if s['avg_pages'] else '-'))
    lines.append(dots('AVG RATING', f"{s['avg_rating']:.1f} / 5" if s['avg_rating'] is not None else '-'))
    lines.append(dots('CURRENTLY READING', s['reading']))
    lines += ['', '  MONTH  BOOKS READ                       PAGES']
    top = max((m[1] for m in s['months']), default=0)
    for month, books, pages in s['months']:
        name = date(year, month, 1).strftime('%b').upper()
        lines.append(f'  {name}    {bar(books, top)} {books:>3}   {fmt(pages):>7}')
    if s['genres']:
        lines += ['', f'  GENRES READ IN {year}']
        gtop = s['genres'][0][1]
        lines += [f"  {g[:20].upper():<20} {bar(n, gtop, 16)} {n:>3}" for g, n in s['genres']]
    if s['authors']:
        lines += ['', f'  MOST READ AUTHORS IN {year}']
        lines += [dots(a[:24].upper(), n) for a, n in s['authors']]
    owned_books, owned_pages = s['owned']
    lines += ['', '  LIBRARY ARCHIVE',
              dots('VOLUMES OWNED', f'{fmt(owned_books)}  ({fmt(owned_pages)} PAGES)'),
              dots('NOT YET READ', s['unread']),
              dots('LENT OUT', s['lent']),
              dots('SIGNED', s['signed']),
              dots('SPRAYED EDGES', s['sprayed']),
              dots('ON THE WISHLIST', s['wished'])]
    if s['formats']:
        lines.append(dots('FORMATS', '  '.join(f'{f.upper()} {n}' for f, n in s['formats'])))
    return '\n'.join(lines)


def stats_page() -> None:
    frame('STATISTICS')
    goal = int(backup.load_settings().get('reading_goal') or 0)
    years = db.stat_years()
    year = ui.select(years, label='YEAR', value=years[0]).classes('w-32')
    output = ui.label(stats_text(years[0], goal)).classes('term-pre mt-2')
    year.on_value_change(lambda e: output.set_text(stats_text(e.value, goal)))


def settings_page() -> None:
    frame('SETTINGS')
    settings = backup.load_settings()
    dropbox = backup.find_dropbox()

    ui.label('> BACKUP SETTINGS').classes('term-sub')
    ui.element('div').classes('term-rule max-w-4xl')
    ui.label(f"DROPBOX FOLDER DETECTED: {dropbox or 'NOT FOUND - IS THE DROPBOX APP INSTALLED?'}").classes(
        'term-dim' if dropbox else 'term-warn')
    with ui.row().classes('w-full max-w-4xl items-end gap-4 no-wrap'):
        folder = ui.input('BACKUP FOLDER (inside Dropbox, so Dropbox uploads it)', value=settings['backup_dir']).classes('grow')
        button('SELECT FOLDER FOR BACKUP', lambda: choose_folder(folder))
    keep = ui.number('DATED COPIES TO KEEP', value=settings['keep'], min=1, precision=0).classes('w-56')
    on_exit = ui.checkbox('BACK UP AUTOMATICALLY WHEN THE APP CLOSES', value=settings['backup_on_exit'])
    status = ui.label('').classes('term-dim')
    listing = ui.label('').classes('term-pre term-dim')

    def show_backups() -> None:
        current = backup.load_settings()
        files = backup.list_backups(current['backup_dir'])
        last = current.get('last_backup')
        text = f"LAST BACKUP: {last.replace('T', ' ') if last else 'NEVER'}\n"
        text += '\n'.join(f'  {f.name}   {f.stat().st_size // 1024} KB' for f in files[:8]) or '  NO BACKUPS IN THIS FOLDER YET'
        listing.set_text(text)

    def save_backup_settings() -> None:
        current = backup.load_settings()
        current.update({'backup_dir': (folder.value or '').strip(), 'keep': int(keep.value or 1),
                        'backup_on_exit': bool(on_exit.value)})
        backup.save_settings(current)
        status.classes(remove='term-error')
        status.set_text('BACKUP SETTINGS SAVED.')
        show_backups()

    async def backup_click() -> None:
        save_backup_settings()
        status.set_text('WRITING BACKUP ...')
        try:
            dest = await run.io_bound(backup.backup_now)
        except (OSError, ValueError) as e:
            status.set_text(f'BACKUP FAILED: {e}'.upper())
            status.classes('term-error')
            return
        status.classes(remove='term-error')
        status.set_text(f'BACKUP WRITTEN: {dest}  //  DROPBOX WILL UPLOAD IT.')
        show_backups()

    with ui.row().classes('gap-2'):
        button('SAVE BACKUP SETTINGS', save_backup_settings)
        button('BACK UP NOW', backup_click)
    show_backups()

    ui.label('> LIBRARY SETTINGS').classes('term-sub mt-6')
    ui.element('div').classes('term-rule max-w-4xl')
    title = ui.input('TITLE AT THE TOP', value=settings['title']).classes('w-full max-w-4xl')
    goal = ui.number('YEARLY READING GOAL (BOOKS)', value=settings['reading_goal'], min=0, precision=0).classes('w-64')
    isbndb_key = ui.input('ISBNDB API KEY (FROM ISBNDB.COM; EMPTY = ONLY THE FREE SOURCES)',
                          value=settings['isbndb_key'], password=True, password_toggle_button=True).classes('w-full max-w-4xl')
    google_key = ui.input('GOOGLE BOOKS API KEY (FREE, SEE README; EMPTY = SHARED QUOTA THAT IS OFTEN USED UP)',
                          value=settings['google_books_key'], password=True, password_toggle_button=True).classes('w-full max-w-4xl')
    ui.label(f'DATABASE FILE: {db.DB_PATH}').classes('term-faint')
    library_status = ui.label('').classes('term-dim')

    def save_library_settings() -> None:
        current = backup.load_settings()
        current['title'] = (title.value or '').strip() or backup.DEFAULT_TITLE
        current['reading_goal'] = int(goal.value or 0)
        current['isbndb_key'] = (isbndb_key.value or '').strip()
        current['google_books_key'] = (google_key.value or '').strip()
        backup.save_settings(current)
        title.value = current['title']
        library_status.set_text('LIBRARY SETTINGS SAVED. THE NEW TITLE SHOWS ON THE NEXT PAGE YOU OPEN.')

    button('SAVE LIBRARY SETTINGS', save_library_settings)

    ui.label('> COLOURS').classes('term-sub mt-6')
    ui.element('div').classes('term-rule max-w-4xl')
    text_now, bg_now = theme_colors(settings)

    def use_colors(text: str, bg: str) -> None:
        current = backup.load_settings()
        current['text_color'], current['bg_color'] = text, bg
        backup.save_settings(current)
        ui.navigate.reload()

    ui.label('READY-MADE SCHEMES (CLICK ONE TO USE IT):').classes('term-dim')
    with ui.row().classes('gap-4'):
        for name, (text, bg) in backup.THEMES.items():
            label = name + (' (STANDARD)' if name == backup.DEFAULT_THEME else '')
            if (text, bg) == (text_now, bg_now):
                label = '> ' + label + ' <'
            ui.button(label, on_click=lambda t=text, b=bg: use_colors(t, b)).props('flat no-caps').classes(
                'term-swatch').style(f'background: {bg} !important; color: {text} !important; border-color: {text};'
                                     f' text-shadow: 0 0 6px {text}')
    ui.label('OR CHOOSE YOUR OWN:').classes('term-dim mt-2')
    with ui.row().classes('gap-6'):
        text_in = ui.color_input('TEXT COLOUR', value=text_now).classes('w-56')
        bg_in = ui.color_input('BACKGROUND COLOUR', value=bg_now).classes('w-56')
    colors_status = ui.label('').classes('term-dim')

    def save_colors() -> None:
        text, bg = hex_color(text_in.value, ''), hex_color(bg_in.value, '')
        if not text or not bg:
            colors_status.classes(add='term-error')
            colors_status.set_text('USE COLOURS WRITTEN AS #RRGGBB, E.G. #1AFF80.')
            return
        use_colors(text, bg)

    button('SAVE COLOURS', save_colors)


async def choose_folder(target: ui.input) -> None:
    """Pick a folder: the system's folder dialog in the app window, a terminal-style browser otherwise."""
    start = Path(target.value).expanduser() if target.value else (backup.find_dropbox() or Path.home())
    while not start.is_dir() and start != start.parent:
        start = start.parent
    if app.native.main_window:
        import webview  # only available in the app window
        chosen = await app.native.main_window.create_file_dialog(webview.FileDialog.FOLDER, directory=str(start))
        if chosen:
            target.value = chosen[0] if isinstance(chosen, (list, tuple)) else chosen
        return

    with ui.dialog() as dialog, ui.card().classes('term-card w-full max-w-3xl'):
        ui.label('> SELECT FOLDER FOR BACKUP').classes('term-sub')
        here = ui.label('').classes('term-dim')
        entries = ui.column().classes('gap-0 w-full').style('max-height: 50vh; overflow-y: auto')
        current = {'path': start}

        def go(path: Path) -> None:
            current['path'] = path
            here.set_text(f'CURRENT: {path}')
            entries.clear()
            with entries:
                if path.parent != path:
                    ui.label('> ..  (UP ONE LEVEL)').classes('term-menu cursor-pointer').on('click', lambda: go(path.parent))
                try:
                    subdirs = sorted((p for p in path.iterdir() if p.is_dir() and not p.name.startswith('.')),
                                     key=lambda p: p.name.lower())
                except OSError:
                    subdirs = []
                for sub in subdirs:
                    ui.label(f'> {sub.name}/').classes('term-menu cursor-pointer').on('click', lambda sub=sub: go(sub))
                if not subdirs:
                    ui.label('  NO SUBFOLDERS').classes('term-faint')

        def pick() -> None:
            target.value = str(current['path'])
            dialog.close()

        with ui.row().classes('gap-2 mt-2'):
            button('SELECT THIS FOLDER', pick)
            button('CANCEL', dialog.close)
        go(start)
    dialog.on('hide', dialog.delete)
    dialog.open()


# ---------- one page for the whole app: switching menu items only swaps the content, no reload ----------

ROUTES = {
    '/insert': insert_page,
    '/': books_page,
    '/wishlist': wishlist_page,
    '/authors': authors_page,
    '/genres': genres_page,
    '/series': series_page,
    '/formats': formats_page,
    '/editions': editions_page,
    '/loans': loans_page,
    '/stats': stats_page,
    '/settings': settings_page,
}


@ui.page('/')
@ui.page('/{_:path}')
def main_page() -> None:
    shell()
    ui.sub_pages(ROUTES).classes('w-full')


def backup_on_exit() -> None:
    settings = backup.load_settings()
    if settings.get('backup_on_exit') and settings.get('backup_dir'):
        try:
            print(f'Backed up to {backup.backup_now()}')
        except (OSError, ValueError) as e:
            print(f'Backup on exit failed: {e}')


app.on_shutdown(backup_on_exit)
