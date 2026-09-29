"""Split a book's text file (a Shamela-style export) into one file per page:
<book>/ar/1.txt ... <book>/ar/N.txt, in a folder named after the text file,
next to it.

The export has no page markers, but a page with footnotes ends with them:

    ...the page's text, with note markers like (1)...
    __________
    (1) the first note.
    (2) the second note.
    the next page's first paragraph...

so a page ends after its footnote block - the separator (exactly
FOOTNOTE_SEPARATOR; longer runs of underscores are section breaks, not
footnotes) and the numbered notes after it. The first line that isn't the
next note in sequence ((1), (2), ... - a blank line, a paragraph, or a
"(1)" that restarts the numbering) starts the next page. That boundary
is always kept.

Pages without footnotes can't be told apart that way, so they run on into
the next page's footnote block. Those long runs are split by size instead:
the typical page is the median length of the book's footnote-ended chunks
(printed pages hold roughly the same amount of text), and a chunk over
LONG_CHUNK_FACTOR times that is cut into round(length / typical) pages of
about equal length - at the paragraph (line) end nearest each cut, or the
nearest sentence end when no paragraph ends close by. Cuts only fall
before the paragraph holding the chunk's first note marker, so the page
its footnotes belong to keeps them.

Run from the repo root:
  python3 scripts/split_book_pages.py "/path/to/<book>.txt"
  --force   replace an existing ar/ folder
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

FOOTNOTE_SEPARATOR = "_" * 10
LONG_CHUNK_FACTOR = 1.5  # chunks longer than this many typical pages get split
PARAGRAPH_CUT_TOLERANCE = 0.25  # of a page: how far to look for a paragraph end
_NOTE_RE = re.compile(r"^\((\d+)\)")
_SENTENCE_END_RE = re.compile(r"[.!?؟][\"»”')\]]*[ \t]+")


def split_at_footnotes(text: str) -> list[str]:
    """The book's text (without its BOM), split after every footnote block."""
    pages: list[list[str]] = [[]]
    last_note = None  # the number of the last note in the current footnote block
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        if last_note is not None:
            match = _NOTE_RE.match(line)
            if match and int(match.group(1)) == last_note + 1:
                last_note += 1
                pages[-1].append(line)
                continue
            if last_note > 0:  # the notes are over, so is the page
                pages.append([])
                last_note = None
            elif line.strip():  # a separator with no notes after it: not a page end
                last_note = None
        if line.strip() == FOOTNOTE_SEPARATOR:
            last_note = 0
        pages[-1].append(line)
    return [page for page in ("\n".join(lines).strip("\n") for lines in pages) if page.strip()]


def typical_page_size(chunks: list[str]) -> int:
    """The median length of the chunks that end with footnotes - each one a
    single page, since a footnote block always ends its page."""
    sizes = sorted(len(c) for c in chunks if FOOTNOTE_SEPARATOR in c.split("\n"))
    return sizes[len(sizes) // 2] if sizes else 0


def split_long_chunk(chunk: str, page_size: int) -> list[str]:
    """The chunk as one page, or - if it's much longer than `page_size` -
    cut into pages of about equal length, the last keeping the footnotes."""
    count = round(len(chunk) / page_size) if page_size else 1
    if len(chunk) <= LONG_CHUNK_FACTOR * page_size or count < 2:
        return [chunk]

    lines = chunk.split("\n")
    separator = lines.index(FOOTNOTE_SEPARATOR) if FOOTNOTE_SEPARATOR in lines else len(lines)
    body = "\n".join(lines[:separator])
    notes = chunk[len(body) :]
    # No cut after the paragraph where the notes' markers start.
    marker = body.find("(1)") if notes else -1
    limit = body.rfind("\n", 0, marker) + 1 if marker >= 0 else len(body)

    line_ends = [i + 1 for i, ch in enumerate(body) if ch == "\n" and 0 < i + 1 <= limit]
    sentence_ends = [m.end() for m in _SENTENCE_END_RE.finditer(body, 0, limit)]
    cuts: list[int] = []
    for k in range(1, count):
        target = k * len(chunk) / count
        nearest = [
            min(candidates, key=lambda c: abs(c - target))
            for candidates in (line_ends, sentence_ends)
            if candidates
        ]
        if not nearest:
            break
        cut = nearest[0]
        if abs(cut - target) > PARAGRAPH_CUT_TOLERANCE * page_size and len(nearest) > 1:
            cut = min(nearest, key=lambda c: abs(c - target))
        if cut - (cuts[-1] if cuts else 0) >= page_size / 3:
            cuts.append(cut)

    bounds = [0, *cuts, len(chunk)]
    pieces = [chunk[a:b].strip() for a, b in zip(bounds, bounds[1:], strict=False)]
    return [piece for piece in pieces if piece]


def split_pages(text: str) -> tuple[list[str], int, int]:
    """The book's pages, the typical page size used, and how many long
    chunks were split by size."""
    chunks = split_at_footnotes(text)
    page_size = typical_page_size(chunks)
    pages: list[str] = []
    split = 0
    for chunk in chunks:
        pieces = split_long_chunk(chunk, page_size)
        split += len(pieces) > 1
        pages.extend(pieces)
    return pages, page_size, split


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("text_file", type=Path, help="the book's .txt file")
    parser.add_argument("--force", action="store_true", help="replace an existing ar/ folder")
    args = parser.parse_args()

    source: Path = args.text_file
    if not source.is_file():
        sys.exit(f"{source} is not a file.")
    out_dir = source.with_suffix("") / "ar"
    if out_dir.exists():
        if not args.force:
            sys.exit(f"{out_dir} already exists - pass --force to replace it.")
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    pages, page_size, split = split_pages(source.read_text(encoding="utf-8-sig"))
    for number, page in enumerate(pages, start=1):
        (out_dir / f"{number}.txt").write_text(page + "\n", encoding="utf-8")

    with_notes = sum(1 for page in pages if FOOTNOTE_SEPARATOR in page.split("\n"))
    longest = max(range(len(pages)), key=lambda i: len(pages[i]))
    print(f"Wrote {len(pages)} page(s) to {out_dir}")
    print(f"  {with_notes} end with footnotes (typical page: {page_size:,} characters).")
    others = len(pages) - with_notes
    print(f"  {split} longer run(s) without footnotes were split by size into the other {others}.")
    print(f"  Longest: {longest + 1}.txt ({len(pages[longest]):,} characters).")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrupted - the ar/ folder may be incomplete; re-run with --force to replace it.")
        raise SystemExit(130) from None
