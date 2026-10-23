"""소유한 비출시 XCTest runner의 Files 노출만 준비한다. 제품 앱은 거절한다."""
import argparse
import datetime
import hashlib
import json
import os
import pathlib
import plistlib
import subprocess
import sys
import tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'scripts'))
sys.dont_write_bytecode = True
from ios_helper_fingerprint import tree_sha256

APP_ID = 'com.seorilabs.cyclepair.physicalqa.xctrunner'
TEAM = 'HCDUXX4Z3X'
SIGNER = 'A4C6A63AFB22A60A93B569D0AF77A80D49797A1D'
PROFILE = '1d956cec-5b6a-4d39-823e-7f31623ee089'


class RunnerPreparationError(Exception):
    pass


def command(args):
    result = subprocess.run(args, capture_output=True)
    if result.returncode:
        raise RunnerPreparationError('test runner 서명 명령 실패')
    return result.stdout


def inspect_signing(runner):
    strict = subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(runner)], capture_output=True).returncode == 0
    profile_file = runner / 'embedded.mobileprovision'
    profile = plistlib.loads(command(['/usr/bin/security', 'cms', '-D', '-i', str(profile_file)]))
    entitlements = plistlib.loads(command(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(runner)]))
    with tempfile.TemporaryDirectory(prefix='cyclepair-public-signing-') as directory:
        prefix = pathlib.Path(directory) / 'cert'
        command(['/usr/bin/codesign', '-d', '--extract-certificates=' + str(prefix), str(runner)])
        certificate = pathlib.Path(str(prefix) + '0').read_bytes()
    expiry = profile.get('ExpirationDate')
    return {'strict': strict, 'signerSHA1': hashlib.sha1(certificate).hexdigest().upper(),
            'profileUUID': profile.get('UUID'), 'team': profile.get('TeamIdentifier'),
            'profileSHA256': hashlib.sha256(profile_file.read_bytes()).hexdigest(),
            'profileIncludesSigner': certificate in profile.get('DeveloperCertificates', []),
            'profileUnexpired': isinstance(expiry, datetime.datetime) and expiry.replace(tzinfo=datetime.timezone.utc) > datetime.datetime.now(datetime.timezone.utc),
            'entitlements': entitlements}


def has_open_files(runner):
    result = subprocess.run(['/usr/sbin/lsof', '+D', str(runner)], capture_output=True)
    if result.returncode not in (0, 1):
        raise RunnerPreparationError('test runner 사용 상태 확인 실패')
    return result.returncode == 0 or bool(result.stdout)


def sign_outer(runner, entitlements):
    command(['/usr/bin/codesign', '--force', '--sign', SIGNER, '--timestamp=none',
             '--entitlements', str(entitlements), str(runner)])


def check_proof(proof):
    entitlements = proof.get('entitlements', {})
    if (proof.get('strict') is not True or proof.get('signerSHA1') != SIGNER or
            proof.get('profileUUID') != PROFILE or proof.get('team') != [TEAM] or
            proof.get('profileIncludesSigner') is not True or proof.get('profileUnexpired') is not True or
            entitlements.get('application-identifier') != TEAM + '.' + APP_ID or
            entitlements.get('com.apple.developer.team-identifier') != TEAM or
            entitlements.get('get-task-allow') is not True):
        raise RunnerPreparationError('등록된 test runner 서명과 profile만 허용합니다')


def private_write(path, data):
    with os.fdopen(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600), 'wb') as output:
        output.write(data)


