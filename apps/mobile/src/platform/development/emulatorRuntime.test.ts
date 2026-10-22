const mockConnectAuth = jest.fn();
const mockConnectFirestore = jest.fn();
const mockConnectFunctions = jest.fn();
let mockScriptURL =
  'http://192.168.1.24:8081/index.bundle?platform=ios&dev=true';
let mockPlatform = 'ios';
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform;
    },
  },
  NativeModules: {
    SourceCode: { getConstants: () => ({ scriptURL: mockScriptURL }) },
  },
}));
jest.mock('@react-native-firebase/app', () => ({ getApp: () => ({}) }));
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  connectAuthEmulator: (...args: unknown[]) => mockConnectAuth(...args),
}));
jest.mock('@react-native-firebase/firestore', () => ({
  getFirestore: () => ({}),
  initializeFirestore: async () => {},
  connectFirestoreEmulator: (...args: unknown[]) =>
    mockConnectFirestore(...args),
}));
jest.mock('@react-native-firebase/functions', () => ({
  getFunctions: () => ({}),
  connectFunctionsEmulator: (...args: unknown[]) =>
    mockConnectFunctions(...args),
}));
jest.mock('../account/FirebaseAccountAdapter', () => ({
  createFirebaseAccountAdapter: (_: unknown, options: unknown) => options,
}));
jest.mock('../local/migrateDeviceOnlyStorage', () => ({
  migrateDeviceOnlyStorage: async () => {},
}));
jest.mock('../firebase/developmentBoundary', () => ({
  assertDevelopmentBoundary: async () => {},
}));

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockScriptURL = 'http://192.168.1.24:8081/index.bundle?platform=ios&dev=true';
  mockPlatform = 'ios';
});

test('physical iPhone reaches the Mac serving its development bundle, including export', async () => {
  const { initializeRuntime, runtimeAccount } = require('./emulatorRuntime');
  await expect(initializeRuntime()).resolves.toBe(true);
  expect(mockConnectAuth).toHaveBeenCalledWith(
    expect.anything(),
    'http://192.168.1.24:9399',
    { disableWarnings: true },
  );
  expect(mockConnectFirestore).toHaveBeenCalledWith(
    expect.anything(),
    '192.168.1.24',
    8380,
  );
  expect(mockConnectFunctions).toHaveBeenCalledWith(
    expect.anything(),
    '192.168.1.24',
    5301,
  );
  expect(runtimeAccount.exportOrigin).toBe('http://192.168.1.24:5301');
});

test('Android retains loopback through its approved adb reverse routes', async () => {
  mockPlatform = 'android';
  const { initializeRuntime } = require('./emulatorRuntime');
  await initializeRuntime();
  expect(mockConnectAuth).toHaveBeenCalledWith(
    expect.anything(),
    'http://127.0.0.1:9399',
    { disableWarnings: true },
  );
});

test.each([
  'https://192.168.1.24:8081/index.bundle',
  'http://example.com:8081/index.bundle',
  'http://8.8.8.8:8081/index.bundle',
  'http://user:secret@192.168.1.24:8081/index.bundle',
  'file:///main.jsbundle',
])(
  'an unsafe iPhone development origin fails before contacting Firebase: %s',
  async scriptURL => {
    mockScriptURL = scriptURL;
    expect(() => require('./emulatorRuntime')).toThrow(/development.*host/i);
    expect(mockConnectAuth).not.toHaveBeenCalled();
  },
);
