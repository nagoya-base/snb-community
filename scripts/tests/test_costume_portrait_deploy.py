"""Offline simulation of the costume portrait survey GAS deployment (Issue #334).

No Google API calls and no production identifiers: clasp is replaced by a mock.
"""

import json
import os
import pathlib
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[2]
TOOLS = REPO / 'scripts/costume-portrait-survey'
DEPLOY = TOOLS / 'deploy-gas.sh'
PREPARE = TOOLS / 'prepare-gas.js'
BASE = REPO / 'community/gas/costume_portrait_survey'
DEPLOYMENT = 'test-existing-deployment'

FILES = {
    'public': ['Config.gs', 'Finalize.gs', 'Log.gs', 'Main.gs', 'Notify.gs', 'Respondent.gs', 'Results.gs',
               'Setup.gs', 'SheetStore.gs', 'Submission.gs', 'SurveyGenerated.gs', 'Validation.gs'],
    'admin': ['Aggregate.gs', 'Auth.gs', 'Data.gs', 'IdToken.gs', 'Main.gs', 'SurveyGenerated.gs'],
}
# Production Admin before Issue #354 still holds the HTML Service dashboard files (replaced by the push).
LEGACY_ADMIN_FILES = ['Dashboard.html', 'DashboardScript.html', 'DashboardStyles.html']


def pulled(target):
    return [n[:-3] + '.js' if n.endswith('.gs') else n for n in FILES[target]]


# Remote manifest as the first manual deployment leaves it (webapp settings live only on the remote).
PUBLIC_REMOTE_MANIFEST = {
    'timeZone': 'Asia/Tokyo', 'exceptionLogging': 'STACKDRIVER', 'runtimeVersion': 'V8',
    'oauthScopes': ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/script.send_mail'],
    'webapp': {'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE_ANONYMOUS'},
}
ADMIN_REMOTE_MANIFEST = {
    'timeZone': 'Asia/Tokyo', 'exceptionLogging': 'STACKDRIVER', 'runtimeVersion': 'V8',
    'oauthScopes': ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/userinfo.email'],
    'webapp': {'executeAs': 'USER_DEPLOYING', 'access': 'MYSELF'},
}
ADMIN_WEBAPP = {'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE_ANONYMOUS'}

MOCK = '''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
action = next((a for a in args if a in (
    'list-deployments', 'pull', 'show-file-status', 'push',
    'create-version', 'update-deployment')), '')
with open(os.environ['MOCK_CLASP_LOG'], 'a') as log:
    log.write(action + '\\n')
if action == 'list-deployments':
    print(json.dumps([{'deploymentId': os.environ['MOCK_DEPLOYMENT'],
                       'versionNumber': 8 if pathlib.Path(os.environ['MOCK_UPDATED_FILE']).exists() else 7}]))
elif action == 'pull':
    for name, body in json.loads(os.environ['MOCK_PULLED']).items():
        pathlib.Path(name).write_text(body)
    pathlib.Path('appsscript.json').write_text(os.environ['MOCK_MANIFEST'])
elif action == 'push' and os.environ.get('MOCK_FAIL_PUSH') == '1':
    sys.exit(1)
elif action == 'push':
    root = pathlib.Path(json.load(open('.clasp.json'))['rootDir'])
    pathlib.Path(os.environ['MOCK_STAGED_FILE']).write_text(json.dumps({
        'files': sorted(p.name for p in root.iterdir() if p.is_file() and not p.name.startswith('.')),
        'manifest': pathlib.Path(root, 'appsscript.json').read_text(),
        'scriptId': json.load(open('.clasp.json'))['scriptId'],
    }))
elif action == 'create-version' and os.environ.get('MOCK_FAIL_VERSION') == '1':
    sys.exit(1)
elif action == 'create-version':
    print(json.dumps({'versionNumber': 8}))
elif action == 'update-deployment' and os.environ.get('MOCK_FAIL_UPDATE') == '1':
    sys.exit(1)
elif action == 'update-deployment':
    if args[args.index('update-deployment') + 1] != os.environ['MOCK_DEPLOYMENT']:
        sys.exit(1)
    if args[args.index('--versionNumber') + 1] != '8':
        sys.exit(1)
    pathlib.Path(os.environ['MOCK_UPDATED_FILE']).write_text('updated')
    print(json.dumps({'deploymentId': os.environ['MOCK_DEPLOYMENT'], 'versionNumber': 8}))
'''


