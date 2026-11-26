"""Request a Vercel Git-source preview without checking out the PR."""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

PROJECT = "prj_37j31S7uKMYN4GZuhHrVJoqAkqy0"
TEAM = "team_sICp2j4Kxd3OzORQ2RYEhdzl"


def github(*args):
    return subprocess.check_output(["gh", "api", *args], text=True)


def related(repo, number, *, from_issue):
    owner, name = repo.split("/")
    if from_issue:
        node, connection = "issue", "closedByPullRequestsReferences"
    else:
        node, connection = "pullRequest", "closingIssuesReferences"
    query = f"""
      query($owner:String!, $name:String!, $number:Int!, $endCursor:String) {{
        repository(owner:$owner,name:$name) {{
          {node}(number:$number) {{ {connection}(first:100,after:$endCursor) {{
            nodes {{ number repository {{ nameWithOwner }} }} pageInfo {{ hasNextPage endCursor }}
          }} }}
        }}
      }}"""
    rows = github("graphql", "--paginate", "-f", f"query={query}", "-F",
                  f"number={number}", "-f", f"owner={owner}", "-f", f"name={name}",
                  "--jq", f".data.repository.{node}.{connection}.nodes[] | @json")
    for line in rows.splitlines():
        item = json.loads(line)
        if item["repository"]["nameWithOwner"].casefold() == repo.casefold():
            yield item["number"]


def eligible(repo, pull):
    head = pull["head"]
    if (pull["state"] != "open" or not head["repo"] or head["repo"]["full_name"] != repo
            or head["ref"] in {"main", "dev"}):
        return False
    if any(label["name"] == "preview" for label in pull["labels"]):
        return True
    for number in related(repo, pull["number"], from_issue=False):
        labels = github(f"repos/{repo}/issues/{number}/labels?per_page=100", "--paginate", "--jq", ".[].name")
        if "preview" in labels.splitlines():
            return True
    return False


def vercel(path, params, body=None):
    token = os.environ.get("VERCEL_TOKEN")
    if not token:
        raise RuntimeError("Set the VERCEL_TOKEN Actions secret for labeled previews.")
    url = "https://api.vercel.com/" + path + "?" + urlencode({"teamId": TEAM, **params})
    request = Request(url, data=json.dumps(body).encode() if body else None,
                      headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def preview(pull):
    head = pull["head"]
    key = f"{pull['number']}-{head['sha']}"
    existing = vercel("v6/deployments", {"projectId": PROJECT, "meta-agentopiaPreview": key,
                                         "state": "QUEUED,INITIALIZING,BUILDING,READY", "limit": 1})
    if existing["deployments"]:
        deployment = existing["deployments"][0]
    else:
        deployment = vercel("v13/deployments", {}, {
            "name": "agentopia", "project": PROJECT,
            "gitSource": {"type": "github", "repoId": head["repo"]["id"],
                          "ref": head["ref"], "sha": head["sha"]},
            "meta": {"agentopiaPreview": key},
        })
    return "https://" + deployment["url"], bool(existing["deployments"])


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
    repo = event["repository"]["full_name"]
    numbers = ([event["pull_request"]["number"]] if "pull_request" in event else
               related(repo, event["issue"]["number"], from_issue=True))
    summary = []
    failed = False
    for number in numbers:
        try:
            pull = json.loads(github(f"repos/{repo}/pulls/{number}"))
            if eligible(repo, pull):
                url, reused = preview(pull)
                summary.append(f"PR #{number} · " + ("기존 프리뷰 재사용" if reused else "신규 프리뷰 요청"))
                print(f"PR #{number} · {url}", flush=True)
                github("--method", "POST", f"repos/{repo}/statuses/{pull['head']['sha']}",
                       "-f", "context=Vercel Preview URL", "-f", "state=success",
                       "-f", "description=Preview URL assigned", "-f", f"target_url={url}",
                       "--silent")
            else:
                summary.append(f"PR #{number} · 대상 아님")
        except Exception as error:
            summary.append(f"PR #{number} · 처리 실패")
            print(f"PR #{number}: {error}", file=sys.stderr)
            failed = True
    if output := os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(output, "a", encoding="utf-8") as stream:
            print("\n\n".join(summary) or "대상 PR 없음", file=stream)
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
