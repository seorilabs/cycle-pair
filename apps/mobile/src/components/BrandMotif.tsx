import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

/**
 * 앱 아이콘과 같은 모티프를 화면 안에서 재사용한다. 두 형체가 기대어 있고 그
 * 위에 초승달이 뜬다.
 *
 * 이미지 자산이나 SVG 라이브러리를 쓰지 않고 View 로 그린다. 이 앱에는 아직
 * 이미지 자산이 하나도 없어서, 모티프 하나 때문에 자산 파이프라인을 새로 열
 * 이유가 없다. View 로 그리면 배경색을 따라가므로 테마가 바뀌어도 어긋나지
 * 않는다.
 *
 * 초승달은 원 하나를 그리고 배경색 원을 겹쳐 깎아 만든다. 두 형체는 서로
 * 반대로 기울여 기대게 하고, 모서리 반지름을 네 방향 다르게 줘 아이콘의
 * 조약돌 느낌을 낸다.
 */
export function BrandMotif({
  size = 72,
  background = colors.background,
}: {
  readonly size?: number;
  readonly background?: string;
}) {
  const unit = size / 72;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }]}>
      <View
        style={[
          styles.moon,
          {
            width: 18 * unit,
            height: 18 * unit,
            borderRadius: 9 * unit,
            top: 2 * unit,
            left: 30 * unit,
          },
        ]}
      />
      <View
        style={[
          styles.moonCarve,
          {
            width: 15 * unit,
            height: 15 * unit,
            borderRadius: 7.5 * unit,
            top: 1 * unit,
            left: 34 * unit,
            backgroundColor: background,
          },
        ]}
      />
      <View
        style={[
          styles.blob,
          {
            width: 32 * unit,
            height: 42 * unit,
            borderTopLeftRadius: 18 * unit,
            borderTopRightRadius: 14 * unit,
            borderBottomLeftRadius: 16 * unit,
            borderBottomRightRadius: 20 * unit,
            bottom: 2 * unit,
            left: 3 * unit,
            backgroundColor: colors.accent,
            transform: [{ rotate: '9deg' }],
          },
        ]}
      />
      <View
        style={[
          styles.blob,
          {
            width: 32 * unit,
            height: 42 * unit,
            borderTopLeftRadius: 14 * unit,
            borderTopRightRadius: 18 * unit,
            borderBottomLeftRadius: 20 * unit,
            borderBottomRightRadius: 16 * unit,
            bottom: 2 * unit,
            right: 3 * unit,
            backgroundColor: colors.mint,
            transform: [{ rotate: '-9deg' }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative' },
  moon: { position: 'absolute', backgroundColor: colors.primarySoft },
  moonCarve: { position: 'absolute' },
  blob: { position: 'absolute' },
});
