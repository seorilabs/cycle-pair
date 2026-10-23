import importlib.util
import pathlib
import plistlib
import tempfile
import unittest

MODULE = pathlib.Path(__file__).resolve().parents[1] / 'prepare_export_runner.py'
spec = importlib.util.spec_from_file_location('export_runner', MODULE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ExportRunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='cyclepair-export-runner-unit-')
        self.root = pathlib.Path(self.tmp.name)
        self.runner = self.root / 'owned' / 'CyclePairPhysicalUITests-Runner.app'
        self.runner.mkdir(parents=True)
        self.info = {'CFBundleIdentifier': 'com.seorilabs.cyclepair.physicalqa.xctrunner',
                     'CFBundlePackageType': 'APPL', 'CFBundleExecutable': 'Runner',
                     'CFBundleSupportedPlatforms': ['iPhoneOS']}
        (self.runner / 'Info.plist').write_bytes(plistlib.dumps(self.info))
        (self.runner / 'Runner').write_bytes(b'original public runner executable')
        (self.runner / '_CodeSignature').mkdir()
        (self.runner / '_CodeSignature/CodeResources').write_bytes(b'original public code resources')
        bundle = self.runner / 'PlugIns/CyclePairPhysicalUITests.xctest'
        bundle.mkdir(parents=True)
        (bundle / 'Test').write_bytes(b'public test binary')
        self.proof = {'signerSHA1': 'A4C6A63AFB22A60A93B569D0AF77A80D49797A1D',
                      'profileUUID': '1d956cec-5b6a-4d39-823e-7f31623ee089',
                      'team': ['HCDUXX4Z3X'], 'profileSHA256': 'public-profile-hash',
                      'profileIncludesSigner': True, 'profileUnexpired': True, 'strict': True,
                      'entitlements': {'application-identifier': 'HCDUXX4Z3X.com.seorilabs.cyclepair.physicalqa.xctrunner',
                                       'com.apple.developer.team-identifier': 'HCDUXX4Z3X', 'get-task-allow': True}}
        self.signs = 0

    def tearDown(self):
        self.tmp.cleanup()

    def prepare(self, **kwargs):
        def sign(runner, entitlements):
            self.signs += 1
            self.assertEqual(plistlib.loads(entitlements.read_bytes()), self.proof['entitlements'])
            (runner / 'Runner').write_bytes(b'resigned public runner executable')
        return module.prepare_runner(self.runner, self.root, self.root / 'evidence',
                                     inspect=lambda p: self.proof, sign=kwargs.pop('sign', sign),
                                     has_open_files=lambda p: False, **kwargs)

    def test_only_outer_runner_is_changed_and_originals_are_backed_up(self):
        result = self.prepare()
        self.assertTrue(result['prepared'])
        info = plistlib.loads((self.runner / 'Info.plist').read_bytes())
        self.assertIs(info['UIFileSharingEnabled'], True)
        self.assertIs(info['LSSupportsOpeningDocumentsInPlace'], True)
        self.assertTrue(result['nestedTestBundleUnchanged'])
        self.assertTrue(result['sameSigningProfileAndEntitlements'])
        self.assertEqual(plistlib.loads((self.root / 'evidence/original-Info.plist').read_bytes()), self.info)
        self.assertEqual(self.signs, 1)
        with self.assertRaises(module.RunnerPreparationError):
            self.prepare()
        self.assertEqual(self.signs, 1)

    def test_wrong_bundle_profile_or_signer_is_rejected_without_mutation(self):
        for key, bad in [('profileUUID', 'wrong-profile'), ('signerSHA1', 'wrong-signer'), ('strict', False)]:
            with self.subTest(key=key):
                original = self.proof[key]
                self.proof[key] = bad
                with self.assertRaises(module.RunnerPreparationError):
                    self.prepare()
                self.proof[key] = original
                self.assertEqual(plistlib.loads((self.runner / 'Info.plist').read_bytes()), self.info)
        self.info['CFBundleIdentifier'] = 'com.seorilabs.cyclepair'
        (self.runner / 'Info.plist').write_bytes(plistlib.dumps(self.info))
        with self.assertRaises(module.RunnerPreparationError):
            self.prepare()
        self.assertEqual(self.signs, 0)

    def test_active_or_symlink_runner_is_rejected(self):
        with self.assertRaises(module.RunnerPreparationError):
            module.prepare_runner(self.runner, self.root, self.root / 'active-evidence',
                                  inspect=lambda p: self.proof, sign=lambda *a: None,
                                  has_open_files=lambda p: True)
        alias = self.root / 'alias'
        alias.symlink_to(self.runner.parent, target_is_directory=True)
        with self.assertRaises(module.RunnerPreparationError):
            module.prepare_runner(alias / self.runner.name, self.root, self.root / 'alias-evidence')
        self.assertEqual(self.signs, 0)

    def test_sign_error_restores_original_info_executable_and_signature(self):
        def fail(runner, _):
            (runner / 'Runner').write_bytes(b'partial signature')
            raise RuntimeError('public synthetic signing error')
        with self.assertRaises(module.RunnerPreparationError):
            self.prepare(sign=fail)
        self.assertEqual(plistlib.loads((self.runner / 'Info.plist').read_bytes()), self.info)
        self.assertEqual((self.runner / 'Runner').read_bytes(), b'original public runner executable')
        self.assertEqual((self.runner / '_CodeSignature/CodeResources').read_bytes(), b'original public code resources')


if __name__ == '__main__':
    unittest.main()
