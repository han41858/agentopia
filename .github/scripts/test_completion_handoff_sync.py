import base64
import importlib.util
import json
import subprocess
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("progress", Path(__file__).with_name("progress-sync.py"))
progress = importlib.util.module_from_spec(spec)
spec.loader.exec_module(progress)


class HandoffSyncTest(unittest.TestCase):
    def test_pr_gets_latest_resume_notice_and_preserves_the_approval(self):
        link = f"[PR #9]({progress.ROOT}/pull/9)"
        notice = "리뷰 통과 · 완료 단계 재개 필요"
        body = f"**CI 대기** · {link}\n\n{notice}\n\n**진행 기록**\n### 1차 실행\n- {notice} {link}"
        state = {"issue": 7, "pullNumber": 9, "status": "ready"}
        # Patch the transport, leaving the actual checkpoint reader and PR renderer in use.
        marker = base64.b64encode(json.dumps(state).encode()).decode()
        issue_body = f"{body}\n\n<!-- agentopia-ai-state:{marker} -->"
        old = {"id": 8, "user": {"login": progress.BOT},
               "body": "CI 대기\n<!-- agentopia-pr-progress:7 -->"}

        def respond(args, **kwargs):
            path = args[4]
            if "/issues/7/comments" in path:
                result = json.dumps({"user": old["user"], "body": issue_body})
            elif "/issues/9/comments" in path:
                result = json.dumps(old)
            else:
                self.assertEqual(args[3], "PATCH")
                self.assertTrue(path.endswith("/issues/comments/8"))
                replacement = args[-1].removeprefix("body=")
                self.assertIn(notice, replacement)
                self.assertNotIn("agentopia-ai-state", replacement)
                old["body"] = replacement
                result = "{}"
            return subprocess.CompletedProcess(args, 0, result, "")
        with patch.object(subprocess, "run", side_effect=respond) as requests:
            progress.sync(7)
            progress.sync(7)
        self.assertEqual(sum(call.args[0][3] == "PATCH" for call in requests.call_args_list), 1)
