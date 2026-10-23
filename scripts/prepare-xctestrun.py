"""비공개 plist 복사만 수행한다. 기기와 Xcode 실행은 하지 않는다."""
import hashlib
import json
import os
import pathlib
import plistlib
import sys


def main():
    request = json.load(sys.stdin)
    source = pathlib.Path(request['source'])
    destination = pathlib.Path(request['destination']) if not request.get('inspectOnly') else None
    original = source.read_bytes()
    binary = original.startswith(b'bplist00')
    data = plistlib.loads(original)
    target_name = 'CyclePairPhysicalUITests'
    # 현재 실제 산출물인 v1만 지원한다. 다른 포맷을 임의 추정하지 않는다.
    if set(data) - {target_name, '__xctestrun_metadata__'}:
        raise ValueError('지원하지 않는 test target 또는 plist 버전')
    target = data[target_name]
    if target.get('IsUITestBundle') is not True:
        raise ValueError('실제 UI test bundle만 허용')

    def rebase(value):
        if isinstance(value, str):
            return value.replace('__TESTROOT__', str(source.parent.resolve()))
        if isinstance(value, list):
            return [rebase(item) for item in value]
        if isinstance(value, dict):
            return {key: rebase(item) for key, item in value.items()}
        return value

    data = rebase(data)
    target = data[target_name]
    # A reused build cache can replace the helper without changing the plist.
    host = target['TestHostPath']
    bundle = pathlib.Path(target['TestBundlePath'].replace('__TESTHOST__', host))
    info = plistlib.loads((bundle / 'Info.plist').read_bytes())
    executable_name = info['CFBundleExecutable']
    if not isinstance(executable_name, str) or pathlib.Path(executable_name).name != executable_name:
        raise ValueError('지원하지 않는 test executable')
    helper_hash = hashlib.sha256((bundle / executable_name).read_bytes()).hexdigest()
    fingerprint = {'sourceSHA256': hashlib.sha256(original).hexdigest(),
                   'testBundleExecutableSHA256': helper_hash}
    if request.get('inspectOnly') is True:
        print(json.dumps(fingerprint))
        return
    environment = target.setdefault('EnvironmentVariables', {})
    # 이전 실행의 비밀값을 새 실행에 이어받지 않는다.
    if any(('INVITATION' in key or 'SECRET' in key) and key.startswith('CYCLEPAIR_')
           for key in environment):
        raise ValueError('이전 비밀 환경변수가 있는 base는 거절')
    environment = {key: value for key, value in environment.items()
                   if not key.startswith('CYCLEPAIR_')}
    environment.update(request['environment'])
    target['EnvironmentVariables'] = environment
    target['OnlyTestIdentifiers'] = [request['identifier']]
    target.pop('SkipTestIdentifiers', None)
    target['SystemAttachmentLifetime'] = 'keepNever'
    target['UserAttachmentLifetime'] = 'keepNever'
    target['TestTimeoutsEnabled'] = True
    target['DefaultTestExecutionTimeAllowance'] = 180
    target['MaximumTestExecutionTimeAllowance'] = 240
    encoded = plistlib.dumps(data, fmt=plistlib.FMT_BINARY if binary else plistlib.FMT_XML,
                            sort_keys=False)
    fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(encoded)
    print(json.dumps({'format': 'binary' if binary else 'xml',
                      **fingerprint,
                      'testRootRebased': True,
                      'systemAttachmentLifetime': 'keepNever',
                      'userAttachmentLifetime': 'keepNever'}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # plist나 stdin 내용을 오류 메시지에 포함하지 않는다.
        sys.stderr.write('비공개 xctestrun 준비 실패\n')
        sys.exit(1)