def prepare_runner(runner, private_root, evidence, *, inspect=inspect_signing,
                   sign=sign_outer, has_open_files=has_open_files):
    runner, private_root, evidence = map(pathlib.Path, (runner, private_root, evidence))
    if (runner.is_symlink() or private_root.is_symlink() or evidence.exists() or
            not private_root.is_dir() or private_root.stat().st_uid != os.getuid() or
            private_root.stat().st_mode & 0o077 or not runner.resolve().is_relative_to(private_root.resolve()) or
            not evidence.resolve().is_relative_to(private_root.resolve()) or
            {'device-derived-data', 'privacy-diagnostics-helper-build'}.intersection(runner.resolve().parts) or
            runner.name != 'CyclePairPhysicalUITests-Runner.app'):
        raise RunnerPreparationError('소유한 격리 test runner와 새 증적 경로만 허용합니다')
    for ancestor in runner.parents:
        if ancestor == private_root: break
        if ancestor.is_symlink(): raise RunnerPreparationError('symlink runner 경로는 거절합니다')
    # 사용자나 다른 세션의 산출물과 symlink를 건드리지 않는다.
    for file in [runner, *runner.rglob('*')]:
        if file.is_symlink() or file.stat().st_uid != os.getuid():
            raise RunnerPreparationError('소유하지 않은 test runner 파일')
    info_path = runner / 'Info.plist'
    original_info = info_path.read_bytes()
    info = plistlib.loads(original_info)
    executable = info.get('CFBundleExecutable')
    if (info.get('CFBundleIdentifier') != APP_ID or info.get('CFBundlePackageType') != 'APPL' or
            info.get('CFBundleSupportedPlatforms') != ['iPhoneOS'] or
            not isinstance(executable, str) or pathlib.Path(executable).name != executable or
            info.get('UIFileSharingEnabled') is True or info.get('LSSupportsOpeningDocumentsInPlace') is True):
        raise RunnerPreparationError('변경 전 physicalqa runner APPL만 허용합니다')
    if has_open_files(runner):
        raise RunnerPreparationError('사용 중인 test runner를 변경하지 않습니다')
    before = inspect(runner)
    check_proof(before)
    nested = runner / 'PlugIns/CyclePairPhysicalUITests.xctest'
    if not nested.is_dir():
        raise RunnerPreparationError('정확한 UI test bundle이 필요합니다')
    nested_hash = tree_sha256(nested)
    tree_before = tree_sha256(runner)
    originals = {'Info.plist': original_info, executable: (runner / executable).read_bytes(),
                 '_CodeSignature/CodeResources': (runner / '_CodeSignature/CodeResources').read_bytes()}
    evidence.mkdir(mode=0o700)
    for name, value in originals.items():
        private_write(evidence / ('original-' + name.replace('/', '-')), value)
    entitlements = evidence / 'original-entitlements.plist'
    private_write(entitlements, plistlib.dumps(before['entitlements']))
    private_write(evidence / 'signing-before.json', json.dumps(before, sort_keys=True).encode())
    report = {'prepared': False, 'bundleId': APP_ID, 'treeSHA256Before': tree_before,
              'deviceExecuted': False, 'productAppChanged': False, 'fileProviderObserved': False}
    try:
        info['UIFileSharingEnabled'] = True
        info['LSSupportsOpeningDocumentsInPlace'] = True
        info_path.write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY if original_info.startswith(b'bplist') else plistlib.FMT_XML))
        sign(runner, entitlements)  # --deep를 사용하지 않고 outer APPL만 서명한다.
        after = inspect(runner)
        check_proof(after)
        if after != before or tree_sha256(nested) != nested_hash:
            raise RunnerPreparationError('기존 profile, entitlements와 nested test bundle은 불변이어야 합니다')
        report.update(prepared=True, nestedTestBundleUnchanged=True, sameSigningProfileAndEntitlements=True,
                      treeSHA256After=tree_sha256(runner), signing=after,
                      filesKeys={key: plistlib.loads(info_path.read_bytes()).get(key) for key in
                                 ['UIFileSharingEnabled', 'LSSupportsOpeningDocumentsInPlace']})
    except Exception:
        for name, value in originals.items():
            (runner / name).write_bytes(value)
        report['originalTreeRestored'] = tree_sha256(runner) == tree_before
        private_write(evidence / 'result.json', json.dumps(report, sort_keys=True).encode())
        raise RunnerPreparationError('runner 준비 실패, 원본 복원 판정을 확인하세요') from None
    private_write(evidence / 'result.json', json.dumps(report, sort_keys=True).encode())
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runner', required=True)
    parser.add_argument('--private-root', required=True)
    parser.add_argument('--evidence', required=True)
    args = parser.parse_args()
    result = prepare_runner(args.runner, args.private_root, args.evidence)
    print(json.dumps({'prepared': result['prepared'], 'report': str(pathlib.Path(args.evidence) / 'result.json')}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('소유 test runner 준비 실패\n')
        sys.exit(1)
