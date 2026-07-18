import {opaqueServiceSegment} from './opaqueServiceSegment';

describe('opaqueServiceSegment', () => {
  it('SHA-256 기반 128-bit alias를 안정적으로 생성한다', () => {
    expect(opaqueServiceSegment('user-a')).toBe(
      'fc95297aa4f56781f0decb7d4bf59b14',
    );
    expect(opaqueServiceSegment('한글')).toBe(
      'bd87f9bb68b67d2fa1cb82b6751820e9',
    );
  });

  it('원문 식별자나 날짜를 service segment에 노출하지 않는다', () => {
    const sensitive = '2026-07-14';
    const alias = opaqueServiceSegment(sensitive);

    expect(alias).toHaveLength(32);
    expect(alias).toMatch(/^[a-f0-9]+$/);
    expect(alias).not.toContain(sensitive);
  });
});
