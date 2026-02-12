import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FaHackerNews, FaRedditAlien, FaStackOverflow, FaWikipediaW } from 'react-icons/fa';
import { HiNewspaper } from 'react-icons/hi';

type Source = {
  name: string;
  url: string;
  icon: JSX.Element;
};

export default function HomeScreen() {
  const openURL = (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    Linking.openURL(url);
  };

  const sources: Source[] = [
    { name: 'Reuters', url: 'https://www.reuters.com', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'AP News', url: 'https://apnews.com', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'BBC', url: 'https://www.bbc.com/news', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'NPR', url: 'https://www.npr.org', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'Hacker News', url: 'https://news.ycombinator.com', icon: <FaHackerNews size={32} color="#FF6600" /> },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: <FaRedditAlien size={32} color="#FF4500" /> },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com', icon: <FaStackOverflow size={32} color="#F48024" /> },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: <FaWikipediaW size={32} color="#111" /> },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <StatusBar style="auto" />

      <View style={styles.content}>
        <Text style={styles.title}>Welcome to DiscoverAgent</Text>
        <Text style={styles.subtitle}>
          Running on {Platform.OS === 'web' ? 'Web' : 'iOS'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Trusted Sources</Text>
          <Text style={styles.cardText}>
            Quick links to reputable news outlets and high-signal discussion communities.
          </Text>
        </View>

        <View style={styles.iconsContainer}>
          {sources.map((source) => (
            <TouchableOpacity
              key={source.name}
              style={styles.iconButton}
              onPress={() => openURL(source.url)}
            >
              {source.icon}
              <Text style={styles.iconLabel}>{source.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  contentContainer: {
    flexGrow: 1,
  },
  content: {
    padding: 20,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    marginBottom: 24,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  cardText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  iconsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 12,
    width: '100%',
    maxWidth: 480,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    minWidth: 140,
    flexBasis: '47%',
  },
  iconLabel: {
    marginTop: 8,
    fontSize: 13,
    color: '#333',
    fontWeight: '500',
    textAlign: 'center',
  },
});
