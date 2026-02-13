import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, TextInput, Animated, Easing, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FaMicrophone, FaStop, FaTv, FaRegCompass } from 'react-icons/fa';
import { SiCnn, SiNeteasecloudmusic, SiReddit, SiSinaweibo, SiStackoverflow, SiWikipedia, SiYcombinator } from 'react-icons/si';
import { useEffect, useRef, useState } from 'react';

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

function sourceBadge(label: string, backgroundColor: string, color = '#fff') {
  return (
    <View style={[styles.sourceBadge, { backgroundColor }]}>
      <Text style={[styles.sourceBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

const DEFAULT_SELECTED_SOURCES = [
  'Reuters',
  'AP News',
  'BBC',
  'NPR',
  'Weibo',
  'CNN',
  '网易',
  'CCTV',
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
  const hostedApiBaseUrl = 'https://discoveragent.vercel.app';
  const defaultApiBaseUrl =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('github.io')
      ? hostedApiBaseUrl
      : localApiBaseUrl;
  const apiBaseUrl = (
    isLocalWebHost
      ? localApiBaseUrl
      : hasPlaceholderApiBaseUrl || !envApiBaseUrl
        ? defaultApiBaseUrl
        : envApiBaseUrl
  ).replace(/\/$/, '');
  const preferredLanguage =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.language === 'string' &&
    navigator.language
      ? navigator.language
      : 'en-US';

  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [categorizedResult, setCategorizedResult] = useState('');
  const [categorizeError, setCategorizeError] = useState('');
  const [isAllSourcesLoading, setIsAllSourcesLoading] = useState(false);
  const [isSourceCategorizing, setIsSourceCategorizing] = useState(false);
  const [allSourcesError, setAllSourcesError] = useState('');
  const [sourceCategorizeError, setSourceCategorizeError] = useState('');
  const [allSourceSummaries, setAllSourceSummaries] = useState<Array<{
    name: string;
    url: string;
    summary: string;
    error: string;
  }>>([]);
  const [clusteredSourcesResult, setClusteredSourcesResult] = useState('');
  const [clusteredSourcesMeta, setClusteredSourcesMeta] = useState('');
  const [sourceViewportWidth, setSourceViewportWidth] = useState(0);
  const [sourceContentWidth, setSourceContentWidth] = useState(0);
  const [isSourceListInteracting, setIsSourceListInteracting] = useState(false);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceScrollRef = useRef<ScrollView | null>(null);
  const sourceAutoScrollOffsetRef = useRef(0);
  const sourceInteractionTimeoutRef = useRef<any>(null);
  const waveFlow = useRef(new Animated.Value(0)).current;
  const waveSwell = useRef(new Animated.Value(0)).current;
  const waveDrift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const flowAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveFlow, {
          toValue: 1,
          duration: 8200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(waveFlow, {
          toValue: 0,
          duration: 8200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    const swellAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveSwell, {
          toValue: 1,
          duration: 6400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(waveSwell, {
          toValue: 0,
          duration: 6400,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ])
    );

    const driftAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(waveDrift, {
          toValue: 1,
          duration: 11200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(waveDrift, {
          toValue: 0,
          duration: 11200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    flowAnim.start();
    swellAnim.start();
    driftAnim.start();

    return () => {
      flowAnim.stop();
      swellAnim.stop();
      driftAnim.stop();
    };
  }, [waveDrift, waveFlow, waveSwell]);

  useEffect(() => {
    if (sourceContentWidth <= sourceViewportWidth + 8) return;

    const interval = setInterval(() => {
      if (isSourceListInteracting) return;

      const maxOffset = Math.max(0, sourceContentWidth - sourceViewportWidth);
      let nextOffset = sourceAutoScrollOffsetRef.current + 0.35;
      if (nextOffset > maxOffset) {
        nextOffset = 0;
      }

      sourceAutoScrollOffsetRef.current = nextOffset;
      sourceScrollRef.current?.scrollTo({ x: nextOffset, animated: false });
    }, 32);

    return () => clearInterval(interval);
  }, [isSourceListInteracting, sourceContentWidth, sourceViewportWidth]);

  useEffect(() => {
    return () => {
      if (sourceInteractionTimeoutRef.current) {
        clearTimeout(sourceInteractionTimeoutRef.current);
      }
    };
  }, []);

  const markSourceListInteraction = () => {
    setIsSourceListInteracting(true);
    if (sourceInteractionTimeoutRef.current) {
      clearTimeout(sourceInteractionTimeoutRef.current);
    }
    sourceInteractionTimeoutRef.current = setTimeout(() => {
      setIsSourceListInteracting(false);
    }, 1400);
  };

  const bubbleOneStyle = {
    transform: [
      {
        translateX: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [-26, 34],
        }),
      },
      {
        translateY: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [-8, 10],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.24, 0.5],
    }),
  };

  const bubbleTwoStyle = {
    transform: [
      {
        translateX: waveDrift.interpolate({
          inputRange: [0, 1],
          outputRange: [34, -30],
        }),
      },
      {
        translateY: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [10, -8],
        }),
      },
      {
        scaleX: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [1.03, 0.96],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.2, 0.44],
    }),
  };

  const bubbleThreeStyle = {
    transform: [
      {
        translateX: waveDrift.interpolate({
          inputRange: [0, 1],
          outputRange: [-18, 24],
        }),
      },
      {
        translateY: waveFlow.interpolate({
          inputRange: [0, 1],
          outputRange: [-12, 14],
        }),
      },
      {
        scaleX: waveSwell.interpolate({
          inputRange: [0, 1],
          outputRange: [0.95, 1.05],
        }),
      },
    ],
    opacity: waveSwell.interpolate({
      inputRange: [0, 1],
      outputRange: [0.16, 0.36],
    }),
  };

  const appendToQuestion = (newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed) return;
    setQuestion((prev) => (prev.trim() ? `${prev.trim()} ${trimmed}` : trimmed));
  };

  const sources = [
    { name: 'Reuters', url: 'https://www.reuters.com', icon: sourceBadge('R', '#FF6F20') },
    { name: 'AP News', url: 'https://apnews.com', icon: sourceBadge('AP', '#111') },
    { name: 'BBC', url: 'https://www.bbc.com/news', icon: sourceBadge('BBC', '#000') },
    { name: 'NPR', url: 'https://www.npr.org', icon: sourceBadge('NPR', '#D62020') },
    { name: 'Weibo', url: 'https://weibo.com', icon: <SiSinaweibo size={32} color="#E6162D" /> },
    { name: 'CNN', url: 'https://www.cnn.com', icon: <SiCnn size={32} color="#CC0000" /> },
    { name: '网易', url: 'https://www.163.com', icon: <SiNeteasecloudmusic size={32} color="#D71920" /> },
    { name: 'CCTV', url: 'https://english.cctv.com', icon: <FaTv size={32} color="#C8102E" /> },
    { name: 'Hacker News', url: 'https://news.ycombinator.com', icon: <SiYcombinator size={32} color="#FF6600" /> },
    { name: 'Reddit', url: 'https://www.reddit.com', icon: <SiReddit size={32} color="#FF4500" /> },
    { name: 'Stack Overflow', url: 'https://stackoverflow.com', icon: <SiStackoverflow size={32} color="#F48024" /> },
    { name: 'Wikipedia', url: 'https://www.wikipedia.org', icon: <SiWikipedia size={32} color="#111" /> },
  ];

  const isIOSWeb =
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);

  const canUseSpeechRecognition =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const canUseAudioRecording =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    !!(window as any).MediaRecorder;
  const canUseVoiceInput = canUseSpeechRecognition || canUseAudioRecording;

  const stopMediaStream = () => {
    if (!mediaStreamRef.current) return;
    for (const track of mediaStreamRef.current.getTracks()) {
      track.stop();
    }
    mediaStreamRef.current = null;
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          reject(new Error('Failed to read recorded audio.'));
          return;
        }
        const separatorIdx = result.indexOf(',');
        resolve(separatorIdx >= 0 ? result.slice(separatorIdx + 1) : result);
      };
      reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
      reader.readAsDataURL(blob);
    });

  const transcribeAudioBlob = async (blob: Blob, mimeType: string) => {
    setIsTranscribingVoice(true);
    setVoiceError('');
    try {
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch(`${apiBaseUrl}/api/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audioBase64,
          mimeType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to transcribe audio.';
        const details = typeof data?.details === 'string' ? data.details : '';
        setVoiceError(details ? `${message} ${details}` : message);
        return;
      }

      const transcript = typeof data?.transcript === 'string' ? data.transcript.trim() : '';
      if (!transcript) {
        setVoiceError('No transcript returned from audio.');
        return;
      }
      appendToQuestion(transcript);
    } catch (error) {
      setVoiceError(
        error instanceof Error ? `Audio transcription failed: ${error.message}` : 'Audio transcription failed.'
      );
    } finally {
      setIsTranscribingVoice(false);
    }
  };

  const toggleAudioRecording = async () => {
    if (!canUseAudioRecording || typeof window === 'undefined' || typeof navigator === 'undefined') {
      setVoiceError('Audio recording is not supported on this browser.');
      return;
    }

    const existingRecorder = mediaRecorderRef.current;
    if (existingRecorder && existingRecorder.state !== 'inactive') {
      try {
        existingRecorder.stop();
      } catch {
        // no-op
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const MediaRecorderCtor = (window as any).MediaRecorder;
      const recorder = new MediaRecorderCtor(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (event: any) => {
        if (event?.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => {
        setVoiceError('Audio recording failed.');
        setIsListening(false);
        mediaRecorderRef.current = null;
        stopMediaStream();
      };

      recorder.onstop = async () => {
        setIsListening(false);
        mediaRecorderRef.current = null;
        const mimeType = recorder.mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        stopMediaStream();
        if (!blob.size) {
          setVoiceError('No audio captured. Please try again.');
          return;
        }
        await transcribeAudioBlob(blob, mimeType);
      };

      mediaRecorderRef.current = recorder;
      setVoiceError('');
      recorder.start();
      setIsListening(true);
    } catch {
      setVoiceError('Microphone access failed. Enable permission and try again.');
      setIsListening(false);
      mediaRecorderRef.current = null;
      stopMediaStream();
    }
  };

  const handleVoiceInput = async () => {
    if (!canUseVoiceInput || typeof window === 'undefined') {
      setVoiceError('Voice input is not supported on this browser.');
      return;
    }

    if (isIOSWeb || !canUseSpeechRecognition) {
      await toggleAudioRecording();
      return;
    }

    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceError('Voice input is not supported on this browser.');
      return;
    }

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
    recognition.lang = preferredLanguage || 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setVoiceError('');
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      const transcript = event?.results?.[0]?.[0]?.transcript?.trim();
      if (transcript) {
        appendToQuestion(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      setIsListening(false);
      recognitionRef.current = null;
      const code = typeof event?.error === 'string' ? event.error : 'unknown-error';
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setVoiceError('Microphone permission was denied. Enable mic access in browser settings.');
        return;
      }
      if (code === 'language-not-supported') {
        setVoiceError('Speech recognition language is not supported on this browser.');
        return;
      }
      if (code === 'no-speech') {
        setVoiceError('No speech detected. Try again in a quieter environment.');
        return;
      }
      setVoiceError(`Voice input failed (${code}).`);
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (error) {
      recognitionRef.current = null;
      setIsListening(false);
      setVoiceError(error instanceof Error ? `Voice input failed to start: ${error.message}` : 'Voice input failed to start.');
    }
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

  const requestSourceSummary = async (source: { name: string; url: string }) => {
    let res: Response;
    try {
      res = await fetch(`${apiBaseUrl}/api/source-summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceName: source.name,
          sourceUrl: source.url,
          preferredLanguage,
        }),
      });
    } catch {
      if (apiBaseUrl === localApiBaseUrl) {
        res = await fetch(`${hostedApiBaseUrl}/api/source-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sourceName: source.name,
            sourceUrl: source.url,
            preferredLanguage,
          }),
        });
      } else {
        throw new Error('primary-source-summary-fetch-failed');
      }
    }

    if (!res.ok && apiBaseUrl === localApiBaseUrl) {
      try {
        res = await fetch(`${hostedApiBaseUrl}/api/source-summary`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sourceName: source.name,
            sourceUrl: source.url,
            preferredLanguage,
          }),
        });
      } catch {
        // keep original failure handling below
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to summarize source.');
    }
    return typeof data?.summary === 'string' && data.summary.trim() ? data.summary.trim() : 'No summary returned.';
  };

  const handleSummarizeAllSources = async () => {
    setIsAllSourcesLoading(true);
    setAllSourcesError('');
    setSourceCategorizeError('');
    setAllSourceSummaries([]);
    setClusteredSourcesResult('');
    setClusteredSourcesMeta('');

    try {
      const settled = await Promise.allSettled(
        sources.map(async (source) => {
          try {
            const summary = await requestSourceSummary(source);
            return { name: source.name, url: source.url, summary, error: '' };
          } catch (error) {
            return {
              name: source.name,
              url: source.url,
              summary: '',
              error: error instanceof Error ? error.message : 'Failed to summarize source.',
            };
          }
        })
      );

      const normalized = settled.map((item, idx) =>
        item.status === 'fulfilled'
          ? item.value
          : {
              name: sources[idx].name,
              url: sources[idx].url,
              summary: '',
              error: 'Failed to summarize source.',
            }
      );

      setAllSourceSummaries(normalized);
      const failedCount = normalized.filter((s) => s.error).length;
      setClusteredSourcesMeta(
        failedCount > 0
          ? `Fetched summaries for ${normalized.length - failedCount}/${normalized.length} sources.`
          : `Fetched summaries for ${normalized.length} sources.`
      );
      await handleCategorizeFetchedSources(normalized);
    } catch {
      setAllSourcesError(`Could not connect to API server at ${apiBaseUrl}.`);
    } finally {
      setIsAllSourcesLoading(false);
    }
  };

  const handleCategorizeFetchedSources = async (
    sourceSummariesInput?: Array<{ name: string; url: string; summary: string; error: string }>
  ) => {
    const successful = (sourceSummariesInput || allSourceSummaries).filter((s) => !s.error && s.summary.trim());
    if (!successful.length) {
      setSourceCategorizeError('No successful source summaries to categorize.');
      return;
    }

    setIsSourceCategorizing(true);
    setSourceCategorizeError('');
    setClusteredSourcesResult('');

    try {
      let res: Response;
      try {
        res = await fetch(`${apiBaseUrl}/api/source-categorize`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sourceSummaries: successful.map((s) => ({ name: s.name, url: s.url, summary: s.summary })),
            preferredLanguage,
          }),
        });
      } catch {
        if (apiBaseUrl === localApiBaseUrl) {
          res = await fetch(`${hostedApiBaseUrl}/api/source-categorize`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sourceSummaries: successful.map((s) => ({ name: s.name, url: s.url, summary: s.summary })),
              preferredLanguage,
            }),
          });
        } else {
          throw new Error('source-categorize-fetch-failed');
        }
      }

      const data = await res.json();
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to categorize summaries.';
        setSourceCategorizeError(message);
        return;
      }

      setClusteredSourcesResult(
        typeof data?.clustered === 'string' && data.clustered.trim()
          ? data.clustered.trim()
          : 'No clustered output returned.'
      );
    } catch {
      setSourceCategorizeError(`Could not connect to API server at ${apiBaseUrl}.`);
    } finally {
      setIsSourceCategorizing(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <StatusBar style="auto" />

      <View style={styles.content}>
        <View style={styles.backgroundSeaTint} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleOne, bubbleOneStyle]} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleTwo, bubbleTwoStyle]} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleThree, bubbleThreeStyle]} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleFour, bubbleTwoStyle]} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleFive, bubbleThreeStyle]} />
        <Animated.View style={[styles.backgroundBubble, styles.backgroundBubbleSix, bubbleOneStyle]} />

        <View style={styles.heroBlock}>
          <Text style={styles.title}>Credible Search</Text>
          <Text style={styles.subtitle}>
            Ask once and get clustered viewpoints.
          </Text>
        </View>

        <View style={styles.card}>
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
              <Text style={styles.askButtonText}>Analyze Perspectives</Text>
            </TouchableOpacity>
            {canUseVoiceInput ? (
              <TouchableOpacity
                style={[styles.micIconButton, isListening ? styles.micIconButtonActive : styles.micIconButtonIdle]}
                onPress={handleVoiceInput}
                disabled={isTranscribingVoice}
              >
                {isListening ? (
                  <FaStop size={14} color="#fff" />
                ) : (
                  <FaMicrophone size={16} color="#0f172a" />
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          {isTranscribingVoice ? (
            <Text style={styles.voiceInfoText}>Transcribing voice...</Text>
          ) : null}
          {voiceError ? <Text style={styles.voiceErrorText}>{voiceError}</Text> : null}

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

        <View style={styles.iconsSection}>
          <ScrollView
            ref={sourceScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.iconsContainer}
            onLayout={(event) => setSourceViewportWidth(event.nativeEvent.layout.width)}
            onContentSizeChange={(width) => setSourceContentWidth(width)}
            onScroll={(event) => {
              sourceAutoScrollOffsetRef.current = event.nativeEvent.contentOffset.x;
            }}
            onScrollBeginDrag={markSourceListInteraction}
            onScrollEndDrag={markSourceListInteraction}
            onMomentumScrollEnd={markSourceListInteraction}
            scrollEventThrottle={16}
          >
            {sources.map((source) => (
              <View
                key={source.name}
                style={styles.iconButton}
              >
                {source.icon}
                <Text style={styles.iconLabel}>{source.name}</Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={styles.bulkActionWrap}>
          <TouchableOpacity
            style={[styles.bulkActionButton, isAllSourcesLoading ? styles.bulkActionButtonDisabled : null]}
            onPress={handleSummarizeAllSources}
            disabled={isAllSourcesLoading}
          >
            <View style={styles.bulkActionButtonRow}>
              <FaRegCompass size={14} color="#fff" />
              <Text style={styles.bulkActionButtonText}>
                {isAllSourcesLoading ? 'Gathering Latest Source Highlights...' : 'Discover Latest Highlights'}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {isAllSourcesLoading ? (
          <View style={styles.bulkLoadingWrap}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.bulkLoadingText}>Fetching sources in parallel and summarizing each source...</Text>
          </View>
        ) : null}

        {allSourcesError ? <Text style={styles.bulkErrorText}>{allSourcesError}</Text> : null}

        {clusteredSourcesMeta ? <Text style={styles.bulkMetaText}>{clusteredSourcesMeta}</Text> : null}

        {allSourceSummaries.length > 0 ? (
          <View style={styles.bulkSummaryList}>
            {allSourceSummaries.map((item) => (
              <View key={item.name} style={styles.bulkSummaryCard}>
                <Text style={styles.bulkSummaryTitle}>{item.name}</Text>
                <Text style={styles.bulkSummaryUrl}>{item.url}</Text>
                <View style={styles.bulkSummaryBody}>
                  {item.error ? (
                    <Text style={styles.bulkSummaryError}>{item.error}</Text>
                  ) : (
                    renderRichText(item.summary)
                  )}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {isSourceCategorizing ? (
          <View style={styles.bulkLoadingWrap}>
            <ActivityIndicator size="small" color="#2563eb" />
            <Text style={styles.bulkLoadingText}>Organizing shared narratives by source coverage...</Text>
          </View>
        ) : null}

        {sourceCategorizeError ? <Text style={styles.bulkErrorText}>{sourceCategorizeError}</Text> : null}

        {clusteredSourcesResult ? (
          <View style={styles.bulkSummaryList}>
            <View style={styles.bulkSummaryCard}>
              <Text style={styles.bulkSummaryTitle}>Ranked Source Clusters</Text>
              <View style={styles.bulkSummaryBody}>
                {renderRichText(clusteredSourcesResult)}
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f2f2f7',
  },
  contentContainer: {
    flexGrow: 1,
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 20,
    paddingBottom: 24,
    justifyContent: 'flex-start',
    alignItems: 'center',
    position: 'relative',
  },
  backgroundSeaTint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(152, 207, 246, 0.18)',
    pointerEvents: 'none',
  },
  backgroundBubble: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(102, 181, 235, 0.28)',
    pointerEvents: 'none',
  },
  backgroundBubbleOne: {
    top: 74,
    right: 42,
    width: 112,
    height: 112,
    backgroundColor: 'rgba(92, 172, 228, 0.34)',
  },
  backgroundBubbleTwo: {
    top: 120,
    left: 34,
    width: 64,
    height: 64,
    backgroundColor: 'rgba(113, 194, 243, 0.42)',
  },
  backgroundBubbleThree: {
    top: 182,
    right: 112,
    width: 88,
    height: 88,
    backgroundColor: 'rgba(79, 159, 220, 0.3)',
  },
  backgroundBubbleFour: {
    top: 266,
    left: 72,
    width: 48,
    height: 48,
    backgroundColor: 'rgba(128, 203, 248, 0.46)',
  },
  backgroundBubbleFive: {
    top: 338,
    right: 36,
    width: 72,
    height: 72,
    backgroundColor: 'rgba(102, 181, 235, 0.38)',
  },
  backgroundBubbleSix: {
    top: 410,
    left: 120,
    width: 56,
    height: 56,
    backgroundColor: 'rgba(85, 167, 227, 0.34)',
  },
  heroBlock: {
    width: '100%',
    maxWidth: 640,
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 21,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 24,
    padding: 16,
    marginBottom: 14,
    width: '100%',
    maxWidth: 640,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
    borderWidth: 1,
    borderColor: '#eceff3',
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 10,
    letterSpacing: -0.4,
  },
  cardText: {
    fontSize: 14,
    color: '#4b5563',
    lineHeight: 22,
  },
  input: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#d9dce3',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#111827',
    backgroundColor: '#f9fafb',
    minHeight: 84,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: 'top',
  },
  askButton: {
    backgroundColor: '#007AFF',
    borderRadius: 14,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
  },
  askButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    letterSpacing: 0.1,
  },
  actionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  micIconButton: {
    borderRadius: 14,
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  micIconButtonIdle: {
    backgroundColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  micIconButtonActive: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  statusText: {
    marginTop: 12,
    color: '#6b7280',
    fontSize: 12,
  },
  answerFrame: {
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
    backgroundColor: '#fbfbfd',
    padding: 14,
  },
  answerFrameText: {
    fontSize: 14,
    color: '#1f2937',
    lineHeight: 22,
  },
  answerFrameError: {
    fontSize: 14,
    color: '#b42318',
    lineHeight: 22,
  },
  voiceInfoText: {
    marginTop: 8,
    fontSize: 12,
    color: '#334155',
    lineHeight: 18,
  },
  voiceErrorText: {
    marginTop: 8,
    fontSize: 12,
    color: '#b42318',
    lineHeight: 18,
  },
  richTextBold: {
    fontWeight: '700',
    color: '#111111',
  },
  richTextContainer: {
    gap: 3,
  },
  richTextSpacer: {
    height: 8,
  },
  richTextDivider: {
    marginTop: 10,
    marginBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  richTextH3: {
    marginTop: 10,
    marginBottom: 6,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.2,
  },
  richTextH4: {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 14,
    fontWeight: '700',
    color: '#1f2937',
  },
  richTextParagraph: {
    fontSize: 14,
    color: '#1f2937',
    lineHeight: 22,
  },
  richTextBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  richTextBullet: {
    width: 16,
    fontSize: 14,
    lineHeight: 22,
    color: '#4b5563',
    fontWeight: '700',
  },
  richTextNumber: {
    width: 28,
    fontSize: 14,
    lineHeight: 22,
    color: '#4b5563',
    fontWeight: '700',
  },
  richTextBulletText: {
    flex: 1,
    fontSize: 14,
    color: '#1f2937',
    lineHeight: 22,
  },
  sourceBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  iconsSection: {
    width: '100%',
    maxWidth: 760,
    marginTop: 20,
  },
  iconsContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    minWidth: 94,
    borderWidth: 1,
    borderColor: '#eceff3',
  },
  iconLabel: {
    marginTop: 8,
    fontSize: 11,
    color: '#374151',
    fontWeight: '500',
    textAlign: 'center',
  },
  bulkActionWrap: {
    width: '100%',
    maxWidth: 640,
    marginTop: 16,
    marginBottom: 8,
  },
  bulkActionButton: {
    backgroundColor: '#2563eb',
    borderRadius: 12,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkActionButtonDisabled: {
    backgroundColor: '#93c5fd',
  },
  bulkActionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  bulkActionButtonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkLoadingWrap: {
    width: '100%',
    maxWidth: 640,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  bulkLoadingText: {
    fontSize: 13,
    color: '#334155',
  },
  bulkErrorText: {
    width: '100%',
    maxWidth: 640,
    marginTop: 8,
    fontSize: 13,
    color: '#b42318',
  },
  bulkMetaText: {
    width: '100%',
    maxWidth: 760,
    marginTop: 10,
    fontSize: 12,
    color: '#64748b',
  },
  bulkSummaryList: {
    width: '100%',
    maxWidth: 760,
    marginTop: 12,
    gap: 10,
  },
  bulkSummaryCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  bulkSummaryTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  bulkSummaryUrl: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 8,
  },
  bulkSummaryBody: {
    borderTopColor: '#e5e7eb',
    borderTopWidth: 1,
    paddingTop: 8,
  },
  bulkSummaryError: {
    fontSize: 14,
    color: '#b42318',
    lineHeight: 22,
  },
});
