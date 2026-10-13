# maqasid

المقاصد عند الإمام الشاطبي, in Arabic and English, at https://maqasid.info.

This site is built by the book engine (`../new-book-engine`), like every
other book: edit `ar/N.txt`, `en/N.txt`, `book.json` or `contents.json`,
then from the engine folder run

    python3 scripts/build_site.py ../maqasid
    python3 scripts/check_site.py ../maqasid

Don't edit `index.html`, `reader.html`, `assets/` or the `ar/` / `en/`
`.html` files: the build overwrites them. Design changes go in the
engine's `template/`.
