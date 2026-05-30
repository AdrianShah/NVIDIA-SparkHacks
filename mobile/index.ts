import { registerRootComponent } from 'expo';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

function Root() {
  return React.createElement(
    SafeAreaProvider,
    null,
    React.createElement(ErrorBoundary, null, React.createElement(App))
  );
}

registerRootComponent(Root);
