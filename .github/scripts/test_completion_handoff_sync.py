import re
import unittest
from pathlib import Path


class HandoffSyncTest(unittest.TestCase):
    def test_interruption_is_reported_before_copying_the_final_journal_to_the_pr(self):
        workflow = Path(__file__).parents[1] / "workflows" / "ai-development.yml"
        failure_job = workflow.read_text().split("\n  report-completion-failure:", 1)[1]
        commands = re.findall(r"^        run: (.+)$", failure_job, re.MULTILINE)
        self.assertIn("if: steps.interruption.outputs.reported == 'true'", failure_job)
        self.assertEqual(commands[-2:], [
            "python3 .github/scripts/ai-completion.py --report-interruption",
            "python3 .github/scripts/progress-sync.py",
        ])
