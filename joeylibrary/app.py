"""The library user interface: one NiceGUI page per menu item."""
import html
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path

from nicegui import app, run, ui

from . import backup, db, isbn as isbn_lookup, roomdb, sim  # sim: the 3D room's files and routes, before the catch-all page

HERE = Path(__file__).resolve().parent
app.add_static_files('/static', HERE / 'static')
ui.add_css(HERE / 'static' / 'terminal.css', shared=True)

# (label, path) entries; a plain string starts a new section of the menu
MENU = [
    ('INSERT BOOK', '/insert'),
    ('BOOKS', '/'),
    ('ON LOAN', '/loans'),
    ('WISHLIST', '/wishlist'),
    ('STATISTICS', '/stats'),
    'INDEXES',
    ('READING HISTORY', '/reading-history'),
    ('AUTHORS', '/authors'),
    ('GENRES', '/genres'),
    ('TAGS', '/tags'),
    ('SERIES', '/series'),
    ('FORMATS', '/formats'),
    ('EDITIONS', '/editions'),
    'SYSTEM',
    ('SETTINGS', '/settings'),
    'BOOKSHELF SIMULATION',
    ('BOOKSHELF SIMULATION', '/bookshelf'),
    ('BOOK WORKSHOP', '/bookshelf/workshop'),
    ('BOOKCASES', '/bookshelf/cases'),
    ('ZONES', '/bookshelf/zones'),
    ('BOOK TYPES', '/bookshelf/types'),
]
# the views of the 3D room (sim/index.html) behind the BOOKSHELF SIMULATION menu items: path -> (label, view)
SIM_VIEWS = {'/bookshelf': ('BOOKSHELF SIMULATION', 'vRoom'), '/bookshelf/workshop': ('BOOK WORKSHOP', 'vShop'),
             '/bookshelf/cases': ('BOOKCASES', 'vCases'), '/bookshelf/zones': ('ZONES', 'vZones'),
             '/bookshelf/types': ('BOOK TYPES', 'vTypes')}
MOBILE_WIDTH = 768  # narrower than this is laid out for phones (see terminal.css)
PHONE_TITLE_WIDTH = 140  # starting width of the Title column on a phone; dragging its edge changes it
KIND_NAMES = {'owned': 'LIBRARY', 'wished': 'WISHLIST'}
RATINGS = {None: '-', 0: '0', 1: '* (1)', 2: '** (2)', 3: '*** (3)', 4: '**** (4)', 5: '***** (5)'}
CHILI = '\U0001F336'
SPICE = {None: '-', 0: '0  (NOT SPICY)', **{n: f'{CHILI * n}  ({n})' for n in range(1, 6)}}
CHAINS = '\u26D3'
KINK = {None: '-', 0: '0  (NOT KINKY)', **{n: f'{CHAINS * n}  ({n})' for n in range(1, 6)}}


def button(text: str, on_click=None, danger: bool = False) -> ui.button:
    b = ui.button(f'[ {text} ]', on_click=on_click).props('flat no-caps').classes('term-btn')
    if danger:
        b.classes('danger')
    return b


MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
          'November', 'December']


