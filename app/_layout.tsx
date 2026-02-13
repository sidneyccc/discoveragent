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

  const navigateTo = (route: '/' | '/transcript' | '/dashboard') => {
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
          headerBackVisible: false,
          headerLeft: () => <View style={styles.headerSideSpacer} />,
          headerTitleAlign: 'center',
          headerStyle: {
            backgroundColor: '#ffffff',
          },
          headerShadowVisible: true,
          headerTintColor: '#111827',
          headerTitle: () => (
            <View style={styles.brandTitleWrap}>
              <View style={styles.brandHalo}>
                <View style={styles.brandDotOuter}>
                  <View style={styles.brandDotInner} />
                </View>
              </View>
              <Text style={styles.brandTitle}>SidAgent</Text>
            </View>
          ),
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
          }}
        />
        <Stack.Screen
          name="transcript"
          options={{
          }}
        />
        <Stack.Screen
          name="dashboard"
          options={{
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
                <Text style={styles.menuItemText}>Credible Search</Text>
              </Pressable>
              <Pressable
                style={[styles.menuItem, pathname === '/transcript' ? styles.menuItemActive : null]}
                onPress={() => navigateTo('/transcript')}
              >
                <Text style={styles.menuItemText}>Transcript</Text>
              </Pressable>
              <Pressable
                style={[styles.menuItem, pathname === '/dashboard' ? styles.menuItemActive : null]}
                onPress={() => navigateTo('/dashboard')}
              >
                <Text style={styles.menuItemText}>Dashboard</Text>
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
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  headerSideSpacer: {
    width: 40,
    height: 40,
  },
  brandTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandHalo: {
    width: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(129, 140, 248, 0.18)',
    shadowColor: '#818cf8',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  brandDotOuter: {
    width: 11,
    height: 11,
    borderRadius: 999,
    borderWidth: 1.8,
    borderColor: '#64748b',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  brandDotInner: {
    width: 4.5,
    height: 4.5,
    borderRadius: 999,
    backgroundColor: '#60a5fa',
  },
  brandTitle: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.8,
    color: '#6b7280',
    textShadowColor: 'rgba(255,255,255,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
