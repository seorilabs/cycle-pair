import { normalizeInviteCode } from './inviteCode';
const code = 'A'.repeat(40) + '_-z';
it.each([
  [code, code],
  [`  ${code}\n`, code],
  [`Cycle Pair에서 11월 2일 오후 9시 전까지 입력해 주세요:\n${code}`, code],
  [`Enter this code in Cycle Pair before Nov 2, 9:00 PM:\n${code}`, code],
  [`초대 코드: “${code}”`, code],
  ['incomplete', 'incomplete'],
  [code + 'A', code + 'A'],
  [`${code}\n${'B'.repeat(43)}`, `${code}\n${'B'.repeat(43)}`],
])(
  'normalizes %s without guessing between different codes',
  (input, expected) => {
    expect(normalizeInviteCode(input)).toBe(expected);
  },
);