class DateInput(ui.input):
    """A date typed as dd/mm/yyyy, or picked from the calendar behind the icon.

    The browser's own date field is drawn by the system and edits the day, month and year as whole blocks, so one
    Backspace in the year wiped all of it. This is a plain text field with a mask: digits only, the slashes put in by
    themselves, and Backspace takes away the last digit typed. The calendar is drawn here, the same on every system.
    The date itself is `iso` ('YYYY-MM-DD', or '' when the field is empty or not a whole date yet).
    """

    def __init__(self, label: str, value: str | None = '') -> None:
        super().__init__(label, value=self.text_of(value or ''),
                         validation={'NOT A DATE (DD/MM/YYYY)': lambda v: not v or self.iso_of(v) is not None})
        self.props('stack-label mask="##/##/####" placeholder="dd/mm/yyyy" inputmode=numeric').classes('term-date')
        self.month = date.today().replace(day=1)  # the month the calendar shows
        self.picking_month = False
        with self.add_slot('append'):
            icon = ui.icon('calendar_month').classes('cursor-pointer term-date-icon')
            with icon, ui.menu().props('anchor="bottom right" self="top right"').classes('term-cal-menu') as self.menu:
                self.panel = ui.element('div').classes('term-cal')
        self.menu.on('before-show', self.opened)

    @staticmethod
    def text_of(iso: str) -> str:
        try:
            return datetime.strptime(iso, '%Y-%m-%d').strftime('%d/%m/%Y')
        except ValueError:
            return iso

    @staticmethod
    def iso_of(text: str) -> str | None:
        try:
            return datetime.strptime(text, '%d/%m/%Y').date().isoformat() if len(text or '') == 10 else None
        except ValueError:
            return None

    @property
    def iso(self) -> str:
        return self.iso_of(self.value) or ''

    @staticmethod
    def check(*fields: 'DateInput') -> bool:
        """True when every field is empty or a whole, real date; otherwise say so (rather than save no date)."""
        bad = [f for f in fields if f.value and not f.iso]
        if bad:
            ui.notify(f'{bad[0].props["label"]}: {bad[0].value} IS NOT A DATE. WRITE IT AS DD/MM/YYYY.', type='warning')
            bad[0].run_method('focus')
        return not bad

    @iso.setter
    def iso(self, value: str | None) -> None:
        self.value = self.text_of(value or '')

    def opened(self) -> None:
        chosen = self.iso
        self.month = (date.fromisoformat(chosen) if chosen else date.today()).replace(day=1)
        self.picking_month = False
        self.draw()

    def step(self, months: int) -> None:
        m = self.month.year * 12 + self.month.month - 1 + months
        self.month = date(m // 12, m % 12 + 1, 1)
        self.draw()

    def pick(self, day: date | None) -> None:
        self.iso = day.isoformat() if day else ''
        self.menu.close()

    def choose_month(self, month: int) -> None:
        self.month = self.month.replace(month=month)
        self.picking_month = False
        self.draw()

    def draw(self) -> None:
        """The calendar as in the browsers: month and year with ▾ (click it to pick a month), ↑ ↓ for the month
        before and after, weeks from Monday with the days of the months around it dimmed, today boxed."""
        self.panel.clear()
        chosen, today = self.iso, date.today().isoformat()
        with self.panel:
            with ui.row().classes('term-cal-head no-wrap items-center'):
                ui.label(f'{MONTHS[self.month.month - 1]} {self.month.year} {"▴" if self.picking_month else "▾"}') \
                    .classes('term-cal-title').on('click', lambda: (setattr(self, 'picking_month', not self.picking_month), self.draw()))
                ui.space()
                step = 12 if self.picking_month else 1
                ui.button(icon='arrow_upward', on_click=lambda: self.step(-step)).props('flat dense round').classes('term-cal-arrow') \
                    .tooltip('The year before' if self.picking_month else 'The month before')
                ui.button(icon='arrow_downward', on_click=lambda: self.step(step)).props('flat dense round').classes('term-cal-arrow') \
                    .tooltip('The year after' if self.picking_month else 'The month after')
            if self.picking_month:
                with ui.element('div').classes('term-cal-months'):
                    for n, name in enumerate(MONTHS, 1):
                        ui.label(name[:3]).classes('term-cal-cell' + (' on' if n == self.month.month else '')) \
                            .on('click', lambda n=n: self.choose_month(n))
            else:
                with ui.element('div').classes('term-cal-days'):
                    for name in ('Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'):
                        ui.label(name).classes('term-cal-wd')
                    first = self.month - timedelta(days=self.month.weekday())
                    for i in range(42):
                        day = first + timedelta(days=i)
                        cls = 'term-cal-cell' + ('' if day.month == self.month.month else ' out') + \
                            (' today' if day.isoformat() == today else '') + (' on' if day.isoformat() == chosen else '')
                        ui.label(str(day.day)).classes(cls).on('click', lambda day=day: self.pick(day))
            with ui.row().classes('term-cal-foot no-wrap'):
                ui.label('Clear').classes('term-cal-link').on('click', lambda: self.pick(None))
                ui.space()
                ui.label('Today').classes('term-cal-link').on('click', lambda: self.pick(date.today()))


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


# menu sections whose items can be dragged into another order -> the setting the order is saved in
SORTABLE = {'INDEXES': 'index_order', 'BOOKSHELF SIMULATION': 'sim_order'}


def menu_sections(settings: dict) -> list[tuple[str | None, list[tuple[str, str]]]]:
    """MENU as (section, entries); the SORTABLE sections come in the order they were dragged into."""
    sections = [(None, [])]
    for entry in MENU:
        if isinstance(entry, str):
            sections.append((entry, []))
        else:
            sections[-1][1].append(entry)
    for name, entries in sections:
        if name in SORTABLE:  # ones not in the saved order (new in a later version) go last
            saved = settings.get(SORTABLE[name], [])
            entries.sort(key=lambda e: saved.index(e[0]) if e[0] in saved else len(saved))
    return sections


def shell() -> None:
    """Header and left menu, built once per window; the pages below only swap the content under them."""
    settings = backup.load_settings()
    apply_theme(settings)
    ui.dark_mode(True)
    with ui.header().classes('term-header items-center no-wrap gap-3'):
        burger = ui.button(icon='menu').props('flat dense').classes('term-burger')  # only shown on phones
        with ui.column().classes('gap-0'):
            banner = ui.label().classes('term-banner')
            status = ui.label().classes('term-status')
    links = {}
    # docked on wide screens; below 768 px it hides and slides in over the page from the burger button
    with ui.left_drawer(value=None, fixed=True).props(f'width=250 breakpoint={MOBILE_WIDTH - 1}').classes('term-drawer') as drawer:
        for name, entries in menu_sections(settings):
            if name:
                ui.label(f'-- {name} --').classes('term-menu-section')
            with ui.element('div') as group:
                for label, path in entries:
                    links[label] = ui.link(f'> {label}', path).classes('term-menu').props(
                        f'draggable=false data-label="{label}"')
                    links[label].on('click', drawer.hide,
                                    js_handler=f'() => {{ if (window.innerWidth < {MOBILE_WIDTH}) emit() }}')
            if name in SORTABLE:  # dragged into another order by the script below
                group.classes('term-sortable').props('title="Drag to change the order"')
                group.on('reorder', lambda e, group=group, key=SORTABLE[name]: save_order(key, e.args['detail'], group),
                         ['detail'])
        ui.label(f'{date.today():%Y-%m-%d}  //  TERMINAL READY').classes('term-hint')
    burger.on_click(drawer.toggle)

    def sim_view(e) -> None:  # the 3D room changed view by itself, or a menu item switched it (see below)
        label = SIM_VIEWS[e.args['path']][0]
        set_active(label)
        ui.page_title(f'JOEY LIBRARY - {label}')
        if ui.context.client.shell.get('title'):
            ui.context.client.shell['title'].set_text(f'> {label}')
        if e.args.get('narrow'):
            drawer.hide()
    ui.on('sim_view', sim_view)

    def save_order(key: str, order: list[str], group: ui.element) -> None:
        current = backup.load_settings()
        current[key] = order
        backup.save_settings(current)
        for i, label in enumerate(order):  # the browser has moved them already; keep the server's copy the same
            links[label].move(group, target_index=i)

    ui.add_body_html('''<script>
    // author columns sort by last name: "Ursula K. Le Guin" under L, "J.R.R. Tolkien" under T; when a book has
    // several authors the first one counts
    const termSurnameKey = (names) => {
      const words = (names || '').split(',')[0].trim().split(/\\s+/).filter(w => !/^(jr|sr|ii|iii|iv)\\.?$/i.test(w));
      // the last name starts here, taking in a "de", "Le", "St." ... before it; "van" and "von" names go under
      // the name after them, as in libraries
      let i = words.length - 1;
      while (i > 1 && /^(de|del|della|di|da|du|la|le|st\\.?|saint)$/i.test(words[i - 1])) i--;
      return (words.slice(i).join(' ') + ', ' + words.slice(0, i).join(' ')).toLowerCase();
    };
    window.termAuthorCompare = (a, b) =>
      termSurnameKey(a).localeCompare(termSurnameKey(b)) || (a || '').localeCompare(b || '');
    // tables reach down to the bottom of the window, however tall the text above them came out (fonts differ
    // between systems, and hint lines wrap on narrow windows); checked on resize and a few times a second
    const termFit = () => document.querySelectorAll('.term-fit').forEach(el => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const height = Math.max(parseFloat(getComputedStyle(el).minHeight) || 0, window.innerHeight - top - 20);
      if (Math.abs(el.offsetHeight - height) > 1) el.style.height = height + 'px';
    });
    window.addEventListener('resize', termFit);
    setInterval(termFit, 300);
    // name fields (.term-names, the authors): Enter or Tab takes the suggestion highlighted with the arrow keys, or
    // the one spelled the same, or else adds what was typed as a new name; Tab then goes on to the next field
    document.addEventListener('keydown', e => {
      if ((e.key !== 'Enter' && e.key !== 'Tab') || e.shiftKey || e.isComposing) return;
      const vm = e.target.closest && e.target.closest('.term-names') && e.target.id && getElement(e.target), q = vm && vm.$refs.qRef;  // the id is on the input
      if (!q) return;
      const text = (e.target.value || '').trim(), low = text.toLowerCase(), label = o => String(o.label).toLowerCase();
      // the highlighted one counts only if it matches what is typed (the list may not have caught up yet)
      const open = document.documentElement.classList.contains('nicegui-select-popup-open'), i = open ? q.getOptionIndex() : -1;
      const lit = i > -1 && (vm.filteredOptions || [])[i];
      const pick = (lit && label(lit).includes(low) && lit) || (text && (vm.initialOptions || []).find(o => label(o) === low));
      if (!pick && !text) return;
      if (e.key === 'Enter') e.preventDefault();
      e.stopPropagation();
      if (pick) { if (!q.isOptionSelected(pick)) q.toggleOption(pick, true); }
      else q.add(text, true);
      q.updateInputValue('', true);
      q.hidePopup();
      setTimeout(() => q.hidePopup(), 200);  // a new name changes the options, which opens the list again
    }, true);
    // the INDEXES and BOOKSHELF SIMULATION items in the menu: drag one with the mouse (press and hold on a phone) to move it; the order is
    // then sent to the server, which saves it
    document.addEventListener('pointerdown', (down) => {
      const item = down.target.closest('.term-sortable > .term-menu');
      if (!item || down.button !== 0) return;
      const list = item.parentElement;
      let dragging = false, moved = false;
      const start = () => { dragging = true; item.classList.add('dragging'); };
      const hold = down.pointerType === 'mouse' ? null : setTimeout(start, 350);
      const move = (e) => {
        if (!dragging) {
          if (Math.abs(e.clientY - down.clientY) < 6) return;
          if (hold) return finish();  // a finger that moves straight away is scrolling the menu
          start();
        }
        e.preventDefault();
        for (const other of list.children) {
          const r = other.getBoundingClientRect();
          if (other === item || e.clientY < r.top || e.clientY > r.bottom) continue;
          list.insertBefore(item, e.clientY < r.top + r.height / 2 ? other : other.nextSibling);
          moved = true;
        }
      };
      const noScroll = (e) => { if (dragging) e.preventDefault(); };
      const finish = () => {
        clearTimeout(hold);
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', finish);
        document.removeEventListener('touchmove', noScroll);
        item.classList.remove('dragging');
        if (!moved) return;
        // the click that ends a drag must not open the page
        const swallow = (c) => { c.preventDefault(); c.stopImmediatePropagation(); };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
        list.dispatchEvent(new CustomEvent('reorder', {detail: [...list.children].map(c => c.dataset.label)}));
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
      document.addEventListener('touchmove', noScroll, {passive: false});
    });
    // the grid API of the book table a heading belongs to
    const termGridApi = (el) => {
      while (el && !/^c\\d+$/.test(el.id)) el = el.parentElement;  // the NiceGUI element around the grid
      return getElement(el.id.slice(1)).api;
    };
    // the x in a heading: hide that column
    window.termHideColumn = (el, field) => termGridApi(el).setColumnsVisible([field], false);
    // right-click (press and hold on a phone) on a heading: a small menu to freeze or unfreeze the column
    window.termColumnMenu = (event, el, field) => {
      event.preventDefault();
      document.querySelectorAll('.term-col-menu').forEach(m => m.remove());
      const api = termGridApi(el);
      if (api.getColumn(field).getColDef().lockPosition) return;  // Serial: always first and frozen
      const frozen = !!api.getColumn(field).getPinned();
      const menu = document.createElement('div');
      menu.className = 'term-col-menu';
      menu.style.left = Math.min(event.clientX, window.innerWidth - 220) + 'px';
      menu.style.top = event.clientY + 'px';
      const item = document.createElement('div');
      item.textContent = frozen ? '> UNFREEZE COLUMN' : '> FREEZE COLUMN';
      item.onclick = () => { termFreeze(api, field, !frozen); menu.remove(); };
      menu.appendChild(item);
      document.body.appendChild(menu);
      setTimeout(() => document.addEventListener('pointerdown', function close(e) {
        if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); }
      }), 0);
    };
    // freezing puts the column leftmost among the frozen ones (after Serial, which is always first);
    // unfreezing puts it right after them
    // the 3D room stays loaded while its menu items only switch its view; the room tells which view it shows
    const termSimViews = __SIM_VIEWS__;
    const termSimPath = (view) => Object.keys(termSimViews).find(p => termSimViews[p] === view);
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a.term-menu'), frame = document.getElementById('simFrame');
      const path = link && new URL(link.href).pathname;
      if (!frame || !termSimViews[path]) return;
      e.preventDefault(); e.stopImmediatePropagation();
      frame.contentWindow.postMessage({type: 'sim-show', view: termSimViews[path]}, location.origin);
    }, true);
    window.addEventListener('message', (e) => {
      const path = e.origin === location.origin && e.data && e.data.type === 'sim-view' && termSimPath(e.data.view);
      if (!path || !document.getElementById('simFrame')) return;
      if (location.pathname !== path) history.pushState(history.state, '', path);
      emitEvent('sim_view', {path, narrow: window.innerWidth < __MOBILE__});
    });
    window.termFreeze = (api, field, freeze) => {
      const state = api.getColumnState();
      const [column] = state.splice(state.findIndex(s => s.colId === field), 1);
      column.pinned = freeze ? 'left' : null;
      const locked = state.filter(s => api.getColumn(s.colId).getColDef().lockPosition).length;
      state.splice(freeze ? locked : state.filter(s => s.pinned).length, 0, column);
      api.applyColumnState({state, applyOrder: true});
    };
    </script>'''.replace('__SIM_VIEWS__', json.dumps({p: v for p, (_, v) in SIM_VIEWS.items()}))
                     .replace('__MOBILE__', str(MOBILE_WIDTH)))
    ui.context.client.shell = {'banner': banner, 'status': status, 'links': links}


def set_active(active: str) -> None:
    """Mark the menu item of the page being shown."""
    for label, link in ui.context.client.shell['links'].items():
        if label == active:
            link.classes(add='active')
        else:
            link.classes(remove='active')
        link.update()  # also when the server's copy did not change: the room may have marked another item


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
    set_active(active)
    shell_parts['title'] = ui.label(f'> {active}').classes('term-title')


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
            self.authors = ui.select(db.names('Authors'), label='AUTHOR(S)  - main author first, ENTER or TAB adds the name',
                                     multiple=True, with_input=True, new_value_mode='add-unique',
                                     value=b.get('AuthorList', [])).props('use-chips hide-dropdown-icon').classes('w-full term-names')
            # an author picked from the list closes it (Enter and Tab: see term-names in the page script)
            self.authors.on_value_change(lambda: (self.authors.run_method('updateInputValue', '', True),
                                                  self.authors.run_method('hidePopup')))
            self.genres = ui.select(db.names('Genres'), label='GENRES  - ENTER adds a new genre',
                                    multiple=True, with_input=True, new_value_mode='add-unique',
                                    value=b.get('GenreList', [])).props('use-chips hide-dropdown-icon').classes('w-full')
            self.tags = ui.select(db.names('Tags'), label='TAGS  - your own labels, ENTER adds a new tag',
                                  multiple=True, with_input=True, new_value_mode='add-unique',
                                  value=b.get('TagList', [])).props('use-chips hide-dropdown-icon').classes('w-full')
            with ui.element('div').classes('grid grid-cols-1 md:grid-cols-4 gap-x-6 w-full'):
                self.edition = ui.input('EDITION', value=b.get('Edition') or '')
                self.format = ui.select(db.names('Formats'), label='FORMAT', with_input=True, clearable=True,
                                        new_value_mode='add-unique', value=b.get('FormatName'))
                self.series = ui.select(db.names('Series'), label='SERIES', with_input=True, clearable=True,
                                        new_value_mode='add-unique', value=b.get('SeriesTitle'))
                self.number_in_series = ui.number('NO. IN SERIES', value=b.get('NumberInSeries'), min=0)
                self.spice = ui.select(SPICE, label='SPICE', value=b.get('Spice'))
                self.kink = ui.select(KINK, label='KINK', value=b.get('Kink'))
            self.signed = ui.checkbox('SIGNED', value=bool(b.get('Signed')))
            self.owned_box = ui.column().classes('w-full gap-1')
            with self.owned_box:
                with ui.element('div').classes('grid grid-cols-1 md:grid-cols-4 gap-x-6 w-full'):
                    self.pages = ui.number('PAGES', value=b.get('PageCount'), min=0, precision=0)
                    self.shelf = ui.number('SHELF NO.', value=b.get('ShelfNumber'), min=0, precision=0)
                    self.rating = ui.select(RATINGS, label='RATING', value=b.get('Rating'))
                # the reading history: earlier readings above, the current (newest) one in STARTED / FINISHED
                readings = b.get('Readings', [])
                current = readings[-1] if readings else {}
                self.history_box = ui.column().classes('w-full gap-0')
                with ui.row().classes('items-end gap-x-6 gap-y-1'):
                    self.started = DateInput('STARTED', current.get('StartedDate'))
                    self.finished = DateInput('FINISHED', current.get('FinishedDate'))
                    button('NEW READING', self.new_reading).tooltip(
                        'Reading it again: the dates above go into the reading history and a new reading starts today')
                with ui.row().classes('gap-6'):
                    self.read = ui.checkbox('READ', value=bool(b.get('Read')))
                    self.edge = ui.checkbox('SPRAYED EDGES', value=bool(b.get('EdgeOut')))
                self.comments = ui.textarea('COMMENTS', value=b.get('Comments') or '').props('autogrow').classes('w-full')
        self.show_earlier(readings[:-1])
        self.set_kind(kind)

    def show_earlier(self, readings: list[dict]) -> None:
        """List the earlier readings, each with its own dates and an X to delete it."""
        self.history_box.clear()
        self.earlier = []
        with self.history_box:
            if readings:
                ui.label(f'EARLIER READINGS ({len(readings)})').classes('term-dim mt-2')
            for r in readings:
                with ui.row().classes('items-end gap-x-6 gap-y-1'):
                    pair = (DateInput('STARTED', r.get('StartedDate')), DateInput('FINISHED', r.get('FinishedDate')))
                    button('X', lambda pair=pair: self.remove_earlier(pair), danger=True).tooltip('Delete this reading')
                self.earlier.append(pair)

    def earlier_values(self) -> list[dict]:
        return [{'StartedDate': s.iso or None, 'FinishedDate': f.iso or None} for s, f in self.earlier]

    def remove_earlier(self, pair: tuple) -> None:
        self.show_earlier([r for p, r in zip(self.earlier, self.earlier_values()) if p is not pair])

    def current_reading(self) -> dict:
        return {'StartedDate': self.started.iso or None, 'FinishedDate': self.finished.iso or None}

    def new_reading(self) -> None:
        """Reading the book again: the current dates join the history and a new reading starts today."""
        earlier = self.earlier_values()
        if any(self.current_reading().values()):
            earlier.append(self.current_reading())
        self.show_earlier(earlier)
        self.started.iso = date.today().isoformat()
        self.finished.iso = ''
        ui.notify('NEW READING STARTED. SAVE TO KEEP IT.')

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
        if found.get('Format'):
            self.format.set_options(sorted(set(self.format.options) | {found['Format']}, key=str.lower))
            self.format.value = found['Format']
        details = ', '.join(x for x in (found.get('Publisher'), found.get('Year')) if x)
        message = f"RECORD FOUND IN {found['Source'].upper()}" + (f'  //  {details}' if details else '')
        if found.get('Format') == isbn_lookup.AUDIOBOOK:
            if found.get('PrintISBN'):
                message += f"  //  AUDIOBOOK: PAGES FROM PRINTED EDITION {found['PrintISBN']} ({found['PrintSource'].upper()})"
            else:
                message += '  //  AUDIOBOOK: NO PRINTED EDITION FOUND, ENTER THE PAGES BY HAND'
                self.status.classes('term-warn')
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
        if self.kind == 'owned' and not DateInput.check(*(f for pair in self.earlier for f in pair), self.started, self.finished):
            return None
        data = {
            'Title': title,
            'AuthorList': list(self.authors.value),
            'GenreList': list(self.genres.value or []),
            'TagList': list(self.tags.value or []),
            'Spice': self.spice.value,
            'Kink': self.kink.value,
            'Edition': (self.edition.value or '').strip() or None,
            'FormatName': self.format.value,
            'SeriesTitle': self.series.value,
            'NumberInSeries': number(self.number_in_series.value, float),
            'Signed': int(bool(self.signed.value)),
            'ISBN': (self.isbn.value or '').strip() or None,
        }
        if self.kind == 'owned':
            readings = [r for r in self.earlier_values() + [self.current_reading()] if any(r.values())]
            data.update({
                'PageCount': number(self.pages.value),
                'ShelfNumber': number(self.shelf.value),
                'Rating': self.rating.value,
                'Readings': readings,
                # a finished reading means it has been read
                'Read': int(bool(self.read.value or any(r['FinishedDate'] for r in readings))),
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
        for field in (self.format, self.series, self.number_in_series, self.pages, self.shelf, self.rating, self.spice,
                      self.kink):
            field.value = None
        for field in (self.signed, self.read, self.edge):
            field.value = False
        self.authors.set_options(db.names('Authors'), value=[])
        self.genres.set_options(db.names('Genres'), value=[])
        self.tags.set_options(db.names('Tags'), value=[])
        self.show_earlier([])
        self.format.set_options(db.names('Formats'), value=None)
        self.series.set_options(db.names('Series'), value=None)
        self.status.set_text('')
        self.isbn.run_method('focus')


def open_editor(kind: str, book_id: int, on_change) -> None:
    """Edit one book in a dialog, with check-out/return, 'bought it' and delete."""
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
        if kind == 'owned':
            roomdb.forget_book(book_id)
        done(f"{book['Title'].upper()} DELETED.")

    def lend() -> None:
        if not borrower.value:
            ui.notify('WHO IS BORROWING IT?', type='warning')
            return
        if not DateInput.check(lend_date):
            return
        db.lend(book_id, borrower.value, lend_date.iso or None)
        done(f"{book['Title'].upper()} IS NOW ON LOAN TO {borrower.value.upper()}.")

    with ui.dialog() as dialog, ui.card().classes('term-card w-full max-w-5xl'):
        with ui.row().classes('w-full items-center justify-between no-wrap term-title-row'):
            ui.label(f'> RECORD {db.serial(kind, book_id)}  //  {KIND_NAMES[kind]}').classes('term-sub')
            button('CLOSE', dialog.close).classes('narrow-only')  # the editor fills a phone screen
        ui.element('div').classes('term-rule')
        form = BookForm(kind, book)
        ui.element('div').classes('term-rule')
        if kind == 'owned':
            if book.get('LoanedTo'):
                with ui.row().classes('items-center gap-4'):
                    ui.label(f"ON LOAN TO {book['LoanedTo'].upper()} SINCE {book['LoanedDate'] or '?'}").classes('term-warn')
                    button('RETURNED', lambda: (db.return_book(book_id), done(f"{book['Title'].upper()} IS BACK ON THE SHELF.")))
            else:
                with ui.row().classes('items-end gap-4 w-full'):
                    borrower = ui.select(db.borrowers(), label='BORROWER', with_input=True,
                                         new_value_mode='add-unique').classes('min-w-[220px]')
                    lend_date = DateInput('DATE', date.today().isoformat())
                    button('CHECK OUT', lend)
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


def in_saved_order(columns: list[dict], saved: list[str]) -> list[dict]:
    """Put the columns in the order last dragged into; columns added since keep their place next to their neighbours."""
    known = sorted((c for c in columns if c['field'] in saved), key=lambda c: saved.index(c['field']))
    for i, column in enumerate(columns):
        if column['field'] not in saved:
            known.insert(known.index(columns[i - 1]) + 1 if i else 0, column)  # straight after its left neighbour
    return known


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

    settings = backup.load_settings()
    # Serial is always the leftmost column: frozen, and nothing can be moved or frozen to the left of it
    columns.insert(0, {'headerName': 'Serial', 'field': 'BookID', 'minWidth': 70,
                       'lockPosition': 'left', 'lockPinned': True, 'suppressMovable': True,
                       # shown as L0012 / W0003 (see db.serial); the database keeps the plain number
                       ':valueGetter': f'p => "{db.ID_PREFIX[kind]}" + String(p.data.BookID).padStart({db.SERIAL_DIGITS}, "0")'})
    columns = in_saved_order(columns, settings.get('column_order', {}).get(kind, []))
    frozen = settings.get('frozen_columns', {}).get(kind, DEFAULT_FROZEN)
    for c in columns:
        c['pinned'] = 'left' if c['field'] in frozen or c['field'] == 'BookID' else None

    # hidden columns: an x in each heading hides one, the buttons above the table bring them back
    names = {c['field']: c['headerName'] for c in columns}
    hidden = [f for f in settings.get('hidden_columns', {}).get(kind, []) if f in names]
    for c in columns:
        c['hide'] = c['field'] in hidden
        c['headerComponentParams'] = {'template': HEADER_TEMPLATE.format(field=c['field'])}

    def save_hidden(e) -> None:
        hidden[:] = e.args
        current = backup.load_settings()
        current.setdefault('hidden_columns', {})[kind] = hidden
        backup.save_settings(current)
        show_hidden()

    def show_columns(fields: list[str]) -> None:
        grid.run_grid_method('setColumnsVisible', fields, True)  # the columnVisible event saves and redraws

    def show_hidden() -> None:
        hidden_bar.clear()
        with hidden_bar:
            if hidden:
                ui.label('HIDDEN:').classes('term-dim')
                for field in hidden:
                    button(f'+ {names[field].upper()}', lambda f=field: show_columns([f]))
                button('SHOW ALL', lambda: show_columns(list(hidden)))

    def save_layout(e) -> None:
        """Remember the column order and which columns are frozen."""
        current = backup.load_settings()
        current.setdefault('column_order', {})[kind] = e.args['order']
        current.setdefault('frozen_columns', {})[kind] = e.args['frozen']
        backup.save_settings(current)

    with ui.row().classes('w-full items-end gap-4'):
        search = ui.input('SEARCH ALL COLUMNS').classes('grow')
        count = ui.label('').classes('term-dim')
        if kind == 'wished':
            button('ADD TO WISHLIST', lambda: ui.navigate.to('/insert?kind=wished'))
    ui.label('TYPE IN THE BOXES UNDER THE HEADINGS TO FILTER A COLUMN  //  DOUBLE-CLICK A ROW TO OPEN IT  //  '
             'RIGHT-CLICK A HEADING TO FREEZE IT ON THE LEFT').classes('term-faint wide-only')
    ui.label('SWIPE THE TABLE SIDEWAYS FOR MORE COLUMNS  //  DRAG THE EDGE OF A HEADING TO RESIZE IT  //  '
             'PRESS AND HOLD A HEADING TO FREEZE IT  //  TAP A BOOK TO OPEN IT').classes('term-faint narrow-only')
    hidden_bar = ui.row().classes('items-center gap-2')
    show_hidden()
    grid = ui.aggrid({
        'defaultColDef': {'filter': 'agTextColumnFilter', 'floatingFilter': True, 'sortable': True,
                          'resizable': True, 'minWidth': 90, 'suppressHeaderMenuButton': True},
        'columnDefs': columns,
        'rowData': [],
        'autoSizeStrategy': {'type': 'fitCellContents'},
        'animateRows': False,
        'enableCellTextSelection': True,
        'ensureDomOrder': True,
        'includeHiddenColumnsInQuickFilter': True,
        'suppressDragLeaveHidesColumns': True,  # columns are only hidden with the x in their heading
    }, auto_size_columns=False).classes('w-full term-book-grid term-fit')
    search.on_value_change(lambda e: grid.run_grid_method('setGridOption', 'quickFilterText', e.value or ''))
    grid.on('rowDoubleClicked', lambda e: open_editor(kind, e.args, refresh),
            js_handler=f'(e) => {{ if (window.innerWidth >= {MOBILE_WIDTH}) emit(e.data.BookID) }}')
    layout = f'''const s = getElement({grid.id}).api.getColumnState();
        emit({{order: s.map(c => c.colId), frozen: s.filter(c => c.pinned).map(c => c.colId)}});'''
    grid.on('columnMoved', save_layout, js_handler=f'(e) => {{ if (e.finished) {{ {layout} }} }}')  # not while dragging
    grid.on('columnPinned', save_layout, js_handler=f'() => {{ {layout} }}')  # frozen by the menu or by dragging
    grid.on('columnVisible', save_hidden, js_handler=f'''() => emit(
        getElement({grid.id}).api.getColumns().filter(c => !c.isVisible()).map(c => c.getColId()))''')
    grid.on('rowClicked', lambda e: open_editor(kind, e.args, refresh),
            js_handler=f'(e) => {{ if (window.innerWidth < {MOBILE_WIDTH}) emit(e.data.BookID) }}')
    async def save_phone_title_width(e) -> None:
        current = backup.load_settings()
        current['phone_title_width'] = int(e.args)
        backup.save_settings(current)

    # on a phone: every column, scrolled sideways; Title starts narrow, and any heading's edge can be dragged
    title_width = backup.load_settings().get('phone_title_width', PHONE_TITLE_WIDTH)
    grid.on('firstDataRendered', js_handler=f'''() => {{
        if (window.innerWidth >= {MOBILE_WIDTH}) return;
        const api = getElement({grid.id}).api;
        api.setGridOption('floatingFiltersHeight', 0);
        setTimeout(() => {{  // after the grid's own fit-to-contents sizing, which runs after this event
            api.getColumns().forEach(c => {{ if (c.getActualWidth() > 220) api.setColumnWidths([{{key: c, newWidth: 220}}]); }});
            api.setColumnWidths([{{key: 'Title', newWidth: {title_width}}}]);
        }}, 100);
    }}''')
    grid.on('columnResized', save_phone_title_width, js_handler=f'''(e) => {{
        if (window.innerWidth < {MOBILE_WIDTH} && e.finished && e.source === 'uiColumnResized' && e.colId === 'Title')
            emit(getElement({grid.id}).api.getColumn('Title').getActualWidth());
    }}''')
    refresh()


# AG Grid's own heading layout (laid out right to left) plus an x on the right that hides the column and a
# right-click menu to freeze it (window.termHideColumn and termColumnMenu, added in shell())
HEADER_TEMPLATE = '''<div class="ag-cell-label-container" role="presentation"
     oncontextmenu="termColumnMenu(event, this, '{field}')">
  <span class="term-col-hide" title="Hide this column" role="button"
        onclick="event.stopPropagation(); termHideColumn(this, '{field}')">x</span>
  <span data-ref="eMenu" class="ag-header-icon ag-header-cell-menu-button" aria-hidden="true"></span>
  <span data-ref="eFilterButton" class="ag-header-icon ag-header-cell-filter-button" aria-hidden="true"></span>
  <div data-ref="eLabel" class="ag-header-cell-label" role="presentation">
    <span data-ref="eText" class="ag-header-cell-text"></span>
    <span data-ref="eFilter" class="ag-header-icon ag-header-label-icon ag-filter-icon" aria-hidden="true"></span>
    <ag-sort-indicator data-ref="eSortIndicator"></ag-sort-indicator>
  </div>
</div>'''
DEFAULT_FROZEN = ['Title']  # frozen next to Serial (which always is) until the user changes it
NUM = {'filter': 'agNumberColumnFilter'}
BY_SURNAME = {':comparator': '(a, b) => termAuthorCompare(a, b)'}  # see shell()
STARS = {':valueFormatter': 'p => p.value == null ? "" : "*".repeat(p.value)', **NUM}
CHILIES = {':valueFormatter': f'p => p.value == null ? "" : p.value == 0 ? "0" : "{CHILI}".repeat(p.value)', **NUM}
LINKS = {':valueFormatter': f'p => p.value == null ? "" : p.value == 0 ? "0" : "{CHAINS}".repeat(p.value)', **NUM}


def books_page() -> None:
    frame('BOOKS')
    book_grid('owned', [
        {'headerName': 'Title', 'field': 'Title', 'minWidth': 60},
        {'headerName': 'Authors', 'field': 'Authors', **BY_SURNAME},
        {'headerName': 'Series', 'field': 'SeriesTitle'},
        {'headerName': '#', 'field': 'NumberInSeries', **NUM},
        {'headerName': 'Genres', 'field': 'Genres'},
        {'headerName': 'Tags', 'field': 'Tags'},
        {'headerName': 'Format', 'field': 'FormatName'},
        {'headerName': 'Pages', 'field': 'PageCount', **NUM},
        {'headerName': 'Rating', 'field': 'Rating', **STARS},
        {'headerName': 'Spice', 'field': 'Spice', **CHILIES},
        {'headerName': 'Kink', 'field': 'Kink', **LINKS},
        {'headerName': 'Read', 'field': 'ReadText'},
        {'headerName': 'Times read', 'field': 'TimesRead', **NUM},
        {'headerName': 'Started', 'field': 'StartedDate'},
        {'headerName': 'Finished', 'field': 'FinishedDate'},
        {'headerName': 'Shelf', 'field': 'ShelfNumber', **NUM},
        {'headerName': 'Signed', 'field': 'SignedText'},
        {'headerName': 'Sprayed', 'field': 'EdgeOutText'},
        {'headerName': 'Borrower', 'field': 'LoanedTo'},
        {'headerName': 'Edition', 'field': 'Edition'},
        {'headerName': 'ISBN', 'field': 'ISBN'},
        {'headerName': 'Comments', 'field': 'Comments', 'maxWidth': 320},
    ])


def wishlist_page() -> None:
    frame('WISHLIST')
    book_grid('wished', [
        {'headerName': 'Title', 'field': 'Title', 'minWidth': 60},
        {'headerName': 'Authors', 'field': 'Authors', **BY_SURNAME},
        {'headerName': 'Series', 'field': 'SeriesTitle'},
        {'headerName': '#', 'field': 'NumberInSeries', **NUM},
        {'headerName': 'Genres', 'field': 'Genres'},
        {'headerName': 'Tags', 'field': 'Tags'},
        {'headerName': 'Format', 'field': 'FormatName'},
        {'headerName': 'Spice', 'field': 'Spice', **CHILIES},
        {'headerName': 'Kink', 'field': 'Kink', **LINKS},
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
            for kind, book_id, title in books:
                ui.label(f"  {db.serial(kind, book_id)}  {title}" + ('  (WISHLIST)' if kind == 'wished' else ''))
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
                 **(BY_SURNAME if table == 'Authors' else {}),
                 'filter': 'agTextColumnFilter', 'floatingFilter': True},
                {'headerName': 'Books', 'field': 'Owned', 'flex': 1, 'filter': 'agNumberColumnFilter'},
                {'headerName': 'Wishlist', 'field': 'Wished', 'flex': 1, 'filter': 'agNumberColumnFilter'},
            ],
            'rowData': [],
            'rowSelection': {'mode': 'singleRow', 'checkboxes': False, 'enableClickSelection': True},
            'stopEditingWhenCellsLoseFocus': True,
            'enableCellTextSelection': True,
            'ensureDomOrder': True,
        }).style('min-height: 320px; max-width: 720px').classes('grow term-fit')
        detail = ui.column().classes('gap-1 min-w-[300px]')
    search.on_value_change(lambda e: grid.run_grid_method('setGridOption', 'quickFilterText', e.value or ''))
    grid.on('rowClicked', lambda e: show(e.args['data']), ['data'])
    grid.on('cellValueChanged', rename, ['data', 'oldValue', 'newValue'])
    refresh()


def authors_page() -> None:
    index_page('AUTHORS', 'Authors', 'AUTHOR')


def genres_page() -> None:
    index_page('GENRES', 'Genres', 'GENRE')


def tags_page() -> None:
    index_page('TAGS', 'Tags', 'TAG')


def series_page() -> None:
    index_page('SERIES', 'Series', 'SERIES')


def formats_page() -> None:
    index_page('FORMATS', 'Formats', 'FORMAT')


def editions_page() -> None:
    index_page('EDITIONS', 'Edition', 'EDITION')


def loans_page() -> None:
    frame('ON LOAN')
    listing = ui.column().classes('w-full gap-0')
    ui.label('> CHECK OUT A BOOK').classes('term-sub')
    with ui.row().classes('items-end gap-4 w-full'):
        book = ui.select({}, label='BOOK', with_input=True).classes('min-w-[340px] grow')
        borrower = ui.select(db.borrowers(), label='BORROWER', with_input=True, new_value_mode='add-unique').classes('min-w-[220px]')
        when = DateInput('DATE', date.today().isoformat())

        def lend() -> None:
            if not book.value or not borrower.value:
                ui.notify('CHOOSE A BOOK AND WHO IS BORROWING IT.', type='warning')
                return
            if not DateInput.check(when):
                return
            db.lend(book.value, borrower.value, when.iso or None)
            ui.notify(f'NOW ON LOAN TO {borrower.value.upper()}.')
            book.value = None
            render()
        button('CHECK OUT', lend)

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
                    with ui.element('div').classes('loan-row'):
                        ui.label(b['Title']).classes('loan-title')
                        ui.label(b['Authors'] or '').props('data-label=AUTHOR')
                        ui.label(b['LoanedTo']).props('data-label=BORROWER')
                        ui.label(b['LoanedDate'] or '?').props('data-label=SINCE')
                        ui.label('?' if days is None else f"{days}{' !' if late else ''}").props('data-label=DAYS').classes(
                            'term-warn' if late else '')
                        button('RETURNED', lambda b=b: returned(b['BookID'], b['Title']))
    render()


def reading_history_page() -> None:
    """Every reading of every library book; click one to change its dates or delete it."""
    frame('READING HISTORY')

    def rows() -> list[dict]:
        readings = db.list_readings()
        newest = {}
        for r in readings:
            newest[r['BookID']] = max(newest.get(r['BookID'], 0), r['ReadingID'])
        for r in readings:
            r['Serial'] = db.serial('owned', r['BookID'])
            # an unfinished reading is still going only if it is the book's newest; an older one was given up
            going = not r['FinishedDate'] and r['ReadingID'] == newest[r['BookID']]
            r['Status'] = 'FINISHED' if r['FinishedDate'] else 'READING' if going and r['StartedDate'] else 'STOPPED'
            start, end = r['StartedDate'], r['FinishedDate'] or (date.today().isoformat() if going else None)
            try:
                r['Days'] = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1 if start and end else None
            except ValueError:
                r['Days'] = None
        return readings

    def refresh() -> None:
        grid.options['rowData'] = rows()
        grid.update()
        count.set_text(f"{len(grid.options['rowData'])} READINGS")

    def show(row: dict) -> None:
        detail.clear()
        with detail:
            ui.label(f"> {row['Serial']}  {row['Title'].upper()}").classes('term-sub')
            ui.label(f"{row['Authors'] or ''}  //  READING #{row['ReadingNo']}").classes('term-dim')
            started = DateInput('STARTED', row['StartedDate'])
            finished = DateInput('FINISHED', row['FinishedDate'])

            def save() -> None:
                if not DateInput.check(started, finished):
                    return
                if not started.iso and not finished.iso:
                    ui.notify('A READING NEEDS A START OR A FINISH DATE. DELETE IT INSTEAD.', type='warning')
                    return
                db.update_reading(row['ReadingID'], started.iso or None, finished.iso or None)
                ui.notify('READING SAVED.')
                detail.clear()
                refresh()

            def delete(btn) -> None:
                if btn.text != '[ CONFIRM DELETE ]':
                    btn.set_text('[ CONFIRM DELETE ]')
                    return
                db.delete_reading(row['ReadingID'])
                ui.notify('READING DELETED.')
                detail.clear()
                refresh()

            with ui.row().classes('gap-2 mt-2'):
                button('SAVE', save)
                delete_btn = button('DELETE', lambda: delete(delete_btn), danger=True)
            ui.label('NEW READINGS ARE ADDED FROM THE BOOK ITSELF: OPEN IT AND PRESS NEW READING.').classes(
                'term-faint mt-2')

    with ui.row().classes('w-full items-end gap-4'):
        search = ui.input('SEARCH').classes('min-w-[220px]')
        count = ui.label('').classes('term-dim')
    ui.label('CLICK A READING TO CHANGE ITS DATES OR DELETE IT  //  DAYS COUNTS BOTH THE FIRST AND THE LAST DAY').classes(
        'term-faint')
    with ui.row().classes('w-full gap-8 items-start'):
        grid = ui.aggrid({
            'defaultColDef': {'sortable': True, 'resizable': True, 'suppressHeaderMenuButton': True,
                              'filter': 'agTextColumnFilter', 'floatingFilter': True},
            'columnDefs': [
                {'headerName': 'Serial', 'field': 'Serial', 'width': 90, 'pinned': 'left'},
                {'headerName': 'Title', 'field': 'Title', 'flex': 3, 'minWidth': 140},
                {'headerName': 'Authors', 'field': 'Authors', 'flex': 2, 'minWidth': 120, **BY_SURNAME},
                {'headerName': '#', 'field': 'ReadingNo', 'width': 70, **NUM},
                {'headerName': 'Started', 'field': 'StartedDate', 'width': 130},
                {'headerName': 'Finished', 'field': 'FinishedDate', 'width': 130},
                {'headerName': 'Days', 'field': 'Days', 'width': 90, **NUM},
                {'headerName': 'Status', 'field': 'Status', 'width': 120},
            ],
            'rowData': [],
            'rowSelection': {'mode': 'singleRow', 'checkboxes': False, 'enableClickSelection': True},
            'enableCellTextSelection': True,
            'ensureDomOrder': True,
        }).style('min-height: 320px; max-width: 1100px').classes('grow term-fit')
        detail = ui.column().classes('gap-1 min-w-[300px] term-detail')
    search.on_value_change(lambda e: grid.run_grid_method('setGridOption', 'quickFilterText', e.value or ''))
    grid.on('rowClicked', lambda e: show(e.args['data']), ['data'])
    refresh()


def bar(value: float, top: float, width: int = 24) -> str:
    """A bar exactly `width` characters wide, filled in proportion to value / top."""
    filled = min(100, value / top * 100) if top else 0
    return f'<span class="term-bar" style="width: {width}ch"><span style="width: {filled:.1f}%"></span></span>'


def stats_text(year: int, goal: int) -> str:
    """The statistics as monospaced HTML lines (names from the database are escaped)."""
    s = db.stats(year)
    fmt = lambda n: f'{n:,}'.replace(',', '.')  # noqa: E731  Danish thousands separator
    dots = lambda label, value: f"  {label} {'.' * (24 - len(label))} {value}"  # noqa: E731
    esc = html.escape
    lines = [f'&gt; QUERY READING_LOG --YEAR={year}', '']
    pct = min(100, round(s['books'] / goal * 100)) if goal else 0
    lines.append(dots('BOOKS READ', f"{s['books']:<5} GOAL {goal}  [{bar(s['books'], goal or 1, 20) if goal else ''}] {pct}%"))
    lines.append(dots('PAGES READ', fmt(s['pages'])))
    lines.append(dots('AVG PAGES PER BOOK', fmt(round(s['avg_pages'])) if s['avg_pages'] else '-'))
    lines.append(dots('DIFFERENT TITLES', s['titles']))
    lines.append(dots('RE-READS', s['rereads']))
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
        lines += [f"  {esc(f'{g[:20].upper():<20}')} {bar(n, gtop, 16)} {n:>3}" for g, n in s['genres']]
    if s['authors']:
        lines += ['', f'  MOST READ AUTHORS IN {year}']
        lines += [esc(dots(a[:24].upper(), n)) for a, n in s['authors']]
    if s['most_reread']:
        lines += ['', '  MOST RE-READ, ALL YEARS']
        lines += [esc(dots(t[:24].upper(), f'{n} TIMES')) for t, n in s['most_reread']]
    owned_books, owned_pages = s['owned']
    lines += ['', '  LIBRARY ARCHIVE',
              dots('VOLUMES OWNED', f'{fmt(owned_books)}  ({fmt(owned_pages)} PAGES)'),
              dots('NOT YET READ', s['unread']),
              dots('READINGS, ALL YEARS', fmt(s['total_readings'])),
              dots('ON LOAN', s['on_loan']),
              dots('SIGNED', s['signed']),
              dots('SPRAYED EDGES', s['sprayed']),
              dots('ON THE WISHLIST', s['wished'])]
    if s['formats']:
        lines.append(esc(dots('FORMATS', '  '.join(f'{f.upper()} {n}' for f, n in s['formats']))))
    return '\n'.join(lines)


def stats_page() -> None:
    frame('STATISTICS')
    goal = int(backup.load_settings().get('reading_goal') or 0)
    years = db.stat_years()
    year = ui.select(years, label='YEAR', value=years[0]).classes('w-32')
    output = ui.html(stats_text(years[0], goal), sanitize=False).classes('term-pre mt-2')  # stats_text escapes
    year.on_value_change(lambda e: output.set_content(stats_text(e.value, goal)))


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
        rooms = backup.list_backups(current['backup_dir'], 'room')
        if rooms:  # the 3D room's own database, backed up alongside
            text += f'\n  ROOM: {rooms[0].name}   {rooms[0].stat().st_size // 1024} KB'
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
    ui.label(f'3D ROOM DATABASE FILE: {roomdb.DB_PATH}').classes('term-faint')
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


# ---------- the bookshelf simulation: the 3D room in a frame (sim.py serves it and its data) ----------

def bookshelf_page(path: str) -> None:
    label, view = SIM_VIEWS[path]
    frame(label)
    text, bg = theme_colors(backup.load_settings())
    ui.element('iframe').props(f'id=simFrame allow=fullscreen title="{label}" '
                               f'src="/sim-files/index.html?lib=1&view={view}&fg={text[1:]}&bg={bg[1:]}"')         .classes('w-full term-fit term-sim').style('min-height: 420px')


def bookshelf_route(path: str):
    def page() -> None:
        bookshelf_page(path)
    return page


# ---------- one page for the whole app: switching menu items only swaps the content, no reload ----------

ROUTES = {
    '/insert': insert_page,
    '/': books_page,
    '/wishlist': wishlist_page,
    '/authors': authors_page,
    '/genres': genres_page,
    '/tags': tags_page,
    '/series': series_page,
    '/formats': formats_page,
    '/editions': editions_page,
    '/loans': loans_page,
    '/reading-history': reading_history_page,
    '/stats': stats_page,
    '/settings': settings_page,
    **{path: bookshelf_route(path) for path in SIM_VIEWS},
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
