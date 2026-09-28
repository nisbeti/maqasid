#!/usr/bin/env python3
"""Convert ar/*.txt and en/*.txt into matching .html files (source .txt files are kept)."""
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LANGS = {"ar": "rtl", "en": "ltr"}

TEMPLATE = """<!DOCTYPE html>
<html lang="{lang}" dir="{dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{page}</title>
</head>
<body>
<article class="page" data-page="{page}">
{body}
</article>
</body>
</html>
"""


# Pages from here on hold the verse, hadith and contents indexes. Their entries
# end in "... <page>, <page>" and those page numbers become links into the reader.
INDEX_FIRST_PAGE = 700
INDEX_REFS = re.compile(r"^(?P<head>.*?\.\.\.\s*)(?P<refs>\d+(?:\s*[،,]\s*\d+)*)$")


def link_refs(line: str, lang: str) -> str:
    m = INDEX_REFS.match(line)
    if not m:
        return html.escape(line)
    refs = re.sub(
        r"\d+",
        lambda n: f'<a class="ref" href="#{lang}/{n.group()}">{n.group()}</a>',
        html.escape(m.group("refs")),
    )
    return html.escape(m.group("head")) + refs


def convert(txt: Path, lang: str, direction: str) -> None:
    lines = [line.strip() for line in txt.read_text(encoding="utf-8").splitlines() if line.strip()]
    if int(txt.stem) >= INDEX_FIRST_PAGE:
        paras = [f"<p>{link_refs(line, lang)}</p>" for line in lines]
    else:
        paras = [f"<p>{html.escape(line)}</p>" for line in lines]
    out = TEMPLATE.format(lang=lang, dir=direction, page=txt.stem, body="\n".join(paras))
    txt.with_suffix(".html").write_text(out, encoding="utf-8")


def main() -> None:
    for lang, direction in LANGS.items():
        files = sorted((ROOT / lang).glob("*.txt"), key=lambda p: int(p.stem))
        for txt in files:
            convert(txt, lang, direction)
        print(f"{lang}: converted {len(files)} files")


if __name__ == "__main__":
    main()
