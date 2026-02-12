import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking, ScrollView, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FaHackerNews, FaRedditAlien, FaStackOverflow, FaWikipediaW } from 'react-icons/fa';
import { HiNewspaper } from 'react-icons/hi';
import { useState } from 'react';

type Source = {
  name: string;
  url: string;
  icon: JSX.Element;
};

export default function HomeScreen() {
  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [hasAsked, setHasAsked] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState('');

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

  const handleAsk = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setHasAsked(true);
    setSubmittedQuestion(trimmed);
    setIsLoading(true);
    setAnswer('');
    setAnswerError('');

    try {
      const res = await fetch('http://127.0.0.1:3001/api/ask', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to fetch answer.';
        const details = typeof data?.details === 'string' ? data.details : '';
        setAnswerError(details ? `${message} ${details}` : message);
        return;
      }

      setAnswer(typeof data?.answer === 'string' ? data.answer : 'No answer text returned.');
    } catch {
      setAnswerError('Could not connect to API server on 127.0.0.1:3001.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <StatusBar style="auto" />

      <View style={styles.content}>
        <Text style={styles.title}>Welcome to DiscoverAgent</Text>
        <Text style={styles.subtitle}>
          Running on {Platform.OS === 'web' ? 'Web' : 'iOS'}
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ask a Question</Text>
          <Text style={styles.cardText}>
            Enter a question to prepare a cross-source summary from trusted outlets.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Example: What are the pros and cons of AI regulation right now?"
            placeholderTextColor="#888"
            value={question}
            onChangeText={setQuestion}
            multiline
          />
          <TouchableOpacity style={styles.askButton} onPress={handleAsk}>
            <Text style={styles.askButtonText}>Ask</Text>
          </TouchableOpacity>
          {submittedQuestion ? (
            <Text style={styles.statusText}>
              Submitted: "{submittedQuestion}"
            </Text>
          ) : null}
          {hasAsked ? (
            <View style={styles.answerFrame}>
              <Text style={styles.answerFrameTitle}>ChatGPT Response</Text>
              {isLoading ? (
                <Text style={styles.answerFrameText}>Thinking...</Text>
              ) : answerError ? (
                <Text style={styles.answerFrameError}>{answerError}</Text>
              ) : (
                <Text style={styles.answerFrameText}>{answer}</Text>
              )}
            </View>
          ) : null}
        </View>

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
  input: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#333',
    backgroundColor: '#fafafa',
    minHeight: 80,
    textAlignVertical: 'top',
  },
  askButton: {
    marginTop: 12,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  askButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  statusText: {
    marginTop: 10,
    color: '#444',
    fontSize: 13,
  },
  answerFrame: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#d6d6d6',
    borderRadius: 8,
    backgroundColor: '#fcfcfc',
    padding: 12,
  },
  answerFrameTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#222',
    marginBottom: 6,
  },
  answerFrameText: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  answerFrameError: {
    fontSize: 14,
    color: '#b42318',
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
