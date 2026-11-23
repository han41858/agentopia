"""Finalize a trusted AI development result without executing PR code."""

import base64
import json
import os
import re
import subprocess
import time
from pathlib import Path

REPO = "han41858/agentopia"


def api(path, *, publisher=False, pages=False, method="GET", **fields):
    env = os.environ.copy()
    if publisher:
        env["GH_TOKEN"] = env["AI_AUTOMATION_TOKEN"]
    args = ["gh", "api", "--method", method, path]
    if pages:
        args += ["--paginate", "--slurp"]
    for key, value in fields.items():
        args += ["-f", f"{key}={value}"]
    result = json.loads(subprocess.check_output(args, env=env))
    return [item for page in result for item in page] if pages else result


def repo(path, **options):
    return api(f"repos/{REPO}/{path}", **options)


def ready_state(issue):
    comments = repo(f"issues/{issue}/comments?per_page=100", pages=True)
    for comment in reversed(comments):
        if comment["user"]["login"] != "github-actions[bot]":
            continue
        marker = re.search(r"<!-- agentopia-ai-state:([A-Za-z0-9+/=]+) -->$", comment["body"])
        if marker:
            state = json.loads(base64.b64decode(marker[1]))
            head = state.get("head")
            if (state.get("issue") == issue and state.get("status") == "ready"
                    and re.fullmatch(r"[0-9a-f]{40}", head or "")
                    and {"head": head, "result": {"status": "pass"}} in state.get("reviews", [])):
                return state
            break
    return None


def eligible(issue):
    data = repo(f"issues/{issue}")
    labels = {label["name"] for label in data["labels"]}
    return data["state"] == "open" and "ai:develop" in labels and "ai:stop" not in labels


def complete(issue, run_id):
    if not eligible(issue):
        return
    state = ready_state(issue)
    if not state or (run_id and state["runId"] != run_id):
        print("No matching successful review.")
        return
    head = state["head"]
    branch = f"ai/issue-{issue}-codex"
    pulls = repo(f"pulls?state=all&base=dev&head=han41858:{branch}")
    matches = [p for p in pulls if p["head"]["sha"] == head
               and p["head"]["repo"] and p["head"]["repo"]["full_name"] == REPO
               and f"<!-- agentopia-ai-issue:{issue} -->" in (p["body"] or "")]
    if len(matches) != 1:
        raise RuntimeError("Reviewed PR or commit changed.")
    pull = matches[0]
    number = pull["number"]
    if not pull["merged_at"]:
        if pull["state"] != "open":
            return
        for _ in range(90):
            runs = repo(f"actions/workflows/ci.yml/runs?event=pull_request&head_sha={head}&branch={branch}")["workflow_runs"]
            ci = next((r for r in runs if any(p["number"] == number for p in r["pull_requests"])), None)
            if ci and ci["status"] == "completed":
                if ci["conclusion"] != "success":
                    raise RuntimeError(f"CI did not pass: {ci['html_url']}")
                break
            time.sleep(10)
        else:
            raise RuntimeError("CI timed out. Retry AI completion after CI passes.")
        if not eligible(issue) or ready_state(issue) != state:
            return
        current = repo(f"pulls/{number}")
        if (current["head"]["sha"] != head or current["base"]["ref"] != "dev"
                or current["base"]["sha"] != state["base"] or current["state"] != "open"):
            raise RuntimeError("PR or dev changed since review.")
        if current["draft"]:
            api("graphql", publisher=True, method="POST",
                query="mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}",
                id=current["node_id"])
        try:
            result = repo(f"pulls/{number}/merge", publisher=True, method="PUT",
                          sha=head, merge_method="squash", commit_title=f"{current['title']} (#{number})")
            if not result.get("merged"):
                raise RuntimeError("GitHub did not confirm the merge.")
        except (subprocess.CalledProcessError, ValueError, RuntimeError):
            confirmed = repo(f"pulls/{number}")
            if not confirmed["merged_at"] or confirmed["head"]["sha"] != head or confirmed["base"]["ref"] != "dev":
                raise
    if eligible(issue):
        try:
            repo(f"issues/{issue}", method="PATCH", state="closed", state_reason="completed")
        except (subprocess.CalledProcessError, ValueError):
            confirmed = repo(f"issues/{issue}")
            if (confirmed["state"], confirmed["state_reason"]) != ("closed", "completed"):
                raise
    print(f"PR #{number} merged, issue #{issue} completed.")


if __name__ == "__main__":
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    run = event.get("workflow_run")
    if run:
        match = re.fullmatch(r"AI development for Issue #(\d+)", run["display_title"])
        if match and run["head_repository"]["full_name"] == REPO:
            complete(int(match[1]), run["id"])
    else:
        complete(int(os.environ["AI_ISSUE"]), None)
