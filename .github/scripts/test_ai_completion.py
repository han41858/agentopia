import importlib.util
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("completion", Path(__file__).with_name("ai-completion.py"))
completion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(completion)


class CompletionTest(unittest.TestCase):
    def run_case(self, ci="success", merged=False, changed=False, status="completed", stale_head=False, merge_error=False, stop_after_undraft=False):
        calls = []
        mutations = []
        head = "a" * 40
        state = {"head": head, "base": "base", "runId": 7}
        pull = {"number": 2, "state": "closed" if merged else "open", "merged_at": merged,
                "head": {"sha": head, "repo": {"full_name": completion.REPO}},
                "base": {"ref": "dev", "sha": "updated" if changed else "base"},
                "draft": True, "title": "Fix", "body": "<!-- agentopia-ai-issue:1 -->", "node_id": "id"}

        def repo(path, **kwargs):
            if path == "git/ref/heads/dev":
                return {"object": {"sha": "updated" if changed else "base"}}
            if path == "pulls/2/merge" and merge_error:
                raise RuntimeError("HTTP 502")
            if path.startswith("pulls?"):
                return [pull]
            if path.startswith("actions/"):
                return {"workflow_runs": [{"head_sha": "old" if stale_head else head, "pull_requests": [{"number": 2}], "status": status,
                                           "conclusion": ci, "html_url": "CI"}]}
            if path == "pulls/2":
                return pull
            calls.append(path)
            return {"merged": True}

        def mutation(path, **kwargs):
            mutations.append(kwargs["query"])
            pull["draft"] = "convertPullRequestToDraft" in kwargs["query"]

        with patch.object(completion, "eligible", side_effect=lambda *_: not (stop_after_undraft and mutations)), patch.object(
            completion, "ready_state", return_value=state
        ), patch.object(completion, "repo", side_effect=repo), patch.object(completion, "api", side_effect=mutation), patch.object(
            completion.time, "sleep"
        ):
            if stop_after_undraft:
                completion.complete(1, 7)
                self.assertTrue(pull["draft"])
                self.assertEqual(len(mutations), 2)
            elif merge_error:
                with self.assertRaisesRegex(RuntimeError, "502"):
                    completion.complete(1, 7)
                self.assertTrue(pull["draft"])
                self.assertEqual(len(mutations), 2)
                merge_error = False
                completion.complete(1, 7)
            elif changed or stale_head or ci != "success" or status != "completed":
                with self.assertRaises(RuntimeError):
                    completion.complete(1, 7)
            else:
                completion.complete(1, 7)
        return calls

    def test_completion_requires_reviewed_developer_label(self):
        issue = {"state": "open", "labels": [{"name": "ai:develop:claude"}]}
        with patch.object(completion, "repo", return_value=issue):
            self.assertTrue(completion.eligible(74, "claude"))
            self.assertFalse(completion.eligible(74, "codex"))
            issue["labels"].append({"name": "ai:stop"})
            self.assertFalse(completion.eligible(74, "claude"))

    def test_ci_feedback_uses_failed_attempt_source_annotations(self):
        jobs = {"jobs": [{"id": 9, "conclusion": "failure"}, {"id": 8, "conclusion": "success"}]}
        annotations = [{"annotation_level": "failure", "path": ".github", "message": "exit 1"},
                       {"annotation_level": "failure", "path": "e2e/dialogs.spec.ts", "start_line": 94,
                        "message": "locator failed"}]
        with patch.object(completion, "repo", side_effect=[jobs, annotations]) as fetch:
            self.assertEqual(completion.ci_feedback({"id": 7, "run_attempt": 2}),
                             "e2e/dialogs.spec.ts:94 locator failed")
            self.assertEqual([c.args[0] for c in fetch.call_args_list],
                             ["actions/runs/7/attempts/2/jobs?per_page=100", "check-runs/9/annotations?per_page=100"])

    def test_paginated_comments(self):
        result = Mock(returncode=0, stdout='{"id":1}\n{"id":2}\n')
        with patch.object(completion.subprocess, "run", return_value=result) as run:
            self.assertEqual(completion.api("comments", pages=True), [{"id": 1}, {"id": 2}])
            self.assertIn("--paginate", run.call_args.args[0])
            self.assertNotIn("--slurp", run.call_args.args[0])

    def test_merge_before_close(self):
        self.assertEqual(self.run_case(), ["pulls/2/merge", "issues/1"])

    def test_merge_error_restores_draft_for_retry(self):
        self.assertEqual(self.run_case(merge_error=True), ["pulls/2/merge", "issues/1"])

    def test_stop_after_undraft_restores_without_merge(self):
        self.assertEqual(self.run_case(stop_after_undraft=True), [])

    def test_resume_after_merge(self):
        self.assertEqual(self.run_case(merged=True), ["issues/1"])

    def test_failed_ci_or_changed_base(self):
        self.assertEqual(self.run_case(ci="failure"), [])
        self.assertEqual(self.run_case(changed=True), [])

    def test_stale_ci_result_dispatches_review_instead_of_merging(self):
        state = {"runId": 17, "issue": 1, "base": "old", "head": "reviewed", "recovery": {
            "issue": completion.fingerprint("task", ""), "pull": completion.fingerprint(2, "Fix", "<!-- agentopia-ai-issue:1 -->")}}
        pull = {"number": 2, "title": "Fix", "body": "<!-- agentopia-ai-issue:1 -->", "draft": True,
                "state": "open", "merged_at": None, "head": {"sha": "reviewed", "repo": {"full_name": completion.REPO}},
                "base": {"sha": "old", "ref": "dev"}}
        def repo(path, **kwargs):
            self.assertFalse(kwargs)
            if path == "git/ref/heads/dev":
                return {"object": {"sha": "new"}}
            if path.startswith("pulls?"):
                return [pull]
            if path.startswith("actions/"):
                return {"workflow_runs": [{"head_sha": "reviewed", "status": "completed", "conclusion": "success",
                                           "pull_requests": [{"number": 2}]}]}
            if path == "issues/1":
                return {"title": "task", "body": ""}
            self.assertEqual(path, "pulls/2")
            return pull
        with patch.object(completion, "eligible", return_value=True), patch.object(completion, "ready_state", return_value=state), patch.object(completion, "repo", side_effect=repo), patch.object(completion.subprocess, "run") as dispatch:
            completion.complete(1, 16)
            dispatch.assert_not_called()
            completion.complete(1, 17)
            dispatch.assert_called_once()
            self.assertIn("recovery_run=17", dispatch.call_args.args[0])

    def test_success_for_an_older_head_never_merges(self):
        self.assertEqual(self.run_case(stale_head=True), [])

    def test_waits_for_whole_ci_workflow(self):
        # ci.yml 실행은 Test and build와 UI test가 모두 끝나야 completed가 됩니다.
        # 어느 한 작업이 진행 중이거나 실패하면 머지하지 않습니다.
        self.assertEqual(self.run_case(status="in_progress"), [])
        self.assertEqual(self.run_case(ci="failure"), [])
