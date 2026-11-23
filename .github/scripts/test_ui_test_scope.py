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

    def test_reads_changes_from_git(self):
        with tempfile.TemporaryDirectory() as folder:
            def run(*args):
                subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args],
                               cwd=folder, check=True, capture_output=True)

            def commit(path, message):
                target = Path(folder, path)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(message)
                run("add", "-A")
                run("commit", "-m", message)
                return subprocess.run(["git", "rev-parse", "HEAD"], cwd=folder, check=True,
                                      capture_output=True, text=True).stdout.strip()

            run("init", "-b", "dev")
            base = commit("README.md", "base")
            run("checkout", "-b", "docs")
            commit("docs/guide.md", "docs")
            run("checkout", "dev")
            run("checkout", "-b", "screen")
            commit("src/main.tsx", "screen")
            run("checkout", "dev")
            moved = commit("src/other.tsx", "dev moved")

            def in_folder(*args):
                result = subprocess.run(["git", *args], cwd=folder, capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(result.stderr)
                return result.stdout.split()

            with patch.object(scope, "git", side_effect=in_folder):
                # 문서만 바꾼 PR: dev가 화면 파일을 바꿨어도 PR 자체의 변경만 봅니다.
                run("checkout", "--detach", "dev")
                run("merge", "--no-ff", "docs", "-m", "merge docs")
                self.assertEqual(scope.changed_paths("pull_request", ""), ["docs/guide.md"])
                self.assertFalse(scope.needs_ui_test("pull_request", ""))

                run("checkout", "--detach", "dev")
                run("merge", "--no-ff", "screen", "-m", "merge screen")
                self.assertTrue(scope.needs_ui_test("pull_request", ""))

                # 합친 커밋이 아니면 판단하지 않고 실행합니다.
                run("checkout", "--detach", "docs")
                self.assertIsNone(scope.changed_paths("pull_request", ""))

                run("checkout", "dev")
                self.assertEqual(scope.changed_paths("push", base), ["src/other.tsx"])
                self.assertTrue(scope.needs_ui_test("push", base))
                self.assertFalse(scope.needs_ui_test("push", moved))


if __name__ == "__main__":
    unittest.main()
