"""Publish PR-visible history from the current trusted issue checkpoint."""
import importlib.util
import os
from pathlib import Path
import re

spec = importlib.util.spec_from_file_location("completion", Path(__file__).with_name("ai-completion.py"))
completion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(completion)
repo = completion.repo
ROOT = f"https://github.com/{completion.REPO}"
BOT = "github-actions[bot]"


def pr_body(body, number, issue):
    visible = body.rsplit("<!-- agentopia-ai-state:", 1)[0].strip()
    header, divider, history = visible.partition("\n\n**진행 기록**\n")
    if not divider:
        return None
    link = f"[PR #{number}]({ROOT}/pull/{number})"
    lines = [history.splitlines()[0], ""] if history.startswith("이전 기록 일부 생략 · ") else []
    section = None
    for line in history.splitlines():
        if line.startswith("### "):
            section = line
        elif line.startswith("- ") and link in line:
            if section:
                lines.append(section)
                section = None
            lines.append(line)
    if not any(line.startswith("- ") for line in lines):
        return None
    marker = f"<!-- agentopia-pr-progress:{issue} -->"
    return header.replace(link, f"[이슈 #{issue}]({ROOT}/issues/{issue})") + divider + "\n".join(lines) + "\n\n" + marker


def sync(issue, *, closure=False):
    comment, state = completion.checkpoint(issue)
    if not state or state.get("issue") != issue:
        return
    if closure:
        source = repo(f"issues/{issue}")
        if source["state"] != "closed" or source.get("state_reason") != "not_planned":
            return
        # Only an explicit standalone reference in the source issue declares a successor.
        successors = set(re.findall(r"(?im)^Superseded by #([1-9][0-9]*)[ \t]*\r?$", source.get("body") or ""))
        status = "closed_unplanned"
        reason = "계획 없음으로 종료"
        key = status
        if len(successors) == 1:
            successor = int(successors.pop())
            if successor != issue and "pull_request" not in repo(f"issues/{successor}"):
                status = "superseded"
                reason = f"요구사항 변경으로 종료 · 후속 #{successor}"
                key = f"superseded:{successor}"
        completion.record_event(issue, state, state.get("pullNumber"), key, reason, status=status)
        comment, state = completion.checkpoint(issue)
    number = state.get("pullNumber")
    if not number:
        return
    body = pr_body(comment["body"], number, issue)
    if not body:
        return
    marker = f"<!-- agentopia-pr-progress:{issue} -->"
    comments = repo(f"issues/{number}/comments?per_page=100", pages=True)
    own = next((entry for entry in comments if entry["user"]["login"] == BOT and entry["body"].endswith(marker)), None)
    if own is None:
        repo(f"issues/{number}/comments", method="POST", body=body)
    elif own["body"] != body:
        repo(f"issues/comments/{own['id']}", method="PATCH", body=body)


if __name__ == "__main__":
    sync(int(os.environ["AI_ISSUE"]), closure=os.environ.get("AI_CLOSURE") == "1")