class DeployBase:
    TARGET = ''
    REMOTE_MANIFEST = {}

    def run_deploy(self, drop=(), remote=None, manifest=None, deployment_id=DEPLOYMENT,
                   script_id='test-script-id', mock_deployment=DEPLOYMENT, fail=None, target=None):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            (root / 'clasp').write_text(MOCK)
            (root / 'clasp').chmod(0o755)
            log, updated, staged = root / 'commands.log', root / 'updated', root / 'staged.json'
            files = remote if remote is not None else {n: 'old' for n in pulled(self.TARGET)}
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}',
                       GITHUB_WORKSPACE=str(REPO), RUNNER_TEMP=tmp,
                       COSTUME_PORTRAIT_TARGET=target or self.TARGET,
                       CLASPRC_JSON='{"tokens":{"default":{"access_token":"fake-token"}}}',
                       COSTUME_PORTRAIT_SCRIPT_ID=script_id,
                       COSTUME_PORTRAIT_DEPLOYMENT_ID=deployment_id,
                       COSTUME_PORTRAIT_SOURCE_SHA='a' * 40,
                       MOCK_CLASP_LOG=str(log), MOCK_DEPLOYMENT=mock_deployment,
                       MOCK_UPDATED_FILE=str(updated), MOCK_STAGED_FILE=str(staged),
                       MOCK_PULLED=json.dumps(files),
                       MOCK_MANIFEST=json.dumps(manifest if manifest is not None else self.REMOTE_MANIFEST))
            if fail:
                env[fail] = '1'
            for name in drop:
                env.pop(name, None)
            result = subprocess.run(['bash', str(DEPLOY)], env=env, text=True, capture_output=True)
            self.staged = json.loads(staged.read_text()) if staged.exists() else None
            commands = log.read_text().splitlines() if log.exists() else []
            return result, commands, updated.exists()

    # ── success path ──
    def test_success_updates_only_the_existing_deployment_in_order(self):
        result, commands, updated = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(commands, ['list-deployments', 'pull', 'show-file-status', 'push',
                                    'create-version', 'update-deployment', 'list-deployments'])
        self.assertTrue(updated)
        self.assertNotIn('create-deployment', commands)
        self.assertEqual(self.staged['scriptId'], 'test-script-id')

    def test_staged_bundle_is_exactly_the_allowlist_plus_manifest(self):
        result, _, _ = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.staged['files'], sorted(FILES[self.TARGET] + ['appsscript.json']))
        for name in ('README.md', 'package.json', 'tests', 'survey.schema.json', 'survey-core.js'):
            self.assertNotIn(name, self.staged['files'])

    def test_staged_manifest_webapp_settings(self):
        result, _, _ = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        staged = json.loads(self.staged['manifest'])
        if self.TARGET == 'admin':
            # Admin の webapp はリポジトリ側が正（MYSELF → ANYONE_ANONYMOUS へ移行。データは ID token 検証後にのみ返る）
            self.assertEqual(staged['webapp'], ADMIN_WEBAPP)
        else:
            self.assertEqual(staged['webapp'], self.REMOTE_MANIFEST['webapp'])
        self.assertEqual(staged['oauthScopes'],
                         json.loads((BASE / self.TARGET / 'appsscript.json').read_text())['oauthScopes'])

    def test_first_deploy_over_the_default_placeholder_project(self):
        # 新規GASプロジェクトに最初から入っている空のスタブは上書きしてよい。
        remote = {'Code.js': 'function myFunction() {\n  \n}\n'}
        result, commands, updated = self.run_deploy(remote=remote)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(updated)
        self.assertEqual(commands[-3:], ['create-version', 'update-deployment', 'list-deployments'])

    # ── failures ──
    def test_missing_secrets_fail_before_any_clasp_call(self):
        for name in ('CLASPRC_JSON', 'COSTUME_PORTRAIT_SCRIPT_ID', 'COSTUME_PORTRAIT_DEPLOYMENT_ID',
                     'COSTUME_PORTRAIT_SOURCE_SHA', 'COSTUME_PORTRAIT_TARGET'):
            result, commands, updated = self.run_deploy(drop=(name,))
            self.assertNotEqual(result.returncode, 0, name)
            self.assertEqual(commands, [], name)
            self.assertFalse(updated)

    def test_empty_secrets_fail(self):
        for kwargs in ({'script_id': ''}, {'deployment_id': ''}):
            result, commands, _ = self.run_deploy(**kwargs)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(commands, [])

    def test_unknown_target_fails_before_any_clasp_call(self):
        result, commands, _ = self.run_deploy(target='both')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, [])

    def test_wrong_deployment_id_fails_before_push(self):
        result, commands, updated = self.run_deploy(mock_deployment='some-other-script-deployment')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments'])
        self.assertFalse(updated)

    def test_other_targets_project_is_rejected_before_push(self):
        other = 'admin' if self.TARGET == 'public' else 'public'
        result, commands, updated = self.run_deploy(remote={n: 'old' for n in pulled(other)})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)

    def test_existing_fetish_project_files_are_rejected(self):
        for extra in ('Extra.js', 'Extra.html', 'Index.html', 'Results.html', 'config.json'):
            remote = {n: 'old' for n in pulled(self.TARGET)}
            remote[extra] = 'x'
            result, commands, updated = self.run_deploy(remote=remote)
            self.assertNotEqual(result.returncode, 0, extra)
            self.assertEqual(commands, ['list-deployments', 'pull'], extra)
            self.assertFalse(updated)

    def test_placeholder_with_real_code_is_not_overwritten(self):
        result, commands, _ = self.run_deploy(remote={'Code.js': 'function doGet() { return 1; }'})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])

    def test_push_failure_stops_before_version_and_deployment_update(self):
        result, commands, updated = self.run_deploy(fail='MOCK_FAIL_PUSH')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull', 'show-file-status', 'push'])
        self.assertFalse(updated)

    def test_version_creation_failure_does_not_update_the_deployment(self):
        result, commands, updated = self.run_deploy(fail='MOCK_FAIL_VERSION')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands[-1], 'create-version')
        self.assertFalse(updated)

    def test_deployment_update_failure_fails_the_job(self):
        result, commands, updated = self.run_deploy(fail='MOCK_FAIL_UPDATE')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands[-1], 'update-deployment')
        self.assertFalse(updated)

    def test_credentials_and_identifiers_are_never_printed(self):
        for kwargs in ({}, {'fail': 'MOCK_FAIL_PUSH'}, {'mock_deployment': 'other'}):
            result, _, _ = self.run_deploy(**kwargs)
            output = result.stdout + result.stderr
            for value in ('test-script-id', DEPLOYMENT, 'fake-token', 'access_token'):
                self.assertNotIn(value, output)

    def test_repository_sources_are_untouched(self):
        directory = BASE / self.TARGET
        before = {p: p.read_bytes() for p in directory.iterdir() if p.is_file()}
        self.run_deploy()
        self.assertEqual(before, {p: p.read_bytes() for p in directory.iterdir() if p.is_file()})


