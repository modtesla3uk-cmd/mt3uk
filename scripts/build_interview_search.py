#!/usr/bin/env python3
"""
Writes data/interview-search.json: for each Owner Interview page, the words
from its mods answers and lists, so the site search (js/search.js) can find
an interview by what's on the car (e.g. "Robot Hacker", "yoke", "Ohlins").

It covers the answers under headings about mods, upgrades or modifying,
and every bullet list in the interview. js/search.js only uses an entry
once that interview's publish date has come.

Run it after adding or editing an interview:

    python scripts/build_interview_search.py
    python scripts/build_interview_search.py --check   # fail if out of date

tests/test_search_index.py fails if the file is out of date.
"""
import html
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "interview-search.json"
MOD_HEADING = re.compile(r"mod|upgrade|set ?up|track|brake|suspension|tyre|wheel", re.I)
STOP = set("""
a an and are as at be been but by can for from had has have he her his i i'd i'll i'm i've if in into is it it's
its just like me more most my no not now of on one or our out over really so some than that the their them then
there they this to too up us very was we were what when which who will with would you your all also any after
about before being both did do does done down each even get got gone how made make many much new off only other
own same should since still such take than these those through under until well where while why yet
""".split())


def text(fragment):
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    return html.unescape(fragment)


def words_for(page):
    source = page.read_text(encoding="utf-8")
    m = re.search(r'<article class="interview">(.*?)</article>', source, re.S)
    if not m:
        return []
    article = m.group(1)
    chunks = re.findall(r"<li>(.*?)</li>", article, re.S)
    # Answers under headings about mods, up to the next heading.
    for heading, body in re.findall(r'<h2 class="interview-q">(.*?)</h2>(.*?)(?=<h2 class="interview-q">|$)', article, re.S):
        if MOD_HEADING.search(text(heading)):
            chunks.append(re.sub(r"<figure.*?</figure>", " ", body, flags=re.S))
    words = []
    for chunk in chunks:
        for w in re.findall(r"[^\W_][\w+./-]*", text(chunk).replace("’", "'")):
            w = w.strip(".-/").lower()
            # Accents dropped too, so "ohlins" finds "Öhlins".
            plain = unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode()
            for v in (w, plain):
                if len(v) < 2 or v in STOP or v in words:
                    continue
                words.append(v)
    return words


def build():
    interviews = json.loads((ROOT / "data" / "interviews.json").read_text(encoding="utf-8"))["interviews"]
    out = {}
    for iv in interviews:
        page = ROOT / iv["url"]
        if page.exists():
            out[iv["url"]] = " ".join(words_for(page))
    return json.dumps(out, indent=2, ensure_ascii=False) + "\n"


def main():
    content = build()
    if "--check" in sys.argv[1:]:
        if not OUT.exists() or OUT.read_text(encoding="utf-8") != content:
            print("data/interview-search.json is out of date. Run: python scripts/build_interview_search.py")
            sys.exit(1)
        print("data/interview-search.json is up to date.")
        return
    OUT.write_text(content, encoding="utf-8")
    print("Wrote", OUT)


if __name__ == "__main__":
    main()
