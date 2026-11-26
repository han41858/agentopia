"""GitHub access and trusted automation progress comments."""
import base64
import json
import os
from pathlib import Path
import re
import subprocess

REPO = "han41858/agentopia"


def api(path, *, publisher=False, pages=False, method="GET", **fields):
    env = os.environ.copy()
    if publisher:
        env["GH_TOKEN"] = env["AI_AUTOMATION_TOKEN"]
    args = ["gh", "api", "--method", method, path]
    if pages:
        args += ["--paginate", "--jq", ".[] | @json"]
    for key, value in fields.items():
        args += ["-f", f"{key}={value}"]
    response = subprocess.run(args, env=env, capture_output=True, text=True)
    if response.returncode:
        status = re.search(r"HTTP [0-9]{3}", response.stderr)
        reason = status[0] if status else f"gh exit {response.returncode}"
        raise RuntimeError(f"GitHub {method} {path.partition('?')[0]}: {reason}")
    if pages:
        return [json.loads(line) for line in response.stdout.splitlines() if line]
    return json.loads(response.stdout)


def repo(path, **options):
    return api(f"repos/{REPO}/{path}", **options)


def checkpoint(issue):
    comments = repo(f"issues/{issue}/comments?per_page=100", pages=True)
    for comment in reversed(comments):
        if comment["user"]["login"] != "github-actions[bot]":
            continue
        marker = re.search(r"<!-- agentopia-ai-state:([A-Za-z0-9+/=]+) -->$", comment["body"])
        if marker:
            state = json.loads(base64.b64decode(marker[1]))
            if state.get("issue") == issue:
                return comment, state
    return None, None


def record_event(issue, reviewed, number, key, text, *, ci=None, status=None):
    comment, latest = checkpoint(issue)
    if not latest:
        raise RuntimeError("Cannot find the trusted issue progress comment.")
    state = latest
    if status and latest == reviewed:
        state = dict(latest, status=status, phase="완료" if status == "merged" else "완료 확인", reason=text)
    payload = {"repository": REPO, "body": comment["body"], "previousAt": comment.get("updated_at"), "state": state,
               "eventState": dict(reviewed, pullNumber=number),
               "event": {"key": key, "text": text, "ci": ci}}
    script = Path(__file__).with_name("ai-development") / "journal.mjs"
    body = subprocess.run(["node", str(script)], input=json.dumps(payload), text=True,
                          capture_output=True, check=True).stdout
    if body != comment["body"]:
        repo(f"issues/comments/{comment['id']}", method="PATCH", body=body)
