#!/usr/bin/env python3
"""Convert ar/*.txt and en/*.txt into matching .html files (source .txt files are kept)."""
import html
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


def convert(txt: Path, lang: str, direction: str) -> None:
    lines = txt.read_text(encoding="utf-8").splitlines()
    paras = [f"<p>{html.escape(line.strip())}</p>" for line in lines if line.strip()]
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
