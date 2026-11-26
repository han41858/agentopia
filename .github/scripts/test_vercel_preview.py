import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("preview", Path(__file__).with_name("vercel-preview.py"))
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
REPO = "han41858/agentopia"


class PreviewTest(unittest.TestCase):
    def setUp(self):
        self.pull = {"number": 10, "state": "open", "labels": [],
                     "head": {"repo": {"full_name": REPO, "id": 123}, "ref": "feat/test", "sha": "a" * 40}}

    def test_pr_label_and_branch_exclusions(self):
        self.pull["labels"] = [{"name": "preview"}]
        for ref, expected in [("main", False), ("dev", False), ("ai/issue-74-claude", True)]:
            self.pull["head"]["ref"] = ref
            self.assertEqual(preview.eligible(REPO, self.pull), expected)
        self.pull["head"]["repo"]["full_name"] = "fork/agentopia"
        self.assertFalse(preview.eligible(REPO, self.pull))

    def test_labels_on_closing_issues(self):
        with patch.object(preview, "related", return_value=[1, 2]), patch.object(
            preview, "github", side_effect=["other", "preview\n"]
        ):
            self.assertTrue(preview.eligible(REPO, self.pull))
        with patch.object(preview, "related", return_value=[]):
            self.pull["body"] = "Related to #1"
            self.assertFalse(preview.eligible(REPO, self.pull))

    def test_deploy_exact_head_once(self):
        deployment = {"url": "example.vercel.app"}
        with patch.object(preview, "vercel", side_effect=[
            {"deployments": []}, deployment, {"deployments": [deployment]}
        ]) as api:
            self.assertEqual(preview.preview(self.pull), ("https://example.vercel.app", False))
            self.assertEqual(preview.preview(self.pull), ("https://example.vercel.app", True))
        self.assertEqual(api.call_count, 3)
        body = api.call_args_list[1].args[2]
        self.assertEqual(body["gitSource"]["sha"], self.pull["head"]["sha"])
        self.assertNotIn("target", body)  # Vercel defaults to preview.
        self.assertEqual(api.call_args_list[2].args[1]["meta-agentopiaPreview"],
                         body["meta"]["agentopiaPreview"])

    def test_preview_url_status_targets_deployed_head(self):
        event = {"repository": {"full_name": REPO}, "pull_request": {"number": 10}}
        self.pull["labels"] = [{"name": "preview"}]
        with patch.dict(preview.os.environ, {"GITHUB_EVENT_PATH": "event.json"}), patch.object(
            Path, "read_text", return_value=preview.json.dumps(event)
        ), patch.object(preview, "github", side_effect=[preview.json.dumps(self.pull), ""]) as gh, patch.object(
            preview, "preview", return_value=("https://example.vercel.app", False)
        ):
            self.assertEqual(preview.main(), 0)
        args = gh.call_args.args
        self.assertIn("repos/" + REPO + "/statuses/" + self.pull["head"]["sha"], args)
        self.assertIn("context=Vercel Preview URL", args)
        self.assertIn("target_url=https://example.vercel.app", args)
