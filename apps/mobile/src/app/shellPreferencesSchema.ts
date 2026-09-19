/**
 * 셸 선호 저장 문서의 스키마 버전.
 *
 * `CyclePairStore`가 쓰고 `AccountSessionCleanup`이 읽는다. 두 곳이 리터럴로
 * 각자 들고 있으면 버전을 올릴 때 한쪽만 고쳐도 타입 검사와 테스트가 잡지
 * 못한다. 실제로 그 상태였고, 그 결과 로그아웃 시 이전 계정의 푸시 등록을
 * 해제할지 판정이 조용히 어긋났다.
 */
export const SHELL_PREFERENCES_SCHEMA_VERSION = 4;

export type ShellPreferencesSchemaVersion =
  typeof SHELL_PREFERENCES_SCHEMA_VERSION;

/**
 * 마이그레이션으로 읽어들일 수 있는 이전 버전.
 *
 * 이 버전들은 OS 권한 없이 알림을 기본 on 으로 뒀기 때문에, 복원할 때
 * 로컬 선호를 끄고 서버 등록도 함께 해제한다.
 */
export const MIGRATABLE_SHELL_PREFERENCES_SCHEMA_VERSIONS = Object.freeze([
  2, 3,
]);

export function isReadableShellPreferencesSchemaVersion(
  value: unknown,
): value is number {
  return (
    value === SHELL_PREFERENCES_SCHEMA_VERSION ||
    MIGRATABLE_SHELL_PREFERENCES_SCHEMA_VERSIONS.includes(value as number)
  );
}
