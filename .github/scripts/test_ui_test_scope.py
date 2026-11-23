import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("scope", Path(__file__).with_name("ui_test_scope.py"))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)


class ScopeTest(unittest.TestCase):
    def test_screen_paths_need_ui_test(self):
        for path in ("src/main.tsx", "server/model.ts", "api/github.ts", "assets/kingdom/palace.svg",
                     "e2e/fixtures.ts", "package-lock.json", "index.html", ".github/workflows/ci.yml"):
            self.assertTrue(scope.affects_ui([path]), path)
        self.assertTrue(scope.affects_ui(["README.md", "src/styles.css"]))

    def test_other_paths_skip_ui_test(self):
        self.assertFalse(scope.affects_ui(["README.md", "docs/development.md", "AGENTS.md",
                                           ".github/scripts/ai-completion.py", "docs/src/note.md"]))
        self.assertFalse(scope.affects_ui([]))

    def test_unknown_changes_run_ui_test(self):
        self.assertTrue(scope.needs_ui_test("workflow_dispatch", ""))
        self.assertTrue(scope.needs_ui_test("push", scope.NO_COMMIT))
        with patch.object(scope, "git", side_effect=RuntimeError("no history")):
            self.assertTrue(scope.needs_ui_test("pull_request", ""))
            self.assertTrue(scope.needs_ui_test("push", "a" * 40))

    def repository(self):
        """Create a Git repository and return helpers that run inside it."""
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        root = Path(folder.name)

        def run(*args):
            subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
                           cwd=root, check=True, capture_output=True)

        def commit(message, write=None, move=None):
            if write:
                target = root / write
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(f"{message}\n" * 20)
            if move:
                (root / move[1]).parent.mkdir(parents=True, exist_ok=True)
                run("mv", *move)
            run("add", "-A")
            run("commit", "-m", message)
            return subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True,
                                  capture_output=True, text=True).stdout.strip()

        def in_repository(*args):
            result = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
            if result.returncode:
                raise RuntimeError(result.stderr)
            return result.stdout

        patcher = patch.object(scope, "git", side_effect=in_repository)
        patcher.start()
        self.addCleanup(patcher.stop)
        run("init", "-b", "dev")
        return run, commit

    def merged(self, run, branch):
        """Check out the merge commit that a pull_request run would test."""
        run("checkout", "--detach", "dev")
        run("merge", "--no-ff", branch, "-m", f"merge {branch}")

    def test_reads_changes_from_git(self):
        run, commit = self.repository()
        base = commit("base", write="README.md")
        run("checkout", "-b", "docs")
        commit("docs", write="docs/guide.md")
        run("checkout", "-b", "screen", "dev")
        commit("screen", write="src/main.tsx")
        run("checkout", "dev")
        moved = commit("dev moved", write="src/other.tsx")

        # 문서만 바꾼 PR: dev가 화면 파일을 바꿨어도 PR 자체의 변경만 봅니다.
        self.merged(run, "docs")
        self.assertEqual(scope.changed_paths("pull_request", ""), ["docs/guide.md"])
        self.assertFalse(scope.needs_ui_test("pull_request", ""))

        self.merged(run, "screen")
        self.assertTrue(scope.needs_ui_test("pull_request", ""))

        # 합친 커밋이 아니면 판단하지 않고 실행합니다.
        run("checkout", "--detach", "docs")
        self.assertIsNone(scope.changed_paths("pull_request", ""))

        run("checkout", "dev")
        self.assertEqual(scope.changed_paths("push", base), ["src/other.tsx"])
        self.assertTrue(scope.needs_ui_test("push", base))
        self.assertFalse(scope.needs_ui_test("push", moved))

    def test_moving_a_screen_file_away_needs_ui_test(self):
        run, commit = self.repository()
        base = commit("base", write="assets/icon.svg")
        run("checkout", "-b", "move")
        head = commit("move", move=("assets/icon.svg", "docs/icon.svg"))

        self.merged(run, "move")
        self.assertEqual(sorted(scope.changed_paths("pull_request", "")),
                         ["assets/icon.svg", "docs/icon.svg"])
        self.assertTrue(scope.needs_ui_test("pull_request", ""))

        run("checkout", "--detach", head)
        self.assertTrue(scope.needs_ui_test("push", base))

    def test_quoted_paths_need_ui_test(self):
        run, commit = self.repository()
        base = commit("base", write="README.md")
        run("checkout", "-b", "names")
        commit("names", write="assets/왕궁.svg")
        head = commit("spaces", write="src/new panel.tsx")

        self.merged(run, "names")
        self.assertEqual(sorted(scope.changed_paths("pull_request", "")),
                         ["assets/왕궁.svg", "src/new panel.tsx"])
        self.assertTrue(scope.needs_ui_test("pull_request", ""))

        run("checkout", "--detach", head)
        self.assertEqual(scope.changed_paths("push", f"{head}~1"), ["src/new panel.tsx"])
        self.assertTrue(scope.needs_ui_test("push", base))

    def test_quoted_paths_outside_the_screen_skip_ui_test(self):
        run, commit = self.repository()
        commit("base", write="README.md")
        run("checkout", "-b", "notes")
        commit("notes", write="docs/회의 기록.md")

        self.merged(run, "notes")
        self.assertEqual(scope.changed_paths("pull_request", ""), ["docs/회의 기록.md"])
        self.assertFalse(scope.needs_ui_test("pull_request", ""))


if __name__ == "__main__":
    unittest.main()
