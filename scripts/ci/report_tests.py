#!/usr/bin/env python3
"""
Turns a pytest JUnit XML file into GitHub annotations and a job summary, so
each failing check shows its name and reason on the job. The device
checklist page (device-checklist.html) reads these annotations from the
GitHub API to show what failed.

Usage: python scripts/ci/report_tests.py results.xml "iPhone"
"""
import os
import sys
import xml.etree.ElementTree as ET

MAX_ANNOTATIONS = 10  # GitHub shows at most 10 error annotations per step


def escape(text):
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def main():
    path, label = sys.argv[1], sys.argv[2]
    if not os.path.exists(path):
        print(f"::error title={label}::The tests did not run (no results file).")
        return
    root = ET.parse(path).getroot()
    passed, failed, skipped = 0, [], 0
    for case in root.iter("testcase"):
        name = case.get("name", "")
        problem = case.find("failure")
        if problem is None:
            problem = case.find("error")
        if problem is not None:
            reason = (problem.get("message") or problem.text or "Failed").strip().split("\n")[0]
            failed.append((name, reason[:300]))
        elif case.find("skipped") is not None:
            skipped += 1
        else:
            passed += 1

    for name, reason in failed[:MAX_ANNOTATIONS]:
        print(f"::error title={escape(name)}::{escape(reason)}")
    if len(failed) > MAX_ANNOTATIONS:
        print(f"::error title=More failures::{len(failed) - MAX_ANNOTATIONS} more failed, see the job log.")

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as out:
            out.write(f"## {label}: {passed} passed, {len(failed)} failed, {skipped} skipped\n\n")
            for name, reason in failed:
                out.write(f"- `{name}`: {reason}\n")


if __name__ == "__main__":
    main()
