module.exports = {
  preset: '@react-native/jest-preset',
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@moonmate/product-core$': '<rootDir>/../../packages/product-core/src/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|\\.pnpm/(?:@react-native\\+|react-native@|react-native-safe-area-context@|@react-native-async-storage\\+)))/',
  ],
};
