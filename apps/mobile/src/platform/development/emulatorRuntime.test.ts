const mockConnectAuth = jest.fn();
const mockIgnoreLogs = jest.fn();
const mockIgnoreAllLogs = jest.fn();
const mockConnectFirestore = jest.fn();
const mockConnectFunctions = jest.fn();
let mockScriptURL =
  'http://192.168.1.24:8081/index.bundle?platform=ios&dev=true';
let mockPlatform = 'ios';
jest.mock('react-native', () => ({
  LogBox: { ignoreLogs: mockIgnoreLogs, ignoreAllLogs: mockIgnoreAllLogs },
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

test('emulator runtime hides only the framework debugger hint, preserving warnings and errors', async () => {
  mockPlatform = 'android';
  const warn = console.warn;
  const error = console.error;
  const { initializeRuntime } = require('./emulatorRuntime');
  await initializeRuntime();
  expect(mockIgnoreLogs).toHaveBeenCalledTimes(1);
  const [patterns] = mockIgnoreLogs.mock.calls[0];
  expect(patterns).toHaveLength(1);
  expect(patterns[0]).toBeInstanceOf(RegExp);
  expect(patterns[0].test('Open debugger to view warnings.')).toBe(true);
  for (const message of [
    'permission-denied',
    'Firestore write failed',
    'A warning: Open debugger to view warnings.',
    'Open debugger to view warnings. Details',
  ])
    expect(patterns[0].test(message)).toBe(false);
  expect(mockIgnoreAllLogs).not.toHaveBeenCalled();
  expect(console.warn).toBe(warn);
  expect(console.error).toBe(error);
});

test('the installed React Native LogBox removes the existing hint and keeps error details', async () => {
  const runtimeGlobals = global as typeof global & {
    __FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__?: boolean;
  };
  const original = runtimeGlobals.__FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__;
  const data = jest.requireActual(
    'react-native/Libraries/LogBox/Data/LogBoxData',
  );
  function messages(): string[] {
    let result: string[] = [];
    const subscription = data.observe(
      ({ logs }: { logs: Set<{ message: { content: string } }> }) => {
        result = [...logs].map(log => log.message.content);
      },
    );
    subscription.unsubscribe();
    return result;
  }
  try {
    runtimeGlobals.__FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__ = true;
    data.addLog({
      level: 'warn',
      category: 'synthetic-warning',
      message: { content: 'Synthetic write warning', substitutions: [] },
      componentStack: [],
    });
    expect(messages()).toContain('Open debugger to view warnings.');
    mockIgnoreLogs.mockImplementation(patterns =>
      data.addIgnorePatterns(patterns),
    );
    await require('./emulatorRuntime').initializeRuntime();
    expect(messages()).not.toContain('Open debugger to view warnings.');
    data.addLog({
      level: 'error',
      category: 'synthetic-error',
      message: { content: 'Synthetic write failed', substitutions: [] },
      componentStack: [],
    });
    await new Promise(resolve => setImmediate(resolve));
    expect(messages()).toContain('Synthetic write failed');
  } finally {
    data.clear();
    mockIgnoreLogs.mockReset();
    if (original === undefined)
      delete runtimeGlobals.__FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__;
    else runtimeGlobals.__FUSEBOX_HAS_FULL_CONSOLE_SUPPORT__ = original;
  }
});

test('a release bundle fails before changing LogBox or connecting emulator services', async () => {
  const runtimeGlobals = global as typeof global & { __DEV__: boolean };
  const original = runtimeGlobals.__DEV__;
  try {
    runtimeGlobals.__DEV__ = false;
    const { initializeRuntime } = require('./emulatorRuntime');
    await expect(initializeRuntime()).rejects.toThrow('development bundle');
    expect(mockIgnoreLogs).not.toHaveBeenCalled();
    expect(mockConnectAuth).not.toHaveBeenCalled();
    expect(mockConnectFirestore).not.toHaveBeenCalled();
    expect(mockConnectFunctions).not.toHaveBeenCalled();
  } finally {
    runtimeGlobals.__DEV__ = original;
  }
});
