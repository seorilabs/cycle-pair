/**
 * @format
 */

import { AppRegistry } from 'react-native';
import React from 'react';
import App from './App';
import { name as appName } from './app.json';
import { firebaseMoonMateBackend } from './src/platform/firebase/FirebaseMoonMateBackend';

function RuntimeApp() {
  return <App backend={firebaseMoonMateBackend} />;
}

AppRegistry.registerComponent(appName, () => RuntimeApp);
