import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Platform } from 'react-native';

export default function RootLayout() {
  useEffect(() => {
    // Fix routing for GitHub Pages subdirectory
    if (Platform.OS === 'web') {
      const path = window.location.pathname;
      const basePath = '/discoveragent';

      // If we're at the base path with trailing slash, ensure proper routing
      if (path === basePath || path === basePath + '/') {
        // Let the router handle the index route
        const newPath = path.endsWith('/') ? path : path + '/';
        if (window.location.pathname !== newPath) {
          window.history.replaceState(null, '', newPath);
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
