"""Record a successful production event. GitHub Actions serializes these runs."""

import json
import os
import re
import subprocess


def api(path, *args):
    output = subprocess.check_output(
        ["gh", "api", f"repos/{os.environ['GITHUB_REPOSITORY']}/{path}", *args],
        text=True,
    )
    return json.loads(output) if output.strip() else None


def managed_run(release):
    if (
        release["author"]["login"] == "github-actions[bot]"
        and not release["draft"]
        and not release["prerelease"]
        and re.fullmatch(r"prod-[0-9a-f]{40}", release["tag_name"])
    ):
        marker = re.search(r"^<!-- agentopia-production-run:(\d+) -->$", release["body"] or "", re.M)
        if marker:
            return int(marker[1])
    return 0


def publish(sha, run):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or run < 1:
        raise ValueError("Invalid deployment commit or workflow run number")
    tag = f"prod-{sha}"
    ref = f"refs/tags/{tag}"
    refs = api(f"git/matching-refs/tags/{tag}")
    existing = next((item for item in refs if item["ref"] == ref), None)
    if existing is None:
        api("git/refs", "-X", "POST", "-f", f"ref={ref}", "-f", f"sha={sha}")
    elif existing["object"]["sha"] != sha:
        raise ValueError(f"Existing tag points to a different object: {tag}")

    pages = api("releases?per_page=100", "--paginate", "--slurp")
    releases = [release for page in pages for release in page]
    managed = [release for release in releases if managed_run(release)]
    latest = max(managed, key=managed_run, default=None)
    # A delayed retry can finish after a newer successful deployment.
    if latest and managed_run(latest) >= run:
        keep = latest["id"]
    else:
        current = next((release for release in releases if release["tag_name"] == tag), None)
        if current and not managed_run(current):
            raise ValueError(f"Tag already has an independently managed release: {tag}")
        body = f"프로덕션 배포 커밋 `{sha}`.\n\n<!-- agentopia-production-run:{run} -->"
        target = f"releases/{current['id']}" if current else "releases"
        release = api(target, "-X", "PATCH" if current else "POST", "-f", f"tag_name={tag}",
                      "-f", f"name=프로덕션 배포 · {sha[:7]}", "-f", f"body={body}",
                      "-f", "make_latest=true")
        keep = release["id"]

    # Only delete release records after the replacement has been confirmed.
    for release in managed:
        if release["id"] != keep:
            api(f"releases/{release['id']}", "-X", "DELETE")


if __name__ == "__main__":
    publish(os.environ["DEPLOYED_SHA"], int(os.environ["GITHUB_RUN_NUMBER"]))
