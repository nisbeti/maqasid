"""
Translate every page of a book split by split_book_pages.py - <book>/ar/N.txt
- into English, as <book>/en/N.txt, using OpenAI's Batch API, looping
submit -> status -> fetch until every page is translated. Standalone: it
doesn't touch the database, only files.

Each cycle: submit every page that has no en/ file and isn't already in a
batch (packed into batches under MAX_ENQUEUED_TOKENS), wait
POLL_INTERVAL_SECONDS, then check status. If any batch is still in flight,
wait another POLL_INTERVAL_SECONDS and check again - repeat until every
batch has reached a terminal status. Then fetch (writing each translated
page, logging whatever failed), and either start a new cycle (if pages are
still untranslated - e.g. deferred past this run's token budget, or failed)
or stop (once every page has its en/ file, or a cycle translated nothing).

A page longer than MAX_TASK_CHARS (e.g. a book's index, which has no
footnotes for split_book_pages.py to split it on) is translated in parts,
split at line boundaries, and written once every part is back.

In-flight batches are kept in storage/app/private/batch_files/pages/<book>.json, so the
script is safe to Ctrl+C and re-run - it picks up the batches it left
running. A page is done once its en/ file exists; delete one to have it
translated again.

SETUP: pip install openai tiktoken, and OPENAI_API_KEY in the repo's .env.

USAGE (run from the repo root):
  python3 scripts/translate_book_pages.py "/path/to/<book>"   # the folder holding ar/
"""

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import tiktoken
from openai import OpenAI

# ---- CONFIG ------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / ".env"
MODEL = "gpt-4o-mini"
TEMPERATURE = 0.2
MAX_TASKS_PER_BATCH = 50_000  # OpenAI Batch API cap
# Stay under the account's enqueued-token limit for the model's batch queue.
MAX_ENQUEUED_TOKENS = 1_700_000
MAX_TASK_CHARS = 6_000  # longer pages are translated in parts
MAX_OUTPUT_TOKENS = 16_000  # gpt-4o-mini's output limit is 16,384
POLL_INTERVAL_SECONDS = 5 * 60
BATCH_FILES_DIR = ROOT / "storage" / "app" / "private" / "batch_files" / "pages"
# -------------------------------------------------------------------------

TERMINAL_BATCH_STATUSES = {"completed", "failed", "expired", "cancelled"}

SYSTEM_PROMPT = """You are a professional translator of classical and \
Modern Standard Arabic Islamic scholarship (Qur'an, hadith, fiqh, usul \
al-fiqh, history) into English.

You will receive one page (or part of a page) of an Arabic book. Translate \
ALL of it into clear, accurate, natural English. Never summarize, omit, \
add commentary, or complete a sentence the page cuts off - pages often \
begin or end mid-sentence; translate them exactly as they stand.

Formatting:
- Keep the layout: one English paragraph per Arabic line, and blank lines \
only where the Arabic has them - never add blank lines between paragraphs \
or around the footnotes.
- Keep footnote markers such as (1) at the same places in the text.
- A line of underscores (__________) separates the page's text from its \
footnotes: copy it unchanged, then translate each footnote, keeping its \
(1), (2) ... number at the start.
- Qur'anic verses appear in braces { }: translate their meaning and keep \
the braces, in normal sentence case (never all capitals). Keep quotation \
marks around quoted hadith and sayings.
- Some verses contain garbled characters (a broken Qur'anic font); if you \
can recognize the verse, translate it as intended, otherwise write \
[illegible].

Terms and names:
- Give technical terms their standard English rendering, with the \
transliterated Arabic in parentheses the first time it appears on the page, \
e.g. "public interest (maslaha)", "objectives of the Sharia (maqasid \
al-sharia)".
- Write names and book titles in their usual English transliteration \
(al-Shatibi, al-Muwafaqat), without diacritics.
- Render honorifics in English: "(peace and blessings be upon him)", \
"(may Allah be pleased with him)", "Exalted is He".

Return only the translation."""

_ENCODER = tiktoken.encoding_for_model(MODEL)
_FIXED_TASK_OVERHEAD_TOKENS = len(_ENCODER.encode(SYSTEM_PROMPT)) + 30


def estimate_task_tokens(text: str) -> int:
    """Rough estimate of one task's enqueued tokens - only used to stay under
    MAX_ENQUEUED_TOKENS, not for exact accounting."""
    return _FIXED_TASK_OVERHEAD_TOKENS + len(_ENCODER.encode(text))


def load_config(path: Path) -> dict:
    config = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip().strip('"').strip("'")
    return config


def make_openai_client(config: dict) -> OpenAI:
    api_key = config.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit(f"OPENAI_API_KEY is not set in {ENV_FILE}")
    return OpenAI(api_key=api_key)


