import React from 'react';
import { Image, StyleSheet } from 'react-native';

const icons = {
  home: require('../assets/brand/icons/home.png'),
  lock: require('../assets/brand/icons/lock.png'),
  mail: require('../assets/brand/icons/mail.png'),
  pair: require('../assets/brand/icons/pair.png'),
  cycle: require('../assets/brand/icons/cycle.png'),
  leaf: require('../assets/brand/icons/leaf.png'),
  sun: require('../assets/brand/icons/sun.png'),
  calendar: require('../assets/brand/icons/calendar.png'),
  cloud: require('../assets/brand/icons/cloud.png'),
  cup: require('../assets/brand/icons/cup.png'),
  moon: require('../assets/brand/icons/moon.png'),
  heart: require('../assets/brand/icons/heart.png'),
  journal: require('../assets/brand/icons/journal.png'),
} as const;
export type AppIconName = keyof typeof icons;

/** Labels belong to the surrounding control; the artwork is decorative. */
export function AppIcon({
  name,
  size = 24,
}: {
  name: AppIconName;
  size?: number;
}) {
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      source={icons[name]}
      style={{ width: size, height: size }}
    />
  );
}

export function QuietTogetherArtwork({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <Image
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
      source={require('../assets/brand/quiet-together.png')}
      resizeMode="cover"
      style={[styles.artwork, compact && styles.compact]}
    />
  );
}

const styles = StyleSheet.create({
  artwork: { width: '100%', aspectRatio: 1.5, borderRadius: 24 },
  compact: { aspectRatio: 2.8 },
});