class PublicDeployTest(DeployBase, unittest.TestCase):
    TARGET = 'public'
    REMOTE_MANIFEST = PUBLIC_REMOTE_MANIFEST

    def test_public_remote_without_webapp_settings_is_still_updated(self):
        manifest = {k: v for k, v in PUBLIC_REMOTE_MANIFEST.items() if k != 'webapp'}
        result, _, updated = self.run_deploy(manifest=manifest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(updated)
        self.assertNotIn('webapp', json.loads(self.staged['manifest']))

    def test_manifest_requires_send_mail_scope(self):
        manifest = json.loads((BASE / 'public/appsscript.json').read_text())
        self.assertIn('https://www.googleapis.com/auth/script.send_mail', manifest['oauthScopes'])
        self.assertNotIn('webapp', manifest)


class AdminDeployTest(DeployBase, unittest.TestCase):
    TARGET = 'admin'
    REMOTE_MANIFEST = ADMIN_REMOTE_MANIFEST

    def test_existing_myself_or_signed_in_access_is_migrated_to_the_repository_setting(self):
        for access in ('MYSELF', 'DOMAIN', 'ANYONE', 'ANYONE_ANONYMOUS'):
            manifest = dict(ADMIN_REMOTE_MANIFEST, webapp={'executeAs': 'USER_DEPLOYING', 'access': access})
            result, commands, updated = self.run_deploy(manifest=manifest)
            self.assertEqual(result.returncode, 0, access + result.stderr)
            self.assertEqual(json.loads(self.staged['manifest'])['webapp'], ADMIN_WEBAPP, access)

    def test_unknown_remote_access_is_rejected(self):
        for access in ('UNKNOWN', ''):
            manifest = dict(ADMIN_REMOTE_MANIFEST, webapp={'executeAs': 'USER_DEPLOYING', 'access': access})
            result, commands, updated = self.run_deploy(manifest=manifest)
            self.assertNotEqual(result.returncode, 0, access)
            self.assertEqual(commands, ['list-deployments', 'pull'])
            self.assertFalse(updated)

    def test_legacy_dashboard_files_in_the_existing_project_are_replaced_not_refused(self):
        remote = {n: 'old' for n in pulled('admin') + LEGACY_ADMIN_FILES}
        result, commands, updated = self.run_deploy(remote=remote)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(updated)
        for name in LEGACY_ADMIN_FILES:
            self.assertNotIn(name, self.staged['files'])

    def test_other_unexpected_remote_files_are_still_refused(self):
        remote = {n: 'old' for n in pulled('admin') + LEGACY_ADMIN_FILES}
        remote['Extra.js'] = 'function x() {}'
        result, commands, updated = self.run_deploy(remote=remote)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])
        self.assertFalse(updated)

    def test_unexpected_remote_manifest_settings_are_rejected(self):
        manifest = dict(ADMIN_REMOTE_MANIFEST, urlFetchWhitelist=['https://example.com'])
        result, commands, _ = self.run_deploy(manifest=manifest)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(commands, ['list-deployments', 'pull'])

    def test_repository_admin_manifest_is_token_gated_anonymous_with_minimal_scopes(self):
        manifest = json.loads((BASE / 'admin/appsscript.json').read_text())
        self.assertEqual(manifest['webapp'], ADMIN_WEBAPP)
        self.assertEqual(sorted(manifest['oauthScopes']), [
            'https://www.googleapis.com/auth/script.external_request',
            'https://www.googleapis.com/auth/spreadsheets'])

    def test_stage_rejects_write_or_mail_scopes_and_non_anonymous_webapp(self):
        base = json.loads((BASE / 'admin/appsscript.json').read_text())
        bad_manifests = [
            dict(base, oauthScopes=base['oauthScopes'] + ['https://www.googleapis.com/auth/drive']),
            dict(base, oauthScopes=base['oauthScopes'] + ['https://www.googleapis.com/auth/script.send_mail']),
            dict(base, oauthScopes=base['oauthScopes'] + ['https://www.googleapis.com/auth/userinfo.email']),
            dict(base, oauthScopes=['https://www.googleapis.com/auth/spreadsheets']),
            dict(base, oauthScopes=['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/script.external_request']),
            dict(base, webapp={'executeAs': 'USER_ACCESSING', 'access': 'ANYONE_ANONYMOUS'}),
            dict(base, webapp={'executeAs': 'USER_DEPLOYING', 'access': 'ANYONE'}),
            dict(base, webapp={'executeAs': 'USER_DEPLOYING', 'access': 'MYSELF'}),
        ]
        script = ("const {stageManifest}=require(process.argv[1]);"
                  "try{stageManifest('admin',JSON.parse(process.argv[2]),null);process.exit(0)}catch(e){process.exit(3)}")
        for manifest in bad_manifests:
            result = subprocess.run(['node', '-e', script, str(PREPARE), json.dumps(manifest)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 3, json.dumps(manifest))
        ok = subprocess.run(['node', '-e', script, str(PREPARE), json.dumps(base)], capture_output=True, text=True)
        self.assertEqual(ok.returncode, 0, ok.stderr)


class PrepareTest(unittest.TestCase):
    def prepare(self, target, remote_files=None, remote_manifest=None, script_id='x'):
        with tempfile.TemporaryDirectory() as tmp:
            out = pathlib.Path(tmp) / 'out'
            args = ['node', str(PREPARE), 'stage', target, str(REPO), str(out)]
            if remote_files is not None:
                remote = pathlib.Path(tmp) / 'remote'
                remote.mkdir()
                for name in remote_files:
                    (remote / name).write_text('old')
                (remote / 'appsscript.json').write_text(json.dumps(remote_manifest))
                args.append(str(remote))
            result = subprocess.run(args, env=dict(os.environ, COSTUME_PORTRAIT_SCRIPT_ID=script_id),
                                    text=True, capture_output=True)
            files = sorted(p.name for p in out.iterdir()) if out.exists() else []
            clasp = json.loads((out / '.clasp.json').read_text()) if (out / '.clasp.json').exists() else None
            return result, files, clasp

    def test_source_directories_contain_exactly_the_allowlist(self):
        for target in ('public', 'admin'):
            present = sorted(p.name for p in (BASE / target).iterdir() if p.suffix in ('.gs', '.html'))
            self.assertEqual(present, sorted(FILES[target]), target)

    def test_stage_writes_flat_bundle_with_root_dir_dot(self):
        result, files, clasp = self.prepare('public')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(files, sorted(FILES['public'] + ['appsscript.json', '.clasp.json']))
        self.assertEqual(clasp, {'scriptId': 'x', 'rootDir': '.'})

    def test_invalid_script_ids_are_rejected(self):
        for bad in ('', ' x', 'x y', 'x\n'):
            result, files, _ = self.prepare('admin', script_id=bad)
            self.assertNotEqual(result.returncode, 0, repr(bad))
            self.assertEqual(files, [])

    def test_no_credentials_are_present_in_the_repository(self):
        tracked = subprocess.run(['git', 'ls-files'], cwd=REPO, text=True, capture_output=True).stdout.splitlines()
        self.assertFalse([f for f in tracked if f.endswith('.clasprc.json') or f.endswith('.clasp.json')])
        gitignore = (REPO / '.gitignore').read_text()
        self.assertIn('.clasprc.json', gitignore)
        self.assertIn('.clasp.json', gitignore)


if __name__ == '__main__':
    unittest.main()
