import json
import subprocess
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("progress_sync", Path(__file__).with_name("progress-sync.py"))
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)


class ProgressSyncTest(unittest.TestCase):
    def test_node_journal_projects_to_pr_history(self):
        # Use the real renderer so format changes are checked across both runtimes.
        state = {"issue": 7, "pullNumber": 9, "runId": 12, "attempt": 1,
                 "status": "ready", "reason": "완료 단계 재개 필요"}
        payload = {"repository": progress.journal.REPO, "state": state,
                   "event": {"key": "resume", "text": state["reason"]}}
        renderer = Path(__file__).parent / "ai-development" / "journal.mjs"
        result = subprocess.run(["node", str(renderer)], input=json.dumps(payload),
                                capture_output=True, text=True, check=True)
        body = progress.pr_body(result.stdout, 9, 7)
        self.assertIn(f"[이슈 #7]({progress.ROOT}/issues/7)", body)
        self.assertIn("### 1차 실행", body)
        self.assertIn("완료 단계 재개 필요", body.split("**진행 기록**")[1])
        self.assertNotIn("agentopia-ai-state:", body)

    def test_same_pr_comment_survives_retry_and_keeps_reviews_and_user_comments(self):
        link = f"[PR #9]({progress.ROOT}/pull/9)"
        marker = "<!-- agentopia-pr-progress:7 -->"
        rows = [
            {"id": 1, "user": {"login": "owner"}, "body": marker},
            {"id": 2, "user": {"login": progress.BOT}, "body": "Claude 리뷰 · commit"},
        ]
        timeline = "### 1차 실행\n- 10:00 · CI 실패 " + link
        mutations = []

        def checkpoint(_):
            return ({"body": "현재 상태 " + link + "\n\n**진행 기록**\n" + timeline +
                     "\n\n<!-- agentopia-ai-state:private -->"}, {"issue": 7, "pullNumber": 9})

        def api(path, method="GET", body=None, **_):
            if method == "GET":
                return rows
            mutations.append(method)
            if method == "POST":
                rows.append({"id": 3, "user": {"login": progress.BOT}, "body": body})
            else:
                self.assertEqual(path, "issues/comments/3")
                rows[-1]["body"] = body

        with patch.object(progress.journal, "checkpoint", checkpoint), patch.object(progress, "repo", api):
            progress.sync(7)
            timeline += "\n### 2차 실행\n" + "\n".join(
                f"- 10:0{i} · {event} {link}" for i, event in enumerate(["수정 커밋", "CI 통과", "머지"], 1))
            progress.sync(7)
            progress.sync(7)
        self.assertEqual(mutations, ["POST", "PATCH"])
        self.assertEqual(rows[1]["body"], "Claude 리뷰 · commit")
        self.assertIn(timeline, rows[-1]["body"])
        self.assertNotIn("agentopia-ai-state", rows[-1]["body"])

    def test_replacement_requires_explicit_unique_reference_on_cancelled_issue(self):
        state = {"issue": 7}
        for text, reason, recorded in [("관련 #8", "not_planned", False),
                                       ("Superseded by #8", "completed", False),
                                       ("Superseded by #8", "not_planned", True)]:
            source = {"body": text, "state": "closed", "state_reason": reason}
            with self.subTest(text=text, reason=reason), patch.object(progress.journal, "checkpoint", return_value=({}, state)), patch.object(
                progress, "repo", side_effect=lambda path: source if path == "issues/7" else {}
            ), patch.object(progress.journal, "record_event") as write:
                progress.sync(7, closure=True)
                self.assertEqual(write.called, reason == "not_planned")
                if write.called and not recorded:
                    self.assertNotIn("후속", write.call_args.args[-1])
                if recorded:
                    self.assertIn("후속 #8", write.call_args.args[-1])
