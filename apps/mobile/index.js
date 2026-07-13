/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React from 'react';
import App from './App';
import { name as appName } from './app.json';
import { firebaseCyclePairBackend } from './src/platform/firebase/FirebaseCyclePairBackend';

function RuntimeApp() {
  return <App backend={firebaseCyclePairBackend} />;
}

AppRegistry.registerComponent(appName, () => RuntimeApp);
