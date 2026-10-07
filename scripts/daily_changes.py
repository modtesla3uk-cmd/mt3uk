"""The daily changes email (.github/workflows/daily-changes-email.yml): what was pushed to main in the last 24 hours.

Prints a JSON object { "subject": ..., "text": ... } for the worker's /admin/daily-summary route, or nothing when
there were no changes worth telling Richard about. Commits by bots (the manifest and sitemap syncs) are left out,
and so are the trailer lines of a commit message (Co-Authored-By, Claude-Session). Each change is its title and up to
six of its message's own bullet points.

Lines in a commit message that start "Next:" go under "Your next steps" (something Richard has to do himself), and
lines that start "Suggest:" under "My suggested next steps". The workflow passes the result of the day's test runs
in TESTS_RESULT, which is added to the next steps.
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

SEP = "\x1e"
TRAILERS = ("co-authored-by:", "claude-session:", "signed-off-by:")


def commits(since="24 hours ago", ref="origin/main", cwd=None):
    out = subprocess.run(["git", "log", ref, "--since=" + since, "--no-merges", "--format=%an%x1f%h%x1f%B" + SEP],
                         capture_output=True, text=True, check=True, cwd=cwd).stdout
    found = []
    for chunk in out.split(SEP):
        chunk = chunk.strip("\n")
        if not chunk.strip():
            continue
        author, sha, message = chunk.split("\x1f", 2)
        if author.endswith("[bot]"):
            continue
        lines = [l.rstrip() for l in message.strip().splitlines()]
        lines = [l for l in lines if not l.lower().startswith(TRAILERS)]
        found.append({"sha": sha, "subject": lines[0] if lines else "", "body": lines[1:]})
    return found


def build(found, tests_result="", today=None):
    if not found:
        return None
    today = today or datetime.now(timezone.utc)
    date = "%d %s" % (today.day, today.strftime("%B %Y"))
    nexts, suggests, parts = [], [], []
    for c in reversed(found):  # oldest first, as they happened
        body = []
        for line in c["body"]:
            low = line.strip().lower()
            if low.startswith("next:"):
                nexts.append(line.strip()[5:].strip())
            elif low.startswith("suggest:"):
                suggests.append(line.strip()[8:].strip())
            else:
                body.append(line)
        # Kept short: the title, and up to six of the message's own bullet points.
        points = []
        for l in body:
            if l.strip().startswith("- "):
                points.append(l.strip())
            elif points and l.startswith(" ") and l.strip():
                points[-1] += " " + l.strip()  # a bullet point wrapped onto the next line
            elif not l.strip() and points:
                points.append("")
        points = [p for p in points if p][:6]
        parts.append(c["subject"] + ("\n" + "\n".join("  " + p for p in points) if points else ""))
    if tests_result:
        nexts.append(tests_result)
    text = "Hi Richard,\n\nHere is what was pushed to the MT3UK website today (%d change%s). All of it is live.\n\n" % (len(found), "" if len(found) == 1 else "s")
    text += "\n\n".join("- " + p for p in parts)
    text += "\n\nYOUR NEXT STEPS\n" + ("\n".join("- " + n for n in nexts) if nexts else "- Nothing you need to do.")
    text += "\n\nMY SUGGESTED NEXT STEPS\n" + ("\n".join("- " + s for s in suggests) if suggests else "- None added today.")
    text += "\n\nThis email is sent each evening when there have been changes (.github/workflows/daily-changes-email.yml).\n"
    return {"subject": "MT3UK and Laps: changes on " + date, "text": text}


def main():
    result = build(commits(), os.environ.get("TESTS_RESULT", "").strip())
    if result:
        json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
