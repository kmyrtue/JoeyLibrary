"""Look up book details by ISBN: ISBNdb (when an API key is set), Google Books, LIBRIS, then Open Library.

Audiobooks have no page count, so for those a printed edition of the same book is looked up and its pages used.
"""
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

USER_AGENT = 'JoeyLibrary/1.0 (personal home library app)'
AUDIOBOOK = 'Audiobook'
# Google Books and ISBNdb give two-letter language codes, LIBRIS and Open Library three-letter (MARC) ones
LANGUAGES = {'en': 'eng', 'sv': 'swe', 'da': 'dan', 'no': 'nor', 'nb': 'nob', 'nn': 'nno', 'de': 'ger', 'fr': 'fre',
             'es': 'spa', 'it': 'ita', 'nl': 'dut', 'fi': 'fin', 'pl': 'pol', 'pt': 'por'}
NETWORK_ERRORS = (OSError, ET.ParseError, ValueError, KeyError)  # unreachable, or answering nonsense


def clean(isbn: str) -> str:
    return re.sub(r'[^0-9Xx]', '', isbn or '').upper()


class BadKey(Exception):
    """A book database refused the API key."""


def _get(url: str, headers: dict | None = None) -> dict:
    return json.loads(_get_text(url, headers))


def _get_text(url: str, headers: dict | None = None) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode('utf-8')


def _first_last(name: str) -> str:
    """Libraries often write 'Herbert, Frank'; the library uses 'Frank Herbert'."""
    last, sep, first = name.partition(', ')
    return f'{first} {last}'.strip() if sep and ',' not in first else name.strip()


def _language(code: str | None) -> str:
    code = (code or '').lower().rsplit('/', 1)[-1]
    return LANGUAGES.get(code, code)


def _main_title(title: str) -> str:
    """'The Hobbit: or There and Back Again' and 'hobbit' both become 'hobbit', for comparing editions."""
    title = re.split(r'[:;(\[]| / ', title or '')[0].lower()
    title = re.sub(r'^(the|a|an)\s+', '', title.strip())
    return re.sub(r'\W+', ' ', title).strip()


def _surname(authors: list[str]) -> str:
    return authors[0].split()[-1].lower() if authors else ''


def _is_audio(text: str | None) -> bool:
    return bool(re.search(r'audio|audible|mp3|sound|ljud|lydbog|hörbuch|cd\b', (text or '').lower()))


def _book(title='', authors=(), pages=None, publisher='', year='', source='', audiobook=False, language='', **extra):
    return {'Title': title, 'AuthorList': [a for a in authors if a], 'PageCount': pages or None, 'Publisher': publisher,
            'Year': year, 'Source': source, 'Audiobook': audiobook, 'Language': language, **extra}


# ---------- ISBNdb ----------

def _isbndb_get(path: str, api_key: str) -> dict | None:
    try:
        return _get(f'https://api2.isbndb.com/{path}', {'Authorization': api_key})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code in (401, 403):
            raise BadKey('ISBNdb did not accept the API key. Check it under SETTINGS.') from e
        raise


def _isbndb_book(book: dict) -> dict:
    return _book(book.get('title_long') or book.get('title') or '', [_first_last(a) for a in book.get('authors') or []],
                 book.get('pages'), book.get('publisher', ''), book.get('date_published', ''), 'ISBNdb',
                 _is_audio(book.get('binding')), _language(book.get('language')),
                 ISBN=book.get('isbn13') or book.get('isbn'))


def _isbndb(isbn: str, api_key: str) -> dict | None:
    data = _isbndb_get(f'book/{isbn}', api_key)
    return _isbndb_book(data['book']) if data and data.get('book') else None


def _isbndb_search(title: str, api_key: str) -> list[dict]:
    data = _isbndb_get('books/' + urllib.parse.quote(title) + '?column=title&pageSize=40', api_key)
    return [_isbndb_book(b) for b in (data or {}).get('books') or []]


# ---------- Google Books ----------

