"""Look up book details by ISBN: ISBNdb (when an API key is set), then Google Books, then Open Library."""
import json
import re
import urllib.error
import urllib.parse
import urllib.request

USER_AGENT = 'JoeyLibrary/1.0 (personal home library app)'


def clean(isbn: str) -> str:
    return re.sub(r'[^0-9Xx]', '', isbn or '').upper()


class BadKey(Exception):
    """ISBNdb refused the API key."""


def _get(url: str, headers: dict | None = None) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, **(headers or {})})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


def _first_last(name: str) -> str:
    """ISBNdb often writes 'Herbert, Frank'; the library uses 'Frank Herbert'."""
    last, sep, first = name.partition(', ')
    return f'{first} {last}'.strip() if sep and ',' not in first else name.strip()


def _isbndb(isbn: str, api_key: str) -> dict | None:
    try:
        data = _get(f'https://api2.isbndb.com/book/{isbn}', {'Authorization': api_key})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        if e.code in (401, 403):
            raise BadKey('ISBNdb did not accept the API key. Check it under SETTINGS.') from e
        raise
    book = data.get('book') or {}
    return {
        'Title': book.get('title_long') or book.get('title') or '',
        'AuthorList': [_first_last(a) for a in book.get('authors') or [] if a],
        'PageCount': book.get('pages'),
        'Publisher': book.get('publisher', ''),
        'Year': book.get('date_published', ''),
        'Source': 'ISBNdb',
    }


def _open_library(isbn: str) -> dict | None:
    data = _get(f'https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data')
    book = data.get(f'ISBN:{isbn}')
    if not book:
        return None
    title = book.get('title', '')
    if book.get('subtitle'):
        title += f": {book['subtitle']}"
    return {
        'Title': title,
        'AuthorList': [a['name'] for a in book.get('authors', []) if a.get('name')],
        'PageCount': book.get('number_of_pages'),
        'Publisher': ', '.join(p['name'] for p in book.get('publishers', []) if p.get('name')),
        'Year': book.get('publish_date', ''),
        'Source': 'Open Library',
    }


def _google_books(isbn: str) -> dict | None:
    data = _get('https://www.googleapis.com/books/v1/volumes?q=' + urllib.parse.quote(f'isbn:{isbn}'))
    items = data.get('items') or []
    if not items:
        return None
    info = items[0].get('volumeInfo', {})
    title = info.get('title', '')
    if info.get('subtitle'):
        title += f": {info['subtitle']}"
    return {
        'Title': title,
        'AuthorList': info.get('authors', []),
        'PageCount': info.get('pageCount'),
        'Publisher': info.get('publisher', ''),
        'Year': info.get('publishedDate', ''),
        'Source': 'Google Books',
    }


def lookup(isbn: str, isbndb_key: str = '') -> dict | None:
    """Return a dict of book details, or None if no source knows the ISBN. Raises on network errors."""
    isbn = clean(isbn)
    if len(isbn) not in (10, 13):
        raise ValueError('An ISBN has 10 or 13 digits.')
    sources = [_google_books, _open_library]
    if isbndb_key:
        sources.insert(0, lambda code: _isbndb(code, isbndb_key))
    errors = []
    for source in sources:
        try:
            found = source(isbn)
            if found and found['Title']:
                return found
        except OSError as e:  # network problem with one source; try the next
            errors.append(e)
    if len(errors) == len(sources):
        raise ConnectionError('Could not reach any book database. Check the internet connection.')
    return None
