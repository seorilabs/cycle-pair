import { isLocalDevelopmentHost } from '../firebase/isLocalDevelopmentHost';

export function emulatorHost(platform: string, scriptURL?: string): string {
  if (platform === 'android') return '127.0.0.1';
  try {
    const url = new URL(scriptURL ?? '');
    if (
      platform === 'ios' &&
      url.protocol === 'http:' &&
      url.port === '8081' &&
      !url.username &&
      !url.password &&
      !url.hash &&
      isLocalDevelopmentHost(url.hostname)
    )
      return url.hostname;
  } catch {
    /* Report a development configuration error without echoing the URL. */
  }
  throw new Error(
    'Invalid development server host; serve the iPhone bundle from the local Mac',
  );
}