class Book:
    """A book's ar/ and en/ folders, plus its batch state file."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.ar = folder / "ar"
        self.en = folder / "en"
        self.state_file = BATCH_FILES_DIR / f"{folder.name}.json"
        self.batches: dict[str, dict] = {}
        if self.state_file.exists():
            self.batches = json.loads(self.state_file.read_text(encoding="utf-8"))["batches"]

    def save(self) -> None:
        BATCH_FILES_DIR.mkdir(parents=True, exist_ok=True)
        state = {"book": str(self.folder), "batches": self.batches}
        tmp = self.state_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.state_file)

    def page_numbers(self) -> list[int]:
        return sorted(int(p.stem) for p in self.ar.glob("*.txt") if p.stem.isdigit())

    def queued_pages(self) -> set[int]:
        """Pages in a batch whose results haven't been fetched yet."""
        return {page for b in self.batches.values() if not b.get("applied") for page in b["pages"]}

    def pending_pages(self) -> list[int]:
        queued = self.queued_pages()
        return [
            n
            for n in self.page_numbers()
            if n not in queued and not (self.en / f"{n}.txt").exists()
        ]

    def has_in_flight_batches(self) -> bool:
        return any(b["status"] not in TERMINAL_BATCH_STATUSES for b in self.batches.values())


def page_parts(text: str) -> list[str]:
    """The page as one part, or split at line boundaries into parts of up to
    MAX_TASK_CHARS (a single longer line stays whole)."""
    if len(text) <= MAX_TASK_CHARS:
        return [text]
    parts: list[str] = []
    current: list[str] = []
    size = 0
    for line in text.split("\n"):
        if current and size + len(line) + 1 > MAX_TASK_CHARS:
            parts.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    parts.append("\n".join(current))
    return parts


def read_page(book: Book, page: int) -> str:
    return (book.ar / f"{page}.txt").read_text(encoding="utf-8").strip()


def tidy(translation: str, arabic: str) -> str:
    """Strip trailing spaces, and the blank lines the model tends to add
    between paragraphs when the Arabic has none."""
    lines = [line.rstrip() for line in translation.strip("\n").split("\n")]
    if "" not in (line.strip() for line in arabic.split("\n")):
        lines = [line for line in lines if line]
    return "\n".join(lines)


def build_task(custom_id: str, text: str) -> dict:
    return {
        "custom_id": custom_id,
        "method": "POST",
        "url": "/v1/chat/completions",
        "body": {
            "model": MODEL,
            "temperature": TEMPERATURE,
            "max_tokens": MAX_OUTPUT_TOKENS,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": text},
            ],
        },
    }


def submit_chunk(
    book: Book, client: OpenAI, tasks: list[tuple[int, int, str]], tokens: int, index: int
) -> None:
    """Submit one batch of (page, part, text) tasks."""
    BATCH_FILES_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    input_path = BATCH_FILES_DIR / f"{book.folder.name}_{stamp}_chunk{index}_input.jsonl"
    with open(input_path, "w", encoding="utf-8") as f:
        for page, part, text in tasks:
            f.write(json.dumps(build_task(f"page-{page}-{part}", text), ensure_ascii=False) + "\n")

    with open(input_path, "rb") as f:
        batch_file = client.files.create(file=f, purpose="batch")
    batch_job = client.batches.create(
        input_file_id=batch_file.id, endpoint="/v1/chat/completions", completion_window="24h"
    )
    pages = sorted({page for page, _, _ in tasks})
    book.batches[batch_job.id] = {
        "status": batch_job.status,
        "input_file_id": batch_file.id,
        "pages": pages,
        "parts": {str(page): sum(1 for p, _, _ in tasks if p == page) for page in pages},
        "enqueued_tokens": tokens,
        "submitted_at": datetime.now(UTC).isoformat(),
    }
    book.save()
    print(
        f"[submit] chunk {index}: {len(pages)} page(s), {len(tasks)} task(s), ~{tokens} token(s) "
        f"-> batch {batch_job.id} (status={batch_job.status})"
    )


def cmd_submit(book: Book, client: OpenAI) -> None:
    pending = book.pending_pages()
    print(f"[submit] {len(pending)} page(s) need translation.")
    if not pending:
        return

    in_flight_tokens = sum(
        b["enqueued_tokens"]
        for b in book.batches.values()
        if b["status"] not in TERMINAL_BATCH_STATUSES
    )
    remaining_budget = MAX_ENQUEUED_TOKENS - in_flight_tokens

    # Greedily pack whole pages (all of a page's parts go in the same batch)
    # into batches, within the token budget left across this whole submit.
    index = 0
    chunk: list[tuple[int, int, str]] = []
    chunk_tokens = 0
    deferred = 0
    for page in pending:
        text = read_page(book, page)
        tasks = [(page, part, t) for part, t in enumerate(page_parts(text), start=1)]
        est = sum(estimate_task_tokens(t) for _, _, t in tasks)
        if chunk_tokens + est > remaining_budget or len(chunk) + len(tasks) > MAX_TASKS_PER_BATCH:
            if chunk:
                submit_chunk(book, client, chunk, chunk_tokens, index)
                index += 1
                remaining_budget -= chunk_tokens
                chunk, chunk_tokens = [], 0
            if est > remaining_budget:
                deferred += 1
                continue
        chunk.extend(tasks)
        chunk_tokens += est

    if chunk:
        submit_chunk(book, client, chunk, chunk_tokens, index)
    if deferred:
        print(f"[submit] {deferred} page(s) deferred to a later cycle (token budget).")


