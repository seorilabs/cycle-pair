/*
 * react-native-iap@15.4.1 exposes source files under the `react-native`
 * condition. Those files refer to DOM/Node names that React Native intentionally
 * aliases or omits. Keep the compatibility declarations local to this adapter.
 */
declare type HeadersInit = HeadersInit_;

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

declare const global: typeof globalThis & {
  RN_IAP_DEV_MODE?: boolean;
};

