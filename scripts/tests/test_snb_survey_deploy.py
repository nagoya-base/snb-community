"""Offline clasp simulation: no Google API calls and no production identifiers."""

import json
import os
import pathlib
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
DEPLOYMENT = 'test-existing-deployment'
HTML = ['Index.html', 'Results.html', 'ResultsScript.html', 'Script.html', 'Styles.html']
PULLED_GS = ['Code.gs'] + HTML
PULLED_JS = ['Code.js'] + HTML
VERIFY = REPO / 'scripts/verify-snb-survey-source-sha.sh'


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, text=True,
                          capture_output=True).stdout.strip()


class DeploymentWorkflowTest(unittest.TestCase):
    def run_deploy(self, fail_push=False, deployment_id=DEPLOYMENT, pulled=None,
                   manifest=None):
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
    for name in json.loads(os.environ['MOCK_PULLED']):
        pathlib.Path(name).write_text('placeholder')
    pathlib.Path('appsscript.json').write_text(os.environ['MOCK_MANIFEST'])
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
                       MOCK_PULLED=json.dumps(pulled or PULLED_GS),
                       MOCK_MANIFEST=json.dumps(manifest if manifest is not None else {}),
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

    def assert_rejected_before_push(self, pulled):
        result, commands, updated = self.run_deploy(pulled=pulled)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)
        return result

    def test_allowed_manifest_keys_pass_and_are_listed(self):
        manifest = {'timeZone': 'Asia/Tokyo', 'exceptionLogging': 'STACKDRIVER',
                    'runtimeVersion': 'V8', 'oauthScopes': []}
        result, commands, updated = self.run_deploy(manifest=manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Existing GAS manifest keys:', result.stdout)
        for key in manifest:
            self.assertIn(f'"{key}" EXPECTED', result.stdout)
        self.assertNotIn('" UNEXPECTED', result.stdout.split('manifest keys:')[1])
        self.assertIn('push', commands)

    def test_extra_manifest_key_is_flagged_and_stops_before_push(self):
        manifest = {'timeZone': 'Asia/Tokyo', 'runtimeVersion': 'V8',
                    'webapp': {'access': 'SECRET-ACCESS-VALUE', 'executeAs': 'SECRET-EXEC-VALUE'},
                    'oauthScopes': ['https://example.invalid/SECRET-SCOPE']}
        result, commands, updated = self.run_deploy(manifest=manifest)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)
        self.assertIn('"webapp" UNEXPECTED', result.stdout)
        self.assertIn('"timeZone" EXPECTED', result.stdout)
        self.assertIn('"oauthScopes" EXPECTED', result.stdout)
        output = result.stdout + result.stderr
        for value in ('SECRET-ACCESS-VALUE', 'SECRET-EXEC-VALUE', 'SECRET-SCOPE',
                      'Asia/Tokyo', 'test-script', DEPLOYMENT, 'fake'):
            self.assertNotIn(value, output)

    def test_clasp_pulled_js_is_normalized_to_allowlisted_gs(self):
        result, commands, updated = self.run_deploy(pulled=PULLED_JS)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"Code.js" kind=script normalized="Code.gs" EXPECTED', result.stdout)
        self.assertIn('push', commands)
        self.assertTrue(updated)

    def test_unknown_js_file_is_rejected(self):
        result = self.assert_rejected_before_push(PULLED_JS + ['Extra.js'])
        self.assertIn('"Extra.js" kind=script normalized="Extra.gs" UNEXPECTED', result.stdout)

    def test_unknown_html_file_is_rejected(self):
        result = self.assert_rejected_before_push(PULLED_GS + ['Extra.html'])
        self.assertIn('"Extra.html" kind=html normalized="Extra.html" UNEXPECTED', result.stdout)

    def test_unknown_config_file_is_rejected(self):
        self.assert_rejected_before_push(PULLED_GS + ['config.json'])

    def test_js_and_gs_duplicates_are_rejected(self):
        self.assert_rejected_before_push(PULLED_GS + ['Code.js'])

    def test_diagnostics_do_not_print_identifiers(self):
        result, _, _ = self.run_deploy(pulled=PULLED_JS)
        output = result.stdout + result.stderr
        for secret in ('test-script', DEPLOYMENT, 'fake'):
            self.assertNotIn(secret, output)


class SourceShaVerificationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = pathlib.Path(self.tmp.name)
        git(self.repo, 'init', '-q', '-b', 'main')
        git(self.repo, 'config', 'user.email', 't@example.invalid')
        git(self.repo, 'config', 'user.name', 'test')
        for name in ('one', 'two'):
            (self.repo / name).write_text(name)
            git(self.repo, 'add', name)
            git(self.repo, 'commit', '-q', '-m', name)
        self.head = git(self.repo, 'rev-parse', 'HEAD')
        self.old = git(self.repo, 'rev-parse', 'HEAD~1')
        git(self.repo, 'checkout', '-q', '-b', 'topic', self.old)
        (self.repo / 'side').write_text('side')
        git(self.repo, 'add', 'side')
        git(self.repo, 'commit', '-q', '-m', 'side')
        self.side = git(self.repo, 'rev-parse', 'HEAD')
        git(self.repo, 'checkout', '-q', 'main')

    def verify(self, sha):
        return subprocess.run(['bash', str(VERIFY)], cwd=self.repo, text=True, capture_output=True,
                              env=dict(os.environ, SOURCE_SHA=sha, SNB_SURVEY_MAIN_REF='main'))

    def test_main_head_is_accepted(self):
        self.assertEqual(self.verify(self.head).returncode, 0)

    def test_older_main_commit_is_rejected(self):
        self.assertNotEqual(self.verify(self.old).returncode, 0)

    def test_commit_not_on_main_is_rejected(self):
        self.assertNotEqual(self.verify(self.side).returncode, 0)

    def test_unknown_or_malformed_sha_is_rejected(self):
        self.assertNotEqual(self.verify('b' * 40).returncode, 0)
        self.assertNotEqual(self.verify(self.head[:12]).returncode, 0)
        self.assertNotEqual(self.verify(self.head.upper()).returncode, 0)


if __name__ == '__main__':
    unittest.main()
