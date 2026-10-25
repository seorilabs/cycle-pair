import type {EmotionCode} from '../app/emotions';
import type {AppIconName} from './AppArtwork';

/** Each feeling keeps the same decorative icon across record and history views. */
export const emotionArtwork: Readonly<Record<EmotionCode, AppIconName>> = {
  calm: 'leaf', happy: 'sun', affectionate: 'heart', anxious: 'cloud',
  irritable: 'cloud', hurt: 'cloud', lonely: 'moon', drained: 'cup', other: 'journal',
};
