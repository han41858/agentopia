"""Finalize a trusted AI development result without executing PR code."""

import base64
import hashlib
import json
import os
import re
import subprocess
import time

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


def eligible(issue, developer=None):
    data = repo(f"issues/{issue}")
    labels = {label["name"] for label in data["labels"]}
    roles = {"codex": "ai:develop", "claude": "ai:develop:claude"}
    selected = labels.intersection(roles.values())
    return (data["state"] == "open" and "ai:stop" not in labels and len(selected) == 1
            and (developer is None or roles.get(developer) in selected))


def fingerprint(*parts):
    return hashlib.sha256("\0".join(str(part or "") for part in parts).encode()).hexdigest()


def ci_feedback(ci):
    jobs = repo(f"actions/runs/{ci['id']}/attempts/{ci['run_attempt']}/jobs?per_page=100")["jobs"]
    failures = [job for job in jobs if job["conclusion"] == "failure"]
    if len(failures) == 1 and failures[0].get("name") == "Test and build" and [
        step["name"] for step in failures[0]["steps"] if step["conclusion"] == "failure"
    ] == ["Run npm run format:check"]:
        return "npm run format:check", None
    diagnostics = []
    for job in jobs:
        if job["conclusion"] != "failure":
            continue
        annotations = repo(f"check-runs/{job['id']}/annotations?per_page=100")
        for item in annotations:
            if item["annotation_level"] == "failure" and item["path"].startswith(("e2e/", "src/", "server/", "api/")):
                diagnostics.append(f"{item['path'][:250]}:{item['start_line']} {item['message'][:1200]}")
    feedback = "\n".join(diagnostics).replace("\x00", "")[:4000]
    if feedback:
        return feedback, None
    steps = [step["name"] for job in failures for step in job.get("steps", [])
             if step.get("conclusion") == "failure"]
    # Only render plain, bounded check names in the issue comment.
    names = [re.sub(r"[^a-zA-Z0-9 ./_:*'-]", "", name)[:100] for name in steps[:4]]
    label = ", ".join(filter(None, names)) or "CI"
    link = f"https://github.com/{REPO}/actions/runs/{int(ci['id'])}/attempts/{int(ci['run_attempt'])}"
    return None, f"자동 수정할 위치를 확인할 수 없습니다. 실패한 검사: {label} ({link})"


def request_recovery(issue, state, feedback=None, blocker=None):
    if not state.get("recovery"):
        raise RuntimeError("Legacy review has no publication checkpoint. Human confirmation required.")
    # Development serializes per issue and accepts only the latest trusted ready run.
    extra = ["-f", f"ci_feedback={feedback}"] if feedback else []
    if blocker:
        extra += ["-f", f"ci_blocker={blocker}"]
    subprocess.run(["gh", "workflow", "run", "ai-development.yml", "--repo", REPO,
                    "--ref", "dev", "-f", f"issue={issue}", "-f", f"recovery_run={state['runId']}", *extra],
                   check=True)
    print(f"Issue #{issue}: requested development recovery and fresh validation.")


def dev_head():
    return repo("git/ref/heads/dev")["object"]["sha"]


def restore_draft(current):
    api("graphql", publisher=True, method="POST",
        query="mutation($id:ID!){convertPullRequestToDraft(input:{pullRequestId:$id}){pullRequest{id}}}",
        id=current["node_id"])


def restore_if_unchanged(current, previous):
    if (current["state"] == "open" and not current["draft"]
            and current["head"]["sha"] == previous["head"]["sha"] and current["base"]["ref"] == "dev"
            and current["body"] == previous["body"] and current["title"] == previous["title"]):
        restore_draft(current)


def current_target(issue, number, state, *, undrafted_pr=None):
    if not eligible(issue, state.get("developer", "codex")) or ready_state(issue) != state:
        if undrafted_pr:
            restore_if_unchanged(repo(f"pulls/{number}"), undrafted_pr)
        return None
    current = repo(f"pulls/{number}")
    if current["head"]["sha"] != state["head"] or current["base"]["ref"] != "dev" or current["state"] != "open":
        raise RuntimeError("PR changed since review. Human confirmation required.")
    recovery = state.get("recovery")
    if recovery:
        if not current["draft"] and not undrafted_pr:
            raise RuntimeError("PR draft status changed since review. Human confirmation required.")
        data = repo(f"issues/{issue}")
        if (fingerprint(data["title"], data.get("body")) != recovery["issue"]
                or fingerprint(number, current["title"], current["body"]) != recovery["pull"]):
            raise RuntimeError("Issue or PR was edited since review. Human confirmation required.")
    if dev_head() != state["base"]:
        if undrafted_pr:
            restore_if_unchanged(current, undrafted_pr)
        request_recovery(issue, state)
        return None
    return current


def complete(issue, run_id):
    if not eligible(issue):
        return
    state = ready_state(issue)
    if not state or (run_id and state["runId"] != run_id):
        print("No matching successful review.")
        return
    head = state["head"]
    developer = state.get("developer", "codex")
    if developer not in {"claude", "codex"}:
        return
    branch = f"ai/issue-{issue}-{developer}"
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
            ci = next((r for r in runs if r["head_sha"] == head and any(p["number"] == number for p in r["pull_requests"])), None)
            if ci and ci["status"] == "completed":
                if not current_target(issue, number, state):
                    return
                if ci["conclusion"] == "failure" and state.get("recovery"):
                    feedback, blocker = ci_feedback(ci)
                    request_recovery(issue, state, feedback, blocker)
                    return
                if ci["conclusion"] != "success":
                    raise RuntimeError(f"CI did not pass: {ci['html_url']}")
                break
            if dev_head() != state["base"]:
                if not current_target(issue, number, state):
                    return
            time.sleep(10)
        else:
            raise RuntimeError("CI timed out. Retry AI completion after CI passes.")
        current = current_target(issue, number, state)
        if not current:
            return
        undrafted = current["draft"]
        if undrafted:
            api("graphql", publisher=True, method="POST",
                query="mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id}}}",
                id=current["node_id"])
        try:
            if not current_target(issue, number, state, undrafted_pr=current if undrafted else None):
                return
            result = repo(f"pulls/{number}/merge", publisher=True, method="PUT",
                          sha=head, merge_method="squash", commit_title=f"{current['title']} (#{number})")
            if not result.get("merged"):
                raise RuntimeError("GitHub did not confirm the merge.")
        except (ValueError, RuntimeError):
            confirmed = repo(f"pulls/{number}")
            if not confirmed["merged_at"] or confirmed["head"]["sha"] != head or confirmed["base"]["ref"] != "dev":
                if undrafted:
                    restore_if_unchanged(confirmed, current)
                raise
    if eligible(issue, developer):
        try:
            repo(f"issues/{issue}", method="PATCH", state="closed", state_reason="completed")
        except (ValueError, RuntimeError):
            confirmed = repo(f"issues/{issue}")
            if (confirmed["state"], confirmed["state_reason"]) != ("closed", "completed"):
                raise
    print(f"PR #{number} merged, issue #{issue} completed.")


def main():
    run = os.environ.get("AI_REVIEW_RUN")
    complete(int(os.environ["AI_ISSUE"]), int(run) if run else None)


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print(f"::error::{error}", flush=True)
        raise
