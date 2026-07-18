import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const requiredDisabledDefaults = {
  app_data_collection_default_enabled: false,
  analytics_auto_collection_enabled: false,
  google_analytics_automatic_screen_reporting_enabled: false,
  crashlytics_auto_collection_enabled: false,
  crashlytics_debug_enabled: false,
  crashlytics_ndk_enabled: false,
  messaging_auto_init_enabled: false,
  messaging_ios_auto_register_for_remote_messages: false,
};

const requiredSecurityDefaults = {
  app_check_token_auto_refresh: true,
};

function readConfig(path: string) {
  return JSON.parse(readFileSync(path, 'utf8')) as {
    readonly ['react-native']: Record<string, unknown>;
  };
}

function readEnvironmentManifest() {
  return JSON.parse(
    readFileSync(resolve(__dirname, '../firebase-environments.json'), 'utf8'),
  ) as {
    readonly permanentAppId: string;
    readonly development: {
      readonly projectId: string;
      readonly androidConfig: string;
      readonly iosConfig: string;
    };
    readonly production: {
      readonly projectId: string | null;
      readonly androidConfig: string;
      readonly iosConfig: string;
    };
  };
}

describe('RNFirebase native config', () => {
  it('keeps the build-visible mobile config aligned with the root config', () => {
    const rootConfig = readConfig(resolve(__dirname, '../../../firebase.json'));
    const mobileConfig = readConfig(resolve(__dirname, '../firebase.json'));

    expect(mobileConfig['react-native']).toEqual(rootConfig['react-native']);
    expect(mobileConfig['react-native']).toMatchObject(requiredDisabledDefaults);
    expect(mobileConfig['react-native']).toMatchObject(requiredSecurityDefaults);
    expect(Object.keys(mobileConfig)).toEqual(['react-native']);
  });

  it('keeps permanent app IDs while selecting Firebase by build configuration', () => {
    const environments = readEnvironmentManifest();

    expect(environments).toMatchObject({
      permanentAppId: 'com.seorilabs.cyclepair',
      development: {
        projectId: 'seorilabs-cyclepair-dev',
        androidConfig: 'android/app/src/debug/google-services.json',
        iosConfig: 'ios/Firebase/Debug/GoogleService-Info.plist',
      },
      production: {
        androidConfig: 'android/app/src/release/google-services.json',
        iosConfig: 'ios/Firebase/Release/GoogleService-Info.plist',
      },
    });
    expect(
      environments.production.projectId === null ||
        (typeof environments.production.projectId === 'string' &&
          environments.production.projectId.length > 0),
    ).toBe(true);
    expect(environments.production.projectId).not.toBe(
      environments.development.projectId,
    );
  });
});
