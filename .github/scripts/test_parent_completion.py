import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("parents", Path(__file__).with_name("parent-completion.py"))
parents = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parents)


class ParentCompletionTest(unittest.TestCase):
    def test_tracking_requires_complete_consistent_children(self):
        for total, states, close in [
            (0, [], False), (2, ["completed"], False),
            (1, ["not_planned"], False), (1, [None], False),
            (2, ["completed", "completed"], True)
        ]:
            parent = {"title": "Tracker", "state": "open", "labels": [{"name": "ai:tracking-only"}],
                      "sub_issues_summary": {"total": total}}
            children = [[{"id": i, "state": "closed" if value else "open",
                          "state_reason": value, "updated_at": "now"}] for i, value in enumerate(states)]
            with self.subTest(states=states), patch.object(parents, "api", side_effect=
                    lambda path, *args: children if "sub_issues" in path else parent) as api:
                parents.reconcile(1, "")
                self.assertEqual(any("PATCH" in call.args for call in api.call_args_list), close)

    def test_changed_children_and_missing_evidence_keep_parent_open(self):
        for later, labels in [(None, {"ai:tracking-only"}), ("same", set())]:
            initial = ("body", labels, {2: "completed"})
            with patch.object(parents, "snapshot", side_effect=[initial, later]), patch.object(parents, "api", return_value=[]) as api:
                parents.reconcile(1, "")
                self.assertFalse(any("PATCH" in call.args for call in api.call_args_list))

    def test_failed_verification_prevents_closure(self):
        with patch.object(parents, "snapshot", return_value=("body", {"ai:verify-api-queries"}, {})), patch.object(
            parents, "verify_queries", side_effect=RuntimeError("fixture failed")
        ), patch.object(parents, "api", return_value=[]) as api, self.assertRaises(RuntimeError):
            parents.reconcile(1, "")
        self.assertTrue(all(len(call.args) == 3 and call.args[1] == "--paginate" for call in api.call_args_list))
