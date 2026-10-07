"""The daily changes email (scripts/daily_changes.py, .github/workflows/daily-changes-email.yml): the day's commits
to main, bot syncs and trailers left out, with "Next:" and "Suggest:" lines gathered into the two next steps lists."""
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import daily_changes  # noqa: E402


def git(repo, *args, author="Richard <r@example.com>"):
    name, email = author[:-1].split(" <")
    env = {"GIT_AUTHOR_NAME": name, "GIT_AUTHOR_EMAIL": email, "GIT_COMMITTER_NAME": name, "GIT_COMMITTER_EMAIL": email, "PATH": "/usr/bin:/bin"}
    subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, env=env)


def test_the_days_changes_become_one_email(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "commit", "-q", "--allow-empty", "-m", "Laps: an announcement on Sessions\n\n- One line on Sessions\nNext: Write your first announcement\nSuggest: Point members at Compare pads\n\nCo-Authored-By: Someone <x@example.com>\nClaude-Session: https://example.com/s")
    git(tmp_path, "commit", "-q", "--allow-empty", "-m", "Regenerate gallery and track days manifests, and sitemap", author="github-actions[bot] <bot@example.com>")
    found = daily_changes.commits(ref="main", cwd=tmp_path)
    assert [c["subject"] for c in found] == ["Laps: an announcement on Sessions"]
    mail = daily_changes.build(found, "The tests passed on all 2 of today's runs: https://example.com", datetime(2026, 10, 7, tzinfo=timezone.utc))
    assert mail["subject"] == "MT3UK and Laps: changes on 7 October 2026"
    text = mail["text"]
    assert "- Laps: an announcement on Sessions\n  - One line on Sessions" in text
    assert "YOUR NEXT STEPS\n- Write your first announcement\n- The tests passed" in text
    assert "MY SUGGESTED NEXT STEPS\n- Point members at Compare pads" in text
    assert "Co-Authored-By" not in text and "Claude-Session" not in text and "Regenerate" not in text
    assert "—" not in text


def test_no_changes_no_email(tmp_path):
    git(tmp_path, "init", "-q", "-b", "main")
    git(tmp_path, "commit", "-q", "--allow-empty", "-m", "Regenerate gallery and track days manifests, and sitemap", author="github-actions[bot] <bot@example.com>")
    assert daily_changes.build(daily_changes.commits(ref="main", cwd=tmp_path)) is None
