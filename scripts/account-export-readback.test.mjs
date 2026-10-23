import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyExportFileContent } from './account-export-readback.mjs';
const baseline = {
  exportSubjectUid: 'public-export-owner',
  limits: { privateCycles: 100, privateDailyLogs: 1000, shareSettings: 100, pairMemberships: 100, activePairs: 4, eventsPerPair: 500 },
  data: { privateCycles: { documents: [], truncated: false }, privateDailyLogs: { documents: [{ id: '2026-10-23', data: { note: 'public-export-note' } }], truncated: false }, shareSettings: { documents: [], truncated: false }, pairMemberships: { documents: [], truncated: false }, activePairs: [] },
  truncated: { privateCycles: false, privateDailyLogs: false, shareSettings: false, pairMemberships: false, activePairs: false, sharedEvents: false },
};
async function fixture(value = { ...baseline, schemaVersion: 1, exportedAt: '2026-10-23T10:00:00.000Z' }) {
  const root = await mkdtemp(path.join(tmpdir(), 'cyclepair-export-file-unit-'));
  const file = path.join(root, 'cycle-pair-data-export-2026-10-23.json');
  await writeFile(file, JSON.stringify(value), { mode: 0o600 });
  return { root, file, options: { file, privateRoot: root, expected: baseline,
    notBefore: '2026-10-23T09:59:00.000Z', notAfter: '2026-10-23T10:01:00.000Z' } };
}
test('실제 파일 내용 대조는 UI 다운로드 성공을 주입하지 않는다', async () => {
  const f = await fixture();
  try {
    const result = await verifyExportFileContent(f.options);
    assert.equal(result.fileContentMatches, true);
    assert.equal(result.uiDownloadVerified, false);
    assert.equal(result.collectionCounts.privateDailyLogs, 1);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(result).includes('public-export-owner'));
    assert.ok(!JSON.stringify(result).includes('public-export-note'));
  } finally { await rm(f.root, { recursive: true }); }
});
test('다른 소유자, 자료 누락과 변경, 잘못된 버전과 시각은 거절한다', async () => {
  for (const patch of [{ exportSubjectUid: 'other-owner' }, { schemaVersion: 2 },
    { data: { ...baseline.data, privateDailyLogs: { documents: [], truncated: false } } },
    { exportedAt: '2026-10-23T11:00:00.000Z' }, { truncated: { ...baseline.truncated, privateDailyLogs: true } },
    { unexpectedToken: 'public-extra-field' }]) {
    const f = await fixture({ ...baseline, schemaVersion: 1, exportedAt: '2026-10-23T10:00:00.000Z', ...patch });
    try { await assert.rejects(verifyExportFileContent(f.options), /내보내기 파일/); }
    finally { await rm(f.root, { recursive: true }); }
  }
});
test('symlink와 잘못된 파일명은 범위 밖 파일을 읽기 전에 거절한다', async () => {
  const f = await fixture();
  try {
    const alias = path.join(f.root, 'alias.json'); await symlink(f.file, alias);
    await assert.rejects(verifyExportFileContent({ ...f.options, file: alias }));
    await assert.rejects(verifyExportFileContent({ ...f.options, file: '/tmp/other.json' }));
  } finally { await rm(f.root, { recursive: true }); }
});
test('runner 후처리의 소유, 서명과 오류 복원 검사를 로컬에서 실행한다', () => {
  const output = execFileSync('/usr/bin/python3', ['-B', 'e2e/ios/tests/test_export_runner.py'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.equal(output, '');
});
