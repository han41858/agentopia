import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


class EnvironmentTest(unittest.TestCase):
    def test_only_dev_branch_is_accepted(self):
        dev = {"name": "dev", "type": "branch"}
        script = Path(__file__).with_name("check-ai-environment.sh")
        with tempfile.TemporaryDirectory() as directory:
            gh = Path(directory) / "gh"
            gh.write_text('#!/bin/sh\ncase "$2" in *branch-policies*) echo "$POLICIES";; *) echo "$ENVIRONMENT";; esac\n')
            gh.chmod(0o755)
            for custom, policies, expected in (
                (True, [dev], True), (False, [dev], False), (True, [], False),
                (True, [{"name": "dev", "type": "tag"}], False),
                (True, [dev, {"name": "*", "type": "branch"}], False),
            ):
                with self.subTest(custom=custom, policies=policies):
                    env = dict(os.environ, PATH=directory + os.pathsep + os.environ["PATH"],
                               GITHUB_REPOSITORY="han41858/agentopia",
                               ENVIRONMENT=json.dumps({"deployment_branch_policy": {"custom_branch_policies": custom}}),
                               POLICIES=json.dumps({"total_count": len(policies), "branch_policies": policies}))
                    result = subprocess.run(["bash", script], env=env, capture_output=True)
                    self.assertEqual(result.returncode == 0, expected)
