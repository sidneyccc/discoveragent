import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
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
