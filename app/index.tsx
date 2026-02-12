import { View, Text, StyleSheet, TouchableOpacity, Platform, Linking, ScrollView, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FaHackerNews, FaMicrophone, FaRedditAlien, FaStackOverflow, FaStop, FaWikipediaW } from 'react-icons/fa';
import { HiNewspaper } from 'react-icons/hi';
import { useRef, useState } from 'react';

function renderInlineBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    const isBold = part.startsWith('**') && part.endsWith('**') && part.length > 4;
    if (isBold) {
      return (
        <Text key={`bold-${idx}`} style={styles.richTextBold}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    return <Text key={`txt-${idx}`}>{part}</Text>;
  });
}

function renderRichText(text: string) {
  const lines = text.split('\n');
  return (
    <View style={styles.richTextContainer}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <View key={`sp-${idx}`} style={styles.richTextSpacer} />;
        }

        if (trimmed === '---') {
          return <View key={`hr-${idx}`} style={styles.richTextDivider} />;
        }

        if (trimmed.startsWith('#### ')) {
          return (
            <Text key={`h4-${idx}`} style={styles.richTextH4}>
              {renderInlineBold(trimmed.slice(5))}
            </Text>
          );
        }

        if (trimmed.startsWith('### ')) {
          return (
            <Text key={`h3-${idx}`} style={styles.richTextH3}>
              {renderInlineBold(trimmed.slice(4))}
            </Text>
          );
        }

        if (trimmed.startsWith('- ')) {
          return (
            <View key={`b-${idx}`} style={styles.richTextBulletRow}>
              <Text style={styles.richTextBullet}>•</Text>
              <Text style={styles.richTextBulletText}>{renderInlineBold(trimmed.slice(2))}</Text>
            </View>
          );
        }

        const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numberedMatch) {
          return (
            <View key={`n-${idx}`} style={styles.richTextBulletRow}>
              <Text style={styles.richTextNumber}>{numberedMatch[1]}.</Text>
              <Text style={styles.richTextBulletText}>{renderInlineBold(numberedMatch[2])}</Text>
            </View>
          );
        }

        return (
          <Text key={`p-${idx}`} style={styles.richTextParagraph}>
            {renderInlineBold(line)}
          </Text>
        );
      })}
    </View>
  );
}

const DEFAULT_SELECTED_SOURCES = [
  'Reuters',
  'AP News',
  'BBC',
  'NPR',
  'Hacker News',
  'Reddit',
  'Stack Overflow',
  'Wikipedia',
];

export default function HomeScreen() {
  const envApiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  const hasPlaceholderApiBaseUrl =
    envApiBaseUrl.includes('<your-vercel-project>') || envApiBaseUrl.includes('your-vercel-project');
  const isLocalWebHost =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const localApiBaseUrl = 'http://127.0.0.1:3001';
  const defaultApiBaseUrl =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('github.io')
      ? 'https://discoveragent.vercel.app'
      : localApiBaseUrl;
  const apiBaseUrl = (
    isLocalWebHost
      ? localApiBaseUrl
      : hasPlaceholderApiBaseUrl || !envApiBaseUrl
        ? defaultApiBaseUrl
        : envApiBaseUrl
  ).replace(/\/$/, '');

  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [categorizedResult, setCategorizedResult] = useState('');
  const [categorizeError, setCategorizeError] = useState('');
  const recognitionRef = useRef<any>(null);

  const openURL = (url: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
    Linking.openURL(url);
  };

  const sources = [
    { name: 'Reuters', url: 'https://www.reuters.com', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'AP News', url: 'https://apnews.com', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'BBC', url: 'https://www.bbc.com/news', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'NPR', url: 'https://www.npr.org', icon: <HiNewspaper size={32} color="#111" /> },
    { name: 'Hacker News', url: 'https://news.ycombinator.com', icon: <FaHackerNews size={32} color="#FF6600" /> },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: <FaRedditAlien size={32} color="#FF4500" /> },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com', icon: <FaStackOverflow size={32} color="#F48024" /> },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: <FaWikipediaW size={32} color="#111" /> },
  ];

  const canUseVoiceInput =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const handleVoiceInput = () => {
    if (!canUseVoiceInput || typeof window === 'undefined') return;

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) return;

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setQuestion(transcript);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleCategorize = async () => {
    const trimmed = question.trim();
    if (!trimmed) return;

    setSubmittedQuestion(trimmed);
    setIsLoading(true);
    setCategorizedResult('');
    setCategorizeError('');

    try {
      const res = await fetch(`${apiBaseUrl}/api/categorize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmed,
          selectedSources: DEFAULT_SELECTED_SOURCES,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to categorize response.';
        const details = typeof data?.details === 'string' ? data.details : '';
        setCategorizeError(details ? `${message} ${details}` : message);
        return;
      }

      setCategorizedResult(
        typeof data?.categorized === 'string' ? data.categorized : 'No categorized output returned.'
      );
    } catch {
      setCategorizeError(`Could not connect to API server at ${apiBaseUrl}.`);
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
            Enter a question to directly generate a source-categorized summary from trusted outlets.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Example: What are the pros and cons of AI regulation right now?"
            placeholderTextColor="#888"
            value={question}
            onChangeText={setQuestion}
            multiline
          />
          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.askButton} onPress={handleCategorize}>
              <Text style={styles.askButtonText}>Categorize Opinions</Text>
            </TouchableOpacity>
            {canUseVoiceInput ? (
              <TouchableOpacity
                style={[styles.micIconButton, isListening ? styles.micIconButtonActive : styles.micIconButtonIdle]}
                onPress={handleVoiceInput}
              >
                {isListening ? (
                  <FaStop size={14} color="#fff" />
                ) : (
                  <FaMicrophone size={16} color="#0f172a" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>

          {submittedQuestion ? (
            <Text style={styles.statusText}>
              Submitted: "{submittedQuestion}"
            </Text>
          ) : null}

          {isLoading || categorizeError || categorizedResult ? (
            <View style={styles.answerFrame}>
              {isLoading ? (
                <Text style={styles.answerFrameText}>Categorizing...</Text>
              ) : categorizeError ? (
                <Text style={styles.answerFrameError}>{categorizeError}</Text>
              ) : (
                renderRichText(categorizedResult)
              )}
            </View>
          ) : null}
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
    backgroundColor: '#007AFF',
    borderRadius: 8,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  askButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  micIconButton: {
    borderRadius: 8,
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  micIconButtonIdle: {
    backgroundColor: '#eef2ff',
    borderColor: '#c7d2fe',
  },
  micIconButtonActive: {
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
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
  richTextBold: {
    fontWeight: '700',
    color: '#111827',
  },
  richTextContainer: {
    gap: 2,
  },
  richTextSpacer: {
    height: 6,
  },
  richTextDivider: {
    marginTop: 8,
    marginBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  richTextH3: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  richTextH4: {
    marginTop: 6,
    marginBottom: 2,
    fontSize: 13,
    fontWeight: '700',
    color: '#1e293b',
  },
  richTextParagraph: {
    fontSize: 14,
    color: '#333',
    lineHeight: 20,
  },
  richTextBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 2,
  },
  richTextBullet: {
    width: 14,
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
    fontWeight: '700',
  },
  richTextNumber: {
    width: 24,
    fontSize: 14,
    lineHeight: 20,
    color: '#334155',
    fontWeight: '700',
  },
  richTextBulletText: {
    flex: 1,
    fontSize: 14,
    color: '#333',
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
