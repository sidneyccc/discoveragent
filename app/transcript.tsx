import { View, Text, StyleSheet } from 'react-native';

export default function TranscriptScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Transcript</Text>
      <Text style={styles.body}>This page is intentionally empty for now.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  body: {
    fontSize: 15,
    color: '#4b5563',
    lineHeight: 22,
  },
});
