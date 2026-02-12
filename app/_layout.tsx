import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export default function RootLayout() {
  useEffect(() => {
    // Fix routing for GitHub Pages subdirectory
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const basePath = '/discoveragent';
      const currentPath = window.location.pathname;

      // Strip base path and update history so router can match correctly
      if (currentPath.startsWith(basePath)) {
        const routePath = currentPath.substring(basePath.length) || '/';

        // Replace the URL in browser without base path for the router
        // But keep the display URL with base path
        const originalPushState = window.history.pushState;
        const originalReplaceState = window.history.replaceState;

        window.history.pushState = function(state, title, url) {
          if (typeof url === 'string' && !url.startsWith(basePath) && !url.startsWith('http')) {
            url = basePath + url;
          }
          return originalPushState.call(this, state, title, url);
        };

        window.history.replaceState = function(state, title, url) {
          if (typeof url === 'string' && !url.startsWith(basePath) && !url.startsWith('http')) {
            url = basePath + url;
          }
          return originalReplaceState.call(this, state, title, url);
        };

        // Update the path for the router to recognize
        if (routePath !== currentPath) {
          Object.defineProperty(window.location, 'pathname', {
            writable: true,
            value: routePath
          });
        }
      }
    }
  }, []);

  return (
    <SafeAreaProvider>
      <Stack>
        <Stack.Screen
          name="index"
          options={{
            title: 'Home',
            headerShown: true
          }}
        />
        <Stack.Screen
          name="about"
          options={{
            title: 'About',
            headerShown: true
          }}
        />
      </Stack>
    </SafeAreaProvider>
  );
}
