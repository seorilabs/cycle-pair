const path = require('node:path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '../..');
const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    unstable_enableSymlinks: true,
    resolveRequest: (context, moduleName, platform) => {
      try {
        return context.resolveRequest(context, moduleName, platform);
      } catch (error) {
        // product-core keeps explicit .js specifiers for its Node ESM build.
        // Metro consumes the TypeScript source in this workspace, so retry the
        // same relative import without .js only when the original file is absent.
        if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
          return context.resolveRequest(
            context,
            moduleName.slice(0, -3),
            platform,
          );
        }
        throw error;
      }
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