def _google_get(query: str, api_key: str, extra: str = '') -> list[dict]:
    url = 'https://www.googleapis.com/books/v1/volumes?q=' + urllib.parse.quote(query) + extra
    if api_key:
        url += '&key=' + urllib.parse.quote(api_key)
    try:
        data = _get(url)
    except urllib.error.HTTPError as e:
        if api_key and e.code in (400, 403):
            raise BadKey('Google Books did not accept the API key. Check it under SETTINGS.') from e
        raise
    books = []
    for item in data.get('items') or []:
        info = item.get('volumeInfo', {})
        title = info.get('title', '') + (f": {info['subtitle']}" if info.get('subtitle') else '')
        isbns = {i.get('type'): i.get('identifier') for i in info.get('industryIdentifiers', [])}
        books.append(_book(title, info.get('authors', []), info.get('pageCount'), info.get('publisher', ''),
                           info.get('publishedDate', ''), 'Google Books', language=_language(info.get('language')),
                           ISBN=isbns.get('ISBN_13') or isbns.get('ISBN_10')))
    return books


def _google_books(isbn: str, api_key: str = '') -> dict | None:
    books = _google_get(f'isbn:{isbn}', api_key)
    return books[0] if books else None


def _google_search(title: str, surname: str, api_key: str) -> list[dict]:
    return _google_get(f'intitle:"{title}" inauthor:{surname}', api_key, '&printType=books&maxResults=40')


# ---------- LIBRIS (the Swedish union library catalogue: free, no key, strong on Nordic books) ----------

MODS = {'m': 'http://www.loc.gov/mods/v3'}


def _libris_get(query: str, count: int) -> list[dict]:
    root = ET.fromstring(_get_text('https://libris.kb.se/xsearch?query=' + urllib.parse.quote(query)
                                   + f'&format=mods&n={count}'))
    return [_libris_record(r) for r in root.iter('{http://www.loc.gov/mods/v3}mods')]


def _libris_record(record) -> dict:
    title_info = next((t for t in record.findall('m:titleInfo', MODS) if not t.get('type')), None)
    title = subtitle = ''
    if title_info is not None:
        title = (title_info.findtext('m:nonSort', '', MODS) + title_info.findtext('m:title', '', MODS)).strip()
        subtitle = title_info.findtext('m:subTitle', '', MODS).strip()
    authors = []
    for name in record.findall('m:name', MODS):
        roles = {r.text for r in name.findall('.//m:roleTerm', MODS)}
        part = next((p.text for p in name.findall('m:namePart', MODS) if not p.get('type') and p.text), None)
        if part and roles & {'aut', 'creator'}:
            authors.append(_first_last(re.sub(r'\s*\(.*\)$', '', part)))
    resource = record.findtext('m:typeOfResource', '', MODS)
    genres = ' '.join(g.text or '' for g in record.findall('m:genre', MODS))
    audiobook = resource.startswith('sound recording') or 'Ljudböcker' in genres
    # for an audiobook the extent is its playing time ("22 tim., 37 min."), so only trust it when it says pages
    pages = re.search(r'(\d+)\s*(sidor|s\.|pages|p\.)', record.findtext('.//m:extent', '', MODS))
    isbn = next((clean(i.text) for i in record.findall('m:identifier', MODS) if i.get('type') == 'isbn' and i.text), '')
    return _book(title + (f': {subtitle}' if title and subtitle else ''), authors,
                 int(pages.group(1)) if pages and not audiobook else None,
                 record.findtext('.//m:publisher', '', MODS).strip(), record.findtext('.//m:dateIssued', '', MODS).strip(),
                 'LIBRIS', audiobook, _language(record.findtext('.//m:languageTerm', '', MODS)), ISBN=isbn)


def _libris(isbn: str) -> dict | None:
    records = _libris_get(f'isbn:{isbn}', 1)
    return records[0] if records else None


def _libris_search(title: str, surname: str) -> list[dict]:
    return _libris_get(f'tit:"{title}" förf:{surname}', 50)


# ---------- Open Library ----------