def cmd_status(book: Book, client: OpenAI) -> None:
    for batch_id, info in book.batches.items():
        if info["status"] in TERMINAL_BATCH_STATUSES:
            continue
        batch = client.batches.retrieve(batch_id)
        info.update(
            status=batch.status,
            output_file_id=batch.output_file_id,
            error_file_id=batch.error_file_id,
        )
        book.save()
        counts = batch.request_counts
        counts_str = (
            f"completed={counts.completed}, failed={counts.failed}, total={counts.total}"
            if counts
            else "counts not yet available"
        )
        print(f"[status] {batch_id}: {batch.status} ({counts_str})")


def cmd_fetch(book: Book, client: OpenAI) -> int:
    """Write the pages from every finished, not-yet-fetched batch. Returns
    how many pages were written."""
    written = 0
    book.en.mkdir(exist_ok=True)
    for batch_id, info in book.batches.items():
        if info.get("applied") or info["status"] not in TERMINAL_BATCH_STATUSES:
            continue
        if (
            info["status"] == "completed"
            and not info.get("output_file_id")
            and not info.get("error_file_id")
        ):
            print(f"[fetch] {batch_id}: completed but no output file yet - skipping.")
            continue

        translations: dict[int, dict[int, str]] = {}
        if info.get("output_file_id"):
            content = client.files.content(info["output_file_id"]).text
            (BATCH_FILES_DIR / f"{batch_id}_output.jsonl").write_text(content, encoding="utf-8")
            for line in content.splitlines():
                if not line.strip():
                    continue
                record = json.loads(line)
                _, page, part = record["custom_id"].split("-")
                if record.get("error") or record["response"]["status_code"] != 200:
                    problem = record.get("error") or record["response"]
                    print(f"[fetch] page {page} part {part}: error: {problem}", file=sys.stderr)
                    continue
                choice = record["response"]["body"]["choices"][0]
                if choice["finish_reason"] != "stop":
                    print(
                        f"[fetch] page {page} part {part}: stopped early "
                        f"({choice['finish_reason']}) - will be retried.",
                        file=sys.stderr,
                    )
                    continue
                translations.setdefault(int(page), {})[int(part)] = choice["message"]["content"]

        if info.get("error_file_id"):
            errors = client.files.content(info["error_file_id"]).text
            error_path = BATCH_FILES_DIR / f"{batch_id}_errors.jsonl"
            error_path.write_text(errors, encoding="utf-8")
            count = sum(1 for line in errors.splitlines() if line.strip())
            if count:
                print(
                    f"[fetch] {batch_id}: {count} task(s) failed - see {error_path}.",
                    file=sys.stderr,
                )

        for page in info["pages"]:
            parts = translations.get(page, {})
            if len(parts) != info["parts"][str(page)]:
                continue  # something missing: the page stays pending for the next cycle
            text = "\n".join(
                tidy(parts[k], arabic)
                for k, arabic in enumerate(page_parts(read_page(book, page)), start=1)
            )
            (book.en / f"{page}.txt").write_text(text.strip() + "\n", encoding="utf-8")
            written += 1

        info["applied"] = True
        book.save()
        print(f"[fetch] {batch_id} ({info['status']}): wrote {written} page(s) so far.")
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("book", type=Path, help="the book's folder (the one holding ar/)")
    args = parser.parse_args()

    book = Book(args.book.resolve())
    if not book.page_numbers():
        sys.exit(f"No pages found in {book.ar} - run split_book_pages.py first.")

    client = make_openai_client(load_config(ENV_FILE))
    cycle = 0
    while True:
        cycle += 1
        print(f"\n[loop] cycle {cycle}: submitting.")
        cmd_submit(book, client)

        while book.has_in_flight_batches():
            minutes = POLL_INTERVAL_SECONDS // 60
            print(f"[loop] cycle {cycle}: waiting {minutes} minute(s) before checking status.")
            time.sleep(POLL_INTERVAL_SECONDS)
            cmd_status(book, client)

        print(f"[loop] cycle {cycle}: all batches terminal - fetching.")
        written = cmd_fetch(book, client)

        pending = book.pending_pages()
        if not pending:
            print(f"\n[loop] every page is translated - see {book.en}.")
            break
        if written == 0:
            print(
                f"\n[loop] cycle {cycle} translated nothing and {len(pending)} page(s) are "
                "still pending - stopping; see the errors above.",
                file=sys.stderr,
            )
            break
        print(
            f"[loop] cycle {cycle}: {len(pending)} page(s) still pending - starting another cycle."
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[loop] stopped - in-flight batches keep running; re-run to pick them up.")
        raise SystemExit(130) from None
