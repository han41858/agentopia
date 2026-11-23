"""Decide whether a change can affect the screen and needs the UI tests."""

import os
import subprocess

# 빌드된 화면이나 UI 테스트 자체에 영향을 주는 경로입니다.
UI_PREFIXES = ("src/", "server/", "api/", "assets/", "e2e/")
UI_FILES = {
    "index.html",
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    "playwright.config.ts",
    ".github/workflows/ci.yml",
    ".github/scripts/ui_test_scope.py",
}
NO_COMMIT = "0" * 40


def affects_ui(paths):
    return any(path in UI_FILES or path.startswith(UI_PREFIXES) for path in paths)


def git(*args):
    result = subprocess.run(["git", *args], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or f"git {args[0]} failed")
    return result.stdout


def diff_paths(base):
    # 이름 변경은 옛 경로와 새 경로를 모두 포함하고(--no-renames), 공백·한글 등
    # 따옴표로 표시되는 경로도 그대로 읽도록 NUL로 구분합니다(-z).
    output = git("diff", "--no-renames", "--name-only", "-z", base, "HEAD")
    return [path for path in output.split("\0") if path]


def changed_paths(event, before):
    """Return the changed paths, or None when they cannot be determined."""
    try:
        if event == "pull_request":
            # PR 실행은 base와 합친 커밋을 체크아웃하므로 첫 부모와의 차이가 PR의 변경입니다.
            if len(git("rev-list", "--parents", "-n", "1", "HEAD").split()) != 3:
                return None
            return diff_paths("HEAD^1")
        if event == "push" and before and before != NO_COMMIT:
            return diff_paths(before)
    except RuntimeError:
        pass
    return None


def needs_ui_test(event, before):
    paths = changed_paths(event, before)
    # 변경 목록을 알 수 없으면(수동 실행 포함) 건너뛰지 않고 실행합니다.
    return paths is None or affects_ui(paths)


def main():
    run = needs_ui_test(os.environ.get("GITHUB_EVENT_NAME", ""), os.environ.get("BEFORE_SHA", ""))
    print(f"UI test {'runs' if run else 'skipped: no screen-related change'}")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"run={'true' if run else 'false'}\n")


if __name__ == "__main__":
    main()
