"""Reconcile same-repository GitHub sub-issues from a trusted dev workflow."""
import hashlib
import json
import os
import subprocess
from urllib.parse import urlsplit
from pathlib import Path
from tempfile import TemporaryDirectory

REPO = "han41858/agentopia"


def api(path, *args, missing=False):
    result = subprocess.run(["gh", "api", f"repos/{REPO}/{path}", *args],
                            text=True, capture_output=True)
    if result.returncode:
        if missing and "HTTP 404" in result.stderr:
            return None
        raise RuntimeError(f"GitHub 요청 실패: {path}")
    return json.loads(result.stdout)


def snapshot(number):
    parent = api(f"issues/{number}")
    labels = {label["name"] for label in parent["labels"]}
    if parent["state"] != "open" or "ai:stop" in labels:
        return None
    pages = api(f"issues/{number}/sub_issues?per_page=100", "--paginate", "--slurp")
    children = {c["id"]: (c["state"], c["state_reason"], c["updated_at"]) for page in pages for c in page}
    total = parent["sub_issues_summary"]["total"]
    if not children or len(children) != total or any(
        state != "closed" or reason != "completed" for state, reason, _ in children.values()
    ):
        return None
    return (parent["title"], parent.get("body")), labels, children


def verify_queries():
    fixture = str(Path(__file__).with_name("verify-query-fixture.mjs").resolve())
    baseline = "efef5ccf5207c843cdf76a80aa0267a62699b551"
    with TemporaryDirectory() as root:
        checkout = Path(root) / "baseline"
        subprocess.run(["git", "worktree", "add", "--detach", str(checkout), baseline], check=True)
        try:
            for directory, version in [(checkout, "before"), (Path.cwd(), "after")]:
                subprocess.run(["node", fixture, version], cwd=directory,
                               env={"PATH": os.environ["PATH"]}, check=True)
        finally:
            subprocess.run(["git", "worktree", "remove", str(checkout)], check=True)
    return f"https://github.com/{REPO}/actions/runs/{int(os.environ['GITHUB_RUN_ID'])}"


def reconcile(number, evidence):
    first = snapshot(number)
    if not first:
        return
    content, labels, children = first
    automatic_check = "ai:verify-api-queries" in labels
    if automatic_check or "ai:tracking-only" not in labels:
        revision = os.environ.get("GITHUB_SHA", "")
        digest = hashlib.sha256(json.dumps(
            [content, sorted(labels), sorted(children.items()), revision], sort_keys=True
        ).encode()).hexdigest()
        marker = f"<!-- agentopia-parent-verification:{digest} -->"
        comments = api(f"issues/{number}/comments?per_page=100", "--paginate", "--slurp")
        recorded = any(c["user"]["login"] == "github-actions[bot]" and c["body"].endswith(marker)
                       for page in comments for c in page)
        if not recorded:
            if automatic_check:
                evidence = verify_queries()
            url = urlsplit(evidence)
            if url.scheme != "https" or url.netloc != "github.com" or not url.path.startswith(f"/{REPO}/"):
                print("자식 완료. 부모 본문의 통합 완료 기준을 검증하고 결과 링크를 지정하세요.")
                return
            api(f"issues/{number}/comments", "-f", f"body=부모 통합 검증 완료 · {evidence}\n\n{marker}")
    if snapshot(number) == first:
        api(f"issues/{number}", "-X", "PATCH", "-f", "state=closed", "-f", "state_reason=completed")


if __name__ == "__main__":
    number = int(os.environ["ISSUE"])
    if number < 1:
        raise ValueError("양의 이슈 번호가 필요합니다.")
    if os.environ["MODE"] == "child":
        parent = api(f"issues/{number}/parent", missing=True)
        if parent and parent["repository_url"] == f"https://api.github.com/repos/{REPO}":
            reconcile(parent["number"], "")
    else:
        reconcile(number, os.environ.get("EVIDENCE", ""))
