import { Stack } from 'expo-router';
import { usePathname, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useState } from 'react';
import { FaBars } from 'react-icons/fa';

export default function RootLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const navigateTo = (route: '/' | '/transcript') => {
    setMenuOpen(false);
    if (route === pathname) return;
    router.push(route);
  };

  return (
    <SafeAreaProvider>
      <Stack
        initialRouteName="index"
        screenOptions={{
          headerShown: true,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              onPress={() => setMenuOpen((prev) => !prev)}
              style={styles.menuButton}
            >
              <FaBars size={16} color="#111827" />
            </Pressable>
          ),
        }}
      >
        <Stack.Screen
          name="index"
          options={{
            title: 'Home',
          }}
        />
        <Stack.Screen
          name="transcript"
          options={{
            title: 'Transcript',
          }}
        />
      </Stack>

      {menuOpen ? (
        <Pressable style={styles.overlay} onPress={() => setMenuOpen(false)}>
          <Pressable style={styles.menuSheet} onPress={(event) => event.stopPropagation()}>
            <View style={styles.menuList}>
              <Pressable
                style={[styles.menuItem, pathname === '/' ? styles.menuItemActive : null]}
                onPress={() => navigateTo('/')}
              >
                <Text style={styles.menuItemText}>Home</Text>
              </Pressable>
              <Pressable
                style={[styles.menuItem, pathname === '/transcript' ? styles.menuItemActive : null]}
                onPress={() => navigateTo('/transcript')}
              >
                <Text style={styles.menuItemText}>Transcript</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  menuButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(17, 24, 39, 0.14)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 12,
  },
  menuSheet: {
    width: 180,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 7,
  },
  menuList: {
    paddingVertical: 6,
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemActive: {
    backgroundColor: '#f3f4f6',
  },
  menuItemText: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
});
