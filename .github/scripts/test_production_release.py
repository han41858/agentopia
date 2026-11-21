import runpy
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

publish = runpy.run_path(str(Path(__file__).with_name("production-release.py")))["publish"]


class ReleaseTest(unittest.TestCase):
    sha = "a" * 40
    tag = "prod-" + sha

    def release(self, tag, run, id):
        return {
            "id": id, "tag_name": tag, "body": f"<!-- agentopia-production-run:{run} -->",
            "author": {"login": "github-actions[bot]"}, "draft": False, "prerelease": False,
        }

    def test_publish_then_prune_only_managed_releases_on_all_pages(self):
        old = self.release("prod-" + "b" * 40, 1, 11)
        manual = dict(old, id=12, author={"login": "owner"})
        api = Mock(side_effect=[[], {}, [[manual], [old]], {"id": 13}, None])
        with patch.dict(publish.__globals__, api=api):
            publish(self.sha, 2)
        self.assertEqual([call.args[0] for call in api.call_args_list], [
            f"git/matching-refs/tags/{self.tag}", "git/refs", "releases?per_page=100",
            "releases", "releases/11",
        ])
        self.assertIn(f"sha={self.sha}", api.call_args_list[1].args)
        self.assertEqual(api.call_args.args[1:], ("-X", "DELETE"))

    def test_retry_keeps_newer_release_and_existing_tag(self):
        ref = {"ref": "refs/tags/" + self.tag, "object": {"sha": self.sha}}
        latest = self.release("prod-" + "b" * 40, 3, 10)
        api = Mock(side_effect=[[ref], [[latest]]])
        with patch.dict(publish.__globals__, api=api):
            publish(self.sha, 2)
        self.assertEqual(api.call_count, 2)

    def test_failed_publication_keeps_previous_release(self):
        old = self.release("prod-" + "b" * 40, 1, 11)
        api = Mock(side_effect=[[], {}, [[old]], RuntimeError("publish failed")])
        with patch.dict(publish.__globals__, api=api), self.assertRaises(RuntimeError):
            publish(self.sha, 2)
        self.assertEqual(api.call_count, 4)

    def test_redeployment_updates_release_without_replacing_tag(self):
        ref = {"ref": "refs/tags/" + self.tag, "object": {"sha": self.sha}}
        old = self.release(self.tag, 1, 11)
        api = Mock(side_effect=[[ref], [[old]], old])
        with patch.dict(publish.__globals__, api=api):
            publish(self.sha, 2)
        self.assertEqual(api.call_args.args[:3], ("releases/11", "-X", "PATCH"))


if __name__ == "__main__":
    unittest.main()
