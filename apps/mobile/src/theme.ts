/**
 * 따뜻한 크림 바탕에 라벤더를 강조로 쓴다. 앱 아이콘의 크림·더스티로즈·세이지와
 * 같은 계열이며, 아이콘의 초승달이 라벤더라 강조색이 브랜드와 이어진다.
 *
 * 강조는 primary 하나다. 선택된 칩과 주요 버튼이 같은 색을 쓴다.
 */
export const colors = {
  background: '#FBF4E6',
  surface: '#FFFFFF',
  surfaceMuted: '#F6F0E3',
  primary: '#7C69B8',
  primaryDark: '#5E4D96',
  primarySoft: '#E9E2F5',
  accent: '#DE8E76',
  accentSoft: '#F9E5DC',
  mint: '#8FA98C',
  mintSoft: '#E4EBE0',
  text: '#3A3242',
  textMuted: '#79708A',
  textSubtle: '#A2988F',
  border: '#EFE6DC',
  danger: '#C85B65',
  dangerSoft: '#FBE8EA',
  overlay: 'rgba(58, 50, 66, 0.45)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  pill: 999,
} as const;
