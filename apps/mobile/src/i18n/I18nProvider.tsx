import { legacyEnglish } from './legacy';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, NativeModules } from 'react-native';
import {
  choiceLabel,
  resolveLocale,
  translate,
  type LanguageChoice,
  type Locale,
  type MessageKey,
  type MessageParams,
} from './language';
const STORAGE_KEY = 'cyclepair.language.v1';
function systemLocale(): string | undefined {
  const settings = NativeModules.SettingsManager?.settings;
  return (
    settings?.AppleLanguages?.[0] ??
    settings?.AppleLocale ??
    NativeModules.I18nManager?.localeIdentifier ??
    Intl.DateTimeFormat().resolvedOptions().locale
  );
}
interface I18n {
  locale: Locale;
  choice: LanguageChoice;
  t(key: MessageKey, params?: MessageParams): string;
  l(key: string, params?: MessageParams): string;
  label(value: string): string;
  setLanguage(choice: LanguageChoice): Promise<void>;
}
export function legacyText(
  locale: Locale,
  key: string,
  params: MessageParams = {},
): string {
  const template = locale === 'ko' ? key : legacyEnglish[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : placeholder,
  );
}
const initialLocale = resolveLocale('system', systemLocale());
const I18nContext = createContext<I18n>({
  locale: initialLocale,
  choice: 'system',
  l: (key, params) => legacyText(initialLocale, key, params),
  t: (key, params) => translate(initialLocale, key, params),
  label: value => choiceLabel(initialLocale, value),
  setLanguage: async () => {},
});
export function I18nProvider({ children }: PropsWithChildren) {
  const [choice, setChoice] = useState<LanguageChoice>('system');
  const [system, setSystem] = useState(systemLocale);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(value => {
        if (active && (value === 'ko' || value === 'en' || value === 'system'))
          setChoice(value);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setHydrated(true);
      });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setSystem(systemLocale());
    });
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  const locale = resolveLocale(choice, system);
  const setLanguage = useCallback(async (next: LanguageChoice) => {
    await AsyncStorage.setItem(STORAGE_KEY, next);
    setChoice(next);
  }, []);
  const value = useMemo<I18n>(
    () => ({
      locale,
      choice,
      setLanguage,
      l: (key, params) => legacyText(locale, key, params),
      t: (key, params) => translate(locale, key, params),
      label: code => choiceLabel(locale, code),
    }),
    [choice, locale, setLanguage],
  );
  return (
    <I18nContext.Provider value={value}>
      {hydrated ? children : null}
    </I18nContext.Provider>
  );
}
export const useI18n = () => useContext(I18nContext);
export function formatDate(
  value: string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  },
) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(
    locale === 'ko' ? 'ko-KR' : 'en-US',
    options,
  ).format(new Date(year, month - 1, day, 12));
}
