"""Offline simulation of the admin GAS deployment: no Google API calls, no real identifiers."""

import json
import os
import pathlib
import re
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
DEPLOY = REPO / 'scripts/deploy-snb-survey-admin-gas.sh'
PREPARE = REPO / 'scripts/prepare-snb-survey-admin-gas.js'
WORKFLOW = REPO / '.github/workflows/snb-survey-admin-gas-production.yml'
VERIFY = REPO / 'scripts/verify-snb-survey-source-sha.sh'
ADMIN_DIR = REPO / 'community/gas/nagoya_fetish_survey_admin'
DEPLOYMENT = 'test-admin-deployment'
SOURCE = ['Code.gs', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html']
PULLED_JS = ['Code.js', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html']
LEGACY_PULLED = ['コード.js', 'Dashboard.html.html', 'DashboardStyles.html.html',
                 'DashboardScript.html.html']
LEGACY_STAGED = ['コード.gs', 'Dashboard.html.html', 'DashboardStyles.html.html',
                 'DashboardScript.html.html']
PROD_PULLED = ['コード.js', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html']
PROD_STAGED = ['コード.gs', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html']
PUBLIC_PULLED = ['Code.js', 'Index.html', 'Results.html', 'ResultsScript.html', 'Script.html',
                 'Styles.html']
MANIFEST = {'timeZone': 'Asia/Tokyo', 'runtimeVersion': 'V8',
            'webapp': {'access': 'MYSELF', 'executeAs': 'USER_DEPLOYING'}}

MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
action = next((a for a in args if a in (
    'list-deployments', 'pull', 'show-file-status', 'push',
    'create-version', 'update-deployment')), '')
with open(os.environ['MOCK_CLASP_LOG'], 'a') as log:
    log.write(action + '\\n')
if action == 'list-deployments':
    updated = pathlib.Path(os.environ['MOCK_UPDATED_FILE']).exists()
    print(json.dumps([{'deploymentId': os.environ['MOCK_DEPLOYMENT'],
                       'versionNumber': 8 if updated else 7}]))
elif action == 'pull':
    for name in json.loads(os.environ['MOCK_PULLED']):
        pathlib.Path(name).write_text('placeholder')
    pathlib.Path('appsscript.json').write_text(os.environ['MOCK_MANIFEST'])
elif action == 'push':
    cfg = json.load(open('.clasp.json'))
    files = sorted(p.name for p in pathlib.Path(cfg['rootDir']).iterdir() if not p.name.startswith('.'))
    manifest = pathlib.Path(cfg['rootDir'], 'appsscript.json').read_text()
    pathlib.Path(os.environ['MOCK_STAGED_FILE']).write_text(json.dumps(
        {'files': files, 'manifest': manifest, 'scriptId': cfg['scriptId']}))
elif action == 'create-version':
    print(json.dumps({'versionNumber': 8}))
elif action == 'update-deployment':
    if args[args.index('update-deployment') + 1] != os.environ['MOCK_DEPLOYMENT']:
        sys.exit(1)
    pathlib.Path(os.environ['MOCK_UPDATED_FILE']).write_text('updated')
    print(json.dumps({'deploymentId': os.environ['MOCK_DEPLOYMENT'], 'versionNumber': 8}))
'''


def git(cwd, *args):
    return subprocess.run(['git', *args], cwd=cwd, check=True, text=True,
                          capture_output=True).stdout.strip()


class AdminDeployTest(unittest.TestCase):
    def run_deploy(self, drop=(), pulled=None, manifest=None, deployment_id=DEPLOYMENT,
                   script_id='test-admin-script', mock_deployment=DEPLOYMENT):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'clasp').write_text(MOCK)
            (root / 'clasp').chmod(0o755)
            log, updated, staged = root / 'commands.log', root / 'updated', root / 'staged.json'
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}',
                       GITHUB_WORKSPACE=str(REPO), RUNNER_TEMP=tmp,
                       CLASPRC_JSON='{"tokens":{"default":{"access_token":"fake"}}}',
                       SNB_SURVEY_ADMIN_SCRIPT_ID=script_id,
                       SNB_SURVEY_ADMIN_DEPLOYMENT_ID=deployment_id,
                       SNB_SURVEY_ADMIN_SOURCE_SHA='a' * 40,
                       MOCK_CLASP_LOG=str(log), MOCK_DEPLOYMENT=mock_deployment,
                       MOCK_UPDATED_FILE=str(updated), MOCK_STAGED_FILE=str(staged),
                       MOCK_PULLED=json.dumps(pulled or PULLED_JS),
                       MOCK_MANIFEST=json.dumps(manifest if manifest is not None else MANIFEST))
            # Public GAS identifiers must never be consulted; set decoys to detect any use.
            env['SNB_SURVEY_SCRIPT_ID'] = 'PUBLIC-SCRIPT-DECOY'
            env['SNB_SURVEY_DEPLOYMENT_ID'] = 'PUBLIC-DEPLOYMENT-DECOY'
            for name in drop:
                env.pop(name, None)
            result = subprocess.run(['bash', str(DEPLOY)], env=env, text=True, capture_output=True)
            self.staged = json.loads(staged.read_text()) if staged.exists() else None
            commands = log.read_text().splitlines() if log.exists() else []
            return result, commands, updated.exists()

    def test_success_order_and_only_admin_deployment_updated(self):
        result, commands, updated = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(commands, ['list-deployments', 'pull', 'show-file-status', 'push',
                                    'create-version', 'update-deployment', 'list-deployments'])
        self.assertTrue(updated)
        self.assertEqual(self.staged['scriptId'], 'test-admin-script')

    def test_missing_admin_script_id_fails_before_any_clasp_call(self):
        result, commands, _ = self.run_deploy(drop=('SNB_SURVEY_ADMIN_SCRIPT_ID',))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, [])

    def test_missing_admin_deployment_id_fails_before_any_clasp_call(self):
        result, commands, _ = self.run_deploy(drop=('SNB_SURVEY_ADMIN_DEPLOYMENT_ID',))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, [])

    def test_empty_admin_ids_fail(self):
        for kwargs in ({'script_id': ''}, {'deployment_id': ''}):
            result, commands, _ = self.run_deploy(**kwargs)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(commands, [])

    def test_deployment_belonging_to_another_script_fails_before_push(self):
        result, commands, updated = self.run_deploy(mock_deployment='some-other-script-deployment')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments'])
        self.assertFalse(updated)

    def test_staging_has_only_four_files_plus_unchanged_manifest(self):
        result, _, _ = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.staged['files'], sorted(SOURCE + ['appsscript.json']))
        for name in ('README.md', 'tests', 'package.json', 'Index.html', 'Results.html'):
            self.assertNotIn(name, self.staged['files'])
        self.assertEqual(json.loads(self.staged['manifest']), MANIFEST)

    def test_public_gas_project_is_rejected_before_push(self):
        result, commands, updated = self.run_deploy(pulled=PUBLIC_PULLED)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)

    def test_unexpected_remote_file_is_rejected(self):
        for extra in ('Extra.js', 'Extra.html', 'config.json'):
            result, commands, _ = self.run_deploy(pulled=PULLED_JS + [extra])
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(commands, ['list-deployments', 'pull'])

    def test_non_myself_access_is_rejected(self):
        for access in ('ANYONE', 'ANYONE_ANONYMOUS', 'DOMAIN'):
            manifest = dict(MANIFEST, webapp={'access': access})
            result, commands, updated = self.run_deploy(manifest=manifest)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(commands, ['list-deployments', 'pull'])
            self.assertFalse(updated)

    def test_identifiers_are_never_printed(self):
        result, _, _ = self.run_deploy()
        output = result.stdout + result.stderr
        for value in ('test-admin-script', DEPLOYMENT, 'fake', 'DECOY'):
            self.assertNotIn(value, output)

    def test_repository_admin_sources_are_untouched(self):
        before = {p: p.read_bytes() for p in ADMIN_DIR.iterdir() if p.is_file()}
        self.run_deploy()
        self.assertEqual(before, {p: p.read_bytes() for p in ADMIN_DIR.iterdir() if p.is_file()})


def logical_name(name):
    """Apps Script file name clasp derives from a local file name."""
    for ext in ('.gs', '.js', '.html'):
        if name.endswith(ext):
            return name[:-len(ext)]
    return name


class LegacyNamingTest(AdminDeployTest):
    def test_legacy_profile_is_recognized_and_deployed(self):
        result, commands, updated = self.run_deploy(pulled=LEGACY_PULLED)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Remote naming profile: legacy', result.stdout)
        self.assertTrue(updated)
        self.assertEqual(commands[-3:], ['create-version', 'update-deployment', 'list-deployments'])

    def test_legacy_staging_names_are_exact(self):
        result, _, _ = self.run_deploy(pulled=LEGACY_PULLED)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.staged['files'], sorted(LEGACY_STAGED + ['appsscript.json']))
        self.assertEqual(json.loads(self.staged['manifest']), MANIFEST)

    def test_legacy_staged_contents_match_github_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            remote = pathlib.Path(tmp) / 'remote'
            remote.mkdir()
            for name in LEGACY_PULLED:
                (remote / name).write_text('old')
            (remote / 'appsscript.json').write_text(json.dumps(MANIFEST))
            out = pathlib.Path(tmp) / 'out'
            env = dict(os.environ, SNB_SURVEY_ADMIN_SCRIPT_ID='x')
            subprocess.run(['node', str(PREPARE), str(REPO), str(out), str(remote / 'appsscript.json')],
                           env=env, check=True, capture_output=True)
            for src, staged in zip(SOURCE, LEGACY_STAGED):
                self.assertEqual((out / staged).read_bytes(), (ADMIN_DIR / src).read_bytes())
            self.assertEqual(sorted(p.name for p in out.iterdir() if not p.name.startswith('.')),
                             sorted(LEGACY_STAGED + ['appsscript.json']))

    def test_canonical_profile_still_supported(self):
        for pulled in (PULLED_JS, ['Code.gs'] + PULLED_JS[1:]):
            result, _, updated = self.run_deploy(pulled=pulled)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('Remote naming profile: canonical', result.stdout)
            self.assertEqual(self.staged['files'], sorted(SOURCE + ['appsscript.json']))
            self.assertTrue(updated)

    def assert_rejected(self, pulled):
        result, commands, updated = self.run_deploy(pulled=pulled)
        self.assertNotEqual(result.returncode, 0, pulled)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)

    def test_mixed_canonical_and_legacy_is_rejected(self):
        self.assert_rejected(['Code.js'] + LEGACY_PULLED[1:])
        self.assert_rejected(['Code.js', 'Dashboard.html.html'] + PULLED_JS[2:])
        self.assert_rejected(['コード.js', 'Dashboard.html.html'] + PULLED_JS[2:])
        self.assert_rejected(['コード.js', 'Dashboard.html', 'DashboardStyles.html.html',
                              'DashboardScript.html.html'])
        self.assert_rejected(['コード.js'] + LEGACY_PULLED[1:3] + ['DashboardScript.html'])
        self.assert_rejected(['Code.js', 'Dashboard.html.html', 'DashboardStyles.html',
                              'DashboardScript.html.html'])

    def test_duplicate_script_canonical_is_rejected(self):
        self.assert_rejected(PULLED_JS + ['コード.js'])
        self.assert_rejected(LEGACY_PULLED + ['Code.js'])
        self.assert_rejected(PULLED_JS + ['Code.gs'])

    def test_duplicate_dashboard_canonical_is_rejected(self):
        self.assert_rejected(PULLED_JS + ['Dashboard.html.html'])
        self.assert_rejected(LEGACY_PULLED + ['Dashboard.html'])

    def test_production_current_is_recognized_and_deployed(self):
        result, commands, updated = self.run_deploy(pulled=PROD_PULLED)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Remote naming profile: production_current', result.stdout)
        self.assertTrue(updated)
        self.assertEqual(commands[-3:], ['create-version', 'update-deployment', 'list-deployments'])
        self.assertEqual(self.staged['files'], sorted(PROD_STAGED + ['appsscript.json']))
        self.assertEqual(json.loads(self.staged['manifest']), MANIFEST)

    def test_production_current_gs_alias_is_recognized(self):
        result, _, _ = self.run_deploy(pulled=['コード.gs'] + PROD_PULLED[1:])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Remote naming profile: production_current', result.stdout)

    def test_production_current_staged_contents_match_github_sources(self):
        with tempfile.TemporaryDirectory() as tmp:
            remote = pathlib.Path(tmp) / 'remote'
            remote.mkdir()
            for name in PROD_PULLED:
                (remote / name).write_text('old')
            (remote / 'appsscript.json').write_text(json.dumps(MANIFEST))
            out = pathlib.Path(tmp) / 'out'
            env = dict(os.environ, SNB_SURVEY_ADMIN_SCRIPT_ID='x')
            subprocess.run(['node', str(PREPARE), str(REPO), str(out), str(remote / 'appsscript.json')],
                           env=env, check=True, capture_output=True)
            for src, staged in zip(SOURCE, PROD_STAGED):
                self.assertEqual((out / staged).read_bytes(), (ADMIN_DIR / src).read_bytes())
            self.assertEqual(sorted(p.name for p in out.iterdir() if not p.name.startswith('.')),
                             sorted(PROD_STAGED + ['appsscript.json']))

    def test_production_current_duplicates_missing_and_extras_rejected(self):
        self.assert_rejected(PROD_PULLED + ['Code.js'])
        self.assert_rejected(PROD_PULLED + ['コード.gs'])
        self.assert_rejected(PROD_PULLED + ['Dashboard.html.html'])
        self.assert_rejected(PROD_PULLED[:-1])
        self.assert_rejected(PROD_PULLED[1:])
        for extra in ('Extra.js', 'Extra.html'):
            self.assert_rejected(PROD_PULLED + [extra])
        self.assert_rejected(PUBLIC_PULLED)

    def test_production_current_push_creates_no_new_names(self):
        result, _, _ = self.run_deploy(pulled=PROD_PULLED)
        self.assertEqual(result.returncode, 0, result.stderr)
        staged = {logical_name(n) for n in self.staged['files'] if n != 'appsscript.json'}
        self.assertEqual(staged, {'コード', 'Dashboard', 'DashboardStyles', 'DashboardScript'})
        for new_name in ('Code', 'Dashboard.html', 'DashboardStyles.html', 'DashboardScript.html'):
            self.assertNotIn(new_name, staged)

    def test_public_gas_files_still_rejected(self):
        self.assert_rejected(PUBLIC_PULLED)

    def test_extra_files_rejected_in_legacy_profile(self):
        for extra in ('Extra.js', 'Extra.html', 'Extra.html.html'):
            self.assert_rejected(LEGACY_PULLED + [extra])

    def test_missing_file_is_rejected(self):
        self.assert_rejected(LEGACY_PULLED[:-1])

    def test_push_updates_existing_files_without_creating_new_names(self):
        for pulled in (LEGACY_PULLED, PULLED_JS):
            result, _, _ = self.run_deploy(pulled=pulled)
            self.assertEqual(result.returncode, 0, result.stderr)
            staged = {logical_name(n) for n in self.staged['files'] if n != 'appsscript.json'}
            self.assertEqual(staged, {logical_name(n) for n in pulled})
        result, _, _ = self.run_deploy(pulled=LEGACY_PULLED)
        for new_name in ('Code', 'Dashboard', 'DashboardStyles', 'DashboardScript'):
            self.assertNotIn(new_name, {logical_name(n) for n in self.staged['files']})


class StaticSafetyTest(unittest.TestCase):
    def setUp(self):
        self.deploy = DEPLOY.read_text()
        self.workflow = WORKFLOW.read_text()
        self.prepare = PREPARE.read_text()

    def test_no_new_deployment_command(self):
        for text in (self.deploy, self.workflow):
            self.assertNotRegex(text, r'clasp[^\n]*\bdeploy\b')
            self.assertNotRegex(text, r'create-deployment')
        self.assertEqual(len(re.findall(r'clasp[^\n]*update-deployment', self.deploy)), 1)

    def test_update_target_is_admin_deployment_id_only(self):
        match = re.search(r'update-deployment "\$(\w+)"', self.deploy)
        self.assertEqual(match.group(1), 'SNB_SURVEY_ADMIN_DEPLOYMENT_ID')

    def test_public_secret_names_not_used(self):
        for text in (self.deploy, self.workflow, self.prepare):
            self.assertIsNone(re.search(r'SNB_SURVEY_(SCRIPT|DEPLOYMENT)_ID', text))
        self.assertNotIn('scripts/deploy-snb-survey-gas.sh', self.workflow)
        self.assertNotIn('nagoya_fetish_survey_webapp/', self.deploy + self.workflow)
        self.assertIn('secrets.SNB_SURVEY_ADMIN_SCRIPT_ID', self.workflow)
        self.assertIn('secrets.SNB_SURVEY_ADMIN_DEPLOYMENT_ID', self.workflow)

    def test_no_script_property_or_access_changes(self):
        for text in (self.deploy, self.prepare):
            code = '\n'.join(l for l in text.splitlines() if not l.lstrip().startswith(('#', '//')))
            self.assertNotIn('SPREADSHEET_ID', code)
            self.assertNotRegex(code, r'clasp[^\n]*(\brun\b|properties)')

    def test_workflow_is_dispatch_only_with_source_sha(self):
        self.assertNotRegex(self.workflow, r'\n\s+(pull_request|push|schedule):')
        self.assertIn('workflow_dispatch', self.workflow)
        self.assertIn('source_sha', self.workflow)
        self.assertIn('verify-snb-survey-source-sha.sh', self.workflow)
        self.assertIn('refs/heads/main', self.workflow)
        self.assertIn('needs: verify', self.workflow)

    def test_source_files_are_exactly_four_admin_files(self):
        script = ("const m=require('./scripts/prepare-snb-survey-admin-gas');"
                  "console.log(JSON.stringify([m.ROOT_DIR,m.SOURCE_FILES]))")
        out = subprocess.run(['node', '-e', script], cwd=REPO, text=True, capture_output=True,
                             check=True).stdout
        root, files = json.loads(out)
        self.assertEqual(root, 'community/gas/nagoya_fetish_survey_admin')
        self.assertEqual(files, SOURCE)
        for name in files:
            self.assertTrue((ADMIN_DIR / name).is_file())

    def test_prepare_refuses_missing_manifest_and_nonempty_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / 'out'
            env = dict(os.environ, SNB_SURVEY_ADMIN_SCRIPT_ID='x')
            self.assertNotEqual(subprocess.run(['node', str(PREPARE), str(REPO), str(out)],
                                               env=env, capture_output=True).returncode, 0)
            out.mkdir()
            (out / 'stale').write_text('x')
            manifest = pathlib.Path(tmp) / 'm.json'
            manifest.write_text(json.dumps(MANIFEST))
            self.assertNotEqual(subprocess.run(['node', str(PREPARE), str(REPO), str(out), str(manifest)],
                                               env=env, capture_output=True).returncode, 0)


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

    def test_not_main_head_is_rejected(self):
        self.assertNotEqual(self.verify(self.old).returncode, 0)
        self.assertNotEqual(self.verify(self.side).returncode, 0)

    def test_malformed_sha_is_rejected(self):
        for bad in ('b' * 40, self.head[:12], self.head.upper()):
            self.assertNotEqual(self.verify(bad).returncode, 0)


if __name__ == '__main__':
    unittest.main()
