"""Offline clasp simulation: no Google API calls and no production identifiers."""

import json
import os
import pathlib
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
DEPLOYMENT = 'test-existing-deployment'


class DeploymentWorkflowTest(unittest.TestCase):
    def run_deploy(self, fail_push=False, deployment_id=DEPLOYMENT):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            mock = root / 'clasp'
            mock.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
action = next((a for a in args if a in (
    'list-deployments', 'pull', 'show-file-status', 'push',
    'create-version', 'update-deployment')), '')
with open(os.environ['MOCK_CLASP_LOG'], 'a') as log:
    log.write(action + '\\n')
if action == 'list-deployments':
    print(json.dumps([{'deploymentId': os.environ['MOCK_DEPLOYMENT'],
                       'versionNumber': 8 if os.environ.get('MOCK_UPDATED') else 7}]))
elif action == 'pull':
    for name in ('Code.gs', 'Index.html', 'Results.html', 'ResultsScript.html',
                 'Script.html', 'Styles.html'):
        pathlib.Path(name).write_text('placeholder')
    pathlib.Path('appsscript.json').write_text('{}')
elif action == 'push' and os.environ.get('MOCK_FAIL_PUSH') == '1':
    sys.exit(1)
elif action == 'create-version':
    print(json.dumps({'versionNumber': 8}))
elif action == 'update-deployment':
    if args[args.index('update-deployment') + 1] != os.environ['MOCK_DEPLOYMENT']:
        sys.exit(1)
    if args[args.index('--versionNumber') + 1] != '8':
        sys.exit(1)
    pathlib.Path(os.environ['MOCK_UPDATED_FILE']).write_text('updated')
    print(json.dumps({'deploymentId': os.environ['MOCK_DEPLOYMENT'], 'versionNumber': 8}))
''')
            mock.chmod(0o755)
            log = root / 'commands.log'
            updated = root / 'updated'
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}',
                       GITHUB_WORKSPACE=str(REPO), RUNNER_TEMP=tmp,
                       CLASPRC_JSON='{"tokens":{"default":{"access_token":"fake"}}}',
                       SNB_SURVEY_SCRIPT_ID='test-script',
                       SNB_SURVEY_DEPLOYMENT_ID=deployment_id,
                       SNB_SURVEY_SOURCE_SHA='a' * 40,
                       MOCK_CLASP_LOG=str(log), MOCK_DEPLOYMENT=DEPLOYMENT,
                       MOCK_UPDATED_FILE=str(updated),
                       MOCK_FAIL_PUSH='1' if fail_push else '0')
            # The mock process sees whether the preceding update created its marker.
            mock.write_text(mock.read_text().replace(
                "os.environ.get('MOCK_UPDATED')", "pathlib.Path(os.environ['MOCK_UPDATED_FILE']).exists()"))
            result = subprocess.run(['bash', str(REPO / 'scripts/deploy-snb-survey-gas.sh')],
                                    env=env, text=True, capture_output=True)
            return result, log.read_text().splitlines() if log.exists() else [], updated.exists()

    def test_only_existing_deployment_is_updated_after_push_and_version(self):
        result, commands, updated = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(commands, ['list-deployments', 'pull', 'show-file-status',
                                    'push', 'create-version', 'update-deployment',
                                    'list-deployments'])
        self.assertTrue(updated)

    def test_failed_push_cannot_create_a_version_or_update_deployment(self):
        result, commands, updated = self.run_deploy(fail_push=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull', 'show-file-status', 'push'])
        self.assertFalse(updated)

    def test_wrong_deployment_id_stops_before_push(self):
        result, commands, updated = self.run_deploy(deployment_id='different-project')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments'])
        self.assertFalse(updated)


if __name__ == '__main__':
    unittest.main()
