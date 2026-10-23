import { lstat, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const LIMITS = { privateCycles: 100, privateDailyLogs: 1000, shareSettings: 100, pairMemberships: 100, activePairs: 4, eventsPerPair: 500 };
const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
/** 정상 Safari와 Files UI로 저장하고 runner에서 정확히 한 파일을 복사한 뒤 내용을 대조한다. */
export async function verifyExportFileContent({ file, privateRoot, expected, notBefore, notAfter }) {
  const fail = () => { throw new Error('내보내기 파일의 소유 범위, 형식과 자료 대조 실패'); };
  try {
    if (typeof file !== 'string' || typeof privateRoot !== 'string' || !path.isAbsolute(file) ||
        !/^cycle-pair-data-export-\d{4}-\d{2}-\d{2}\.json$/.test(path.basename(file))) fail();
    const root = await realpath(privateRoot), actual = await realpath(file), metadata = await lstat(file);
    if (!actual.startsWith(root + path.sep) || metadata.isSymbolicLink() || !metadata.isFile() ||
        metadata.uid !== process.getuid() || (metadata.mode & 0o077) || metadata.size === 0 || metadata.size > 16 * 1024 * 1024) fail();
    const bytes = await readFile(file), value = JSON.parse(bytes.toString('utf8'));
    if (Object.keys(value).sort().join(',') !== 'data,exportSubjectUid,exportedAt,limits,schemaVersion,truncated' ||
        value.schemaVersion !== 1 || typeof expected?.exportSubjectUid !== 'string' || !expected.exportSubjectUid ||
        value.exportSubjectUid !== expected.exportSubjectUid || stable(value.limits) !== stable(LIMITS)) fail();
    const earliest = Date.parse(notBefore), latest = Date.parse(notAfter), exported = Date.parse(value.exportedAt);
    if (![earliest, latest, exported].every(Number.isFinite) || earliest > latest || exported < earliest || exported > latest) fail();
    if (Object.keys(value.data || {}).sort().join(',') !== 'activePairs,pairMemberships,privateCycles,privateDailyLogs,shareSettings') fail();
    if (Object.keys(value.truncated || {}).sort().join(',') !== 'activePairs,pairMemberships,privateCycles,privateDailyLogs,shareSettings,sharedEvents' ||
        Object.values(value.truncated).some(flag => typeof flag !== 'boolean')) fail();
    const collectionCounts = {};
    for (const name of ['privateCycles', 'privateDailyLogs', 'shareSettings', 'pairMemberships']) {
      const collection = value.data[name];
      if (!Array.isArray(collection?.documents) || collection.documents.length > LIMITS[name] ||
          typeof collection.truncated !== 'boolean') fail();
      collectionCounts[name] = collection.documents.length;
    }
    if (!Array.isArray(value.data.activePairs) || value.data.activePairs.length > LIMITS.activePairs) fail();
    // expected는 독립적으로 읽은 소유 계정의 서버 자료다. 비교 성공을 앱이나 서버에 쓰지 않는다.
    for (const name of ['limits', 'data', 'truncated']) if (stable(value[name]) !== stable(expected[name])) fail();
    return { fileContentMatches: true, uiDownloadVerified: false, schemaVersion: 1, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), collectionCounts };
  } catch { fail(); }
}