def _open_library_edition(e: dict, source: str = 'Open Library') -> dict:
    return _book(e.get('title', '') + (f": {e['subtitle']}" if e.get('subtitle') else ''),
                 [a.get('name', '') for a in e.get('authors', [])], e.get('number_of_pages'),
                 ', '.join(p if isinstance(p, str) else p.get('name', '') for p in e.get('publishers', [])),
                 e.get('publish_date', ''), source, _is_audio(e.get('physical_format')),
                 _language((e.get('languages') or [{}])[0].get('key')),
                 ISBN=(e.get('isbn_13') or e.get('isbn_10') or [''])[0],
                 WorkKey=(e.get('works') or [{}])[0].get('key', ''))


def _open_library(isbn: str) -> dict | None:
    data = _get(f'https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=details')
    details = (data.get(f'ISBN:{isbn}') or {}).get('details')
    return _open_library_edition(details) if details else None


def _open_library_editions(work_key: str) -> list[dict]:
    data = _get(f'https://openlibrary.org{work_key}/editions.json?limit=200')
    return [_open_library_edition(e) for e in data.get('entries', [])]


# ---------- the lookup ----------

def _print_edition(book: dict, isbndb_key: str, google_key: str) -> dict | None:
    """Find a printed edition of the same book with a page count, preferably in the same language."""
    title, surname = _main_title(book['Title']), _surname(book['AuthorList'])
    searches = []
    if book.get('WorkKey'):  # Open Library knows exactly which editions belong to the same work
        searches.append(lambda: _open_library_editions(book['WorkKey']))
    if title and surname:
        searches.append(lambda: _libris_search(title, surname))
        searches.append(lambda: _google_search(title, surname, google_key))
        if isbndb_key:
            searches.append(lambda: _isbndb_search(title, isbndb_key))
    candidates = []
    for search in searches:
        try:
            for c in search():
                same_book = book.get('WorkKey') and c.get('WorkKey') == book['WorkKey'] or (
                    _main_title(c['Title']) == title and surname in ' '.join(c['AuthorList']).lower())
                if same_book and c['PageCount'] and not c['Audiobook'] and c.get('ISBN'):
                    candidates.append(c)
        except (BadKey, *NETWORK_ERRORS):
            continue
        if any(c['Language'] == book['Language'] for c in candidates):
            break
    candidates.sort(key=lambda c: c['Language'] != book['Language'])  # same language first, else source order
    return candidates[0] if candidates else None


def lookup(isbn: str, isbndb_key: str = '', google_key: str = '') -> dict | None:
    """Return a dict of book details, or None if no source knows the ISBN. Raises on network errors.

    For an audiobook, 'Format' is 'Audiobook' and the pages come from a printed edition ('PrintISBN', 'PrintSource').
    """
    isbn = clean(isbn)
    if len(isbn) not in (10, 13):
        raise ValueError('An ISBN has 10 or 13 digits.')
    sources = [lambda code: _google_books(code, google_key), _libris, _open_library]
    if isbndb_key:
        sources.insert(0, lambda code: _isbndb(code, isbndb_key))
    found, errors = None, []
    for source in sources:
        try:
            hit = source(isbn)
        except NETWORK_ERRORS as e:  # one source unreachable or answering nonsense; try the next
            errors.append(e)
            continue
        if not hit or not hit['Title']:
            continue
        if found is None:
            found = hit
        else:  # the first source had no page count; this one may know the pages, or that it is an audiobook
            found['Audiobook'] = found['Audiobook'] or hit['Audiobook']
            found['Language'] = found['Language'] or hit['Language']
            found['WorkKey'] = found.get('WorkKey') or hit.get('WorkKey')
            if not hit['Audiobook'] and hit['PageCount']:
                found['PageCount'] = hit['PageCount']
        if found['Audiobook'] or found['PageCount']:
            break
    if found is None:
        if len(errors) == len(sources):
            raise ConnectionError('Could not reach any book database. Check the internet connection.')
        return None
    if found['Audiobook']:
        found['Format'] = AUDIOBOOK
        found['PageCount'] = None  # an audiobook's own "pages" are not trustworthy; use a printed edition's
        printed = _print_edition(found, isbndb_key, google_key)
        if printed:
            found.update(PageCount=printed['PageCount'], PrintISBN=printed['ISBN'], PrintSource=printed['Source'])
    return found
