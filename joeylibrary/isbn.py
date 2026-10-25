"""Look up book details by ISBN: Open Library first, Google Books as a fallback."""
import json
import re
import urllib.parse
import urllib.request

USER_AGENT = 'JoeyLibrary/1.0 (personal home library app)'


def clean(isbn: str) -> str:
    return re.sub(r'[^0-9Xx]', '', isbn or '').upper()


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp)


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


def lookup(isbn: str) -> dict | None:
    """Return a dict of book details, or None if no source knows the ISBN. Raises on network errors."""
    isbn = clean(isbn)
    if len(isbn) not in (10, 13):
        raise ValueError('An ISBN has 10 or 13 digits.')
    errors = []
    for source in (_open_library, _google_books):
        try:
            found = source(isbn)
            if found and found['Title']:
                return found
        except OSError as e:  # network problem with one source; try the next
            errors.append(e)
    if len(errors) == 2:
        raise ConnectionError('Could not reach Open Library or Google Books. Check the internet connection.')
    return None
