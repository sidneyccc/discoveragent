import { View, Text, StyleSheet, TouchableOpacity, Platform, ScrollView, TextInput, Animated, Easing, ActivityIndicator, useWindowDimensions, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { FaMicrophone, FaStop, FaTv, FaRegCompass } from 'react-icons/fa';
import { SiCnn, SiNeteasecloudmusic, SiReddit, SiSinaweibo, SiYcombinator } from 'react-icons/si';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppLanguage } from '../lib/language-context';

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

function splitRankedClusters(text: string) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const numberedBlocks = Array.from(normalized.matchAll(/(?:^|\n)(\d+[.)]\s[\s\S]*?)(?=\n\d+[.)]\s|$)/g))
    .map((m) => (m[1] || '').trim())
    .filter(Boolean);
  if (numberedBlocks.length) return numberedBlocks;

  const headingBlocks = Array.from(normalized.matchAll(/(?:^|\n)(#{2,4}\s[^\n]+[\s\S]*?)(?=\n#{2,4}\s|$)/g))
    .map((m) => (m[1] || '').trim())
    .filter(Boolean);
  if (headingBlocks.length) return headingBlocks;

  const titledBlocks = Array.from(normalized.matchAll(/(?:^|\n)(Title:\s[^\n]+[\s\S]*?)(?=\nTitle:\s|$)/g))
    .map((m) => (m[1] || '').trim())
    .filter(Boolean);
  if (titledBlocks.length) return titledBlocks;

  return [normalized];
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
const TOP_NEWS_PREFETCH_COUNT = 5;

export default function HomeScreen() {
  const { width: viewportWidth } = useWindowDimensions();
  const { language, preferredLocale } = useAppLanguage();
  const isZh = language === 'zh';
  const isMobileClusterLayout = viewportWidth < 760;
  const envApiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  const isLocalWebHost =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const localApiBaseUrl = 'http://127.0.0.1:3001';
  const fallbackHostedApiBaseUrl = 'https://discoveragent.vercel.app';
  const normalizedEnvApiBaseUrl = envApiBaseUrl.replace(/\/$/, '');
  const envLooksLocal =
    normalizedEnvApiBaseUrl.includes('127.0.0.1') ||
    normalizedEnvApiBaseUrl.includes('localhost') ||
    normalizedEnvApiBaseUrl.includes('::1');
  const envLooksPlaceholder =
    normalizedEnvApiBaseUrl.includes('<your-vercel-project>') ||
    normalizedEnvApiBaseUrl.includes('your-vercel-project');

  const apiBaseUrl = (
    isLocalWebHost
      ? normalizedEnvApiBaseUrl || localApiBaseUrl
      : normalizedEnvApiBaseUrl && !envLooksLocal && !envLooksPlaceholder
        ? normalizedEnvApiBaseUrl
        : ''
  ).replace(/\/$/, '');
  const preferredLanguage = preferredLocale;

  const [question, setQuestion] = useState('');
  const [submittedQuestion, setSubmittedQuestion] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [categorizedResult, setCategorizedResult] = useState('');
  const [categorizeError, setCategorizeError] = useState('');
  const [isAllSourcesLoading, setIsAllSourcesLoading] = useState(false);
  const [allSourcesError, setAllSourcesError] = useState('');
  const [allSourceSummaries, setAllSourceSummaries] = useState<Array<{
    name: string;
    url: string;
    summary: string;
    error: string;
    isDisplayable?: boolean;
    unusableReason?: string;
  }>>([]);
  const [clusteredSourcesResult, setClusteredSourcesResult] = useState('');
  const [clusteredSourcesMeta, setClusteredSourcesMeta] = useState('');
  const [showSourceSummaries, setShowSourceSummaries] = useState(false);
  const [selectedRankedNewsIndex, setSelectedRankedNewsIndex] = useState<number | null>(null);
  const [isNewsDetailLoading, setIsNewsDetailLoading] = useState(false);
  const [newsDetailText, setNewsDetailText] = useState('');
  const [newsDetailError, setNewsDetailError] = useState('');
  const [sourceViewportWidth, setSourceViewportWidth] = useState(0);
  const [sourceContentWidth, setSourceContentWidth] = useState(0);
  const [isSourceListInteracting, setIsSourceListInteracting] = useState(false);
  const newsDetailCacheRef = useRef<Map<string, string>>(new Map());
  const newsDetailInFlightRef = useRef<Map<string, Promise<string>>>(new Map());
  const newsPrefetchedKeysRef = useRef<Set<string>>(new Set());
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<any>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceScrollRef = useRef<ScrollView | null>(null);
  const sourceAutoScrollOffsetRef = useRef(0);
  const sourceAutoScrollRafRef = useRef<number | null>(null);
  const sourceAutoScrollLastTsRef = useRef(0);
  const sourceInteractionTimeoutRef = useRef<any>(null);
  const workflowRequestSeqRef = useRef(0);
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

    const speedPxPerSecond = 9;
    const tick = (timestamp: number) => {
      if (isSourceListInteracting) return;

      const maxOffset = Math.max(0, sourceContentWidth - sourceViewportWidth);
      if (sourceAutoScrollLastTsRef.current === 0) {
        sourceAutoScrollLastTsRef.current = timestamp;
      }
      const deltaSec = Math.max(0, (timestamp - sourceAutoScrollLastTsRef.current) / 1000);
      sourceAutoScrollLastTsRef.current = timestamp;

      let nextOffset = sourceAutoScrollOffsetRef.current + speedPxPerSecond * deltaSec;
      if (nextOffset > maxOffset) {
        nextOffset = 0;
      }

      sourceAutoScrollOffsetRef.current = nextOffset;
      sourceScrollRef.current?.scrollTo({ x: nextOffset, animated: false });
      sourceAutoScrollRafRef.current = requestAnimationFrame(tick);
    };

    sourceAutoScrollRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (sourceAutoScrollRafRef.current !== null) {
        cancelAnimationFrame(sourceAutoScrollRafRef.current);
      }
      sourceAutoScrollRafRef.current = null;
      sourceAutoScrollLastTsRef.current = 0;
    };
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
      sourceAutoScrollLastTsRef.current = 0;
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
  const rankedClusterCards = splitRankedClusters(clusteredSourcesResult);
  const displayableSourceSummaries = allSourceSummaries.filter(
    (item) => !item.error && item.isDisplayable !== false && item.summary
  );

  const buildNewsDetailPrompt = (newsItemText: string) => `
${isZh ? '你是一位新闻分析助手，帮助用户理解一条被选中的新闻。' : 'You are helping the user understand a ranked news item.'}

${isZh ? '用户选中的新闻内容：' : 'Ranked news item selected by user:'}
${newsItemText}

${isZh ? '任务：' : 'Task:'}
${isZh ? '1) 只提供事实性信息，不要提出新问题、建议、观点或洞察。' : '1) Provide factual information only. Do not pose new questions, suggestions, opinions, or insights.'}
${isZh ? '2) 尽可能详细地补充事件背景、时间线、涉及方、公开数据与已知进展。' : '2) Add as much detail as possible: background, timeline, involved parties, public data, and known developments.'}
${isZh ? '3) 使用清晰结构输出：概述、关键事实、时间线、当前状态、不确定信息。' : '3) Use a clear structure: overview, key facts, timeline, current status, and uncertainties.'}
${isZh ? '4) 不要做价值判断，不要提供行动建议。' : '4) Do not make value judgments and do not provide recommendations.'}
${isZh ? '5) 必须使用简体中文输出。' : '5) Output must be in English.'}
`.trim();

  const getNewsDetailCacheKey = useCallback(
    (newsItemText: string) => `${preferredLanguage || (isZh ? 'zh-CN' : 'en-US')}::${newsItemText}`,
    [preferredLanguage, isZh]
  );

  const fetchNewsDetail = useCallback(async (newsItemText: string) => {
    const trimmed = String(newsItemText || '').trim();
    if (!trimmed) {
      return isZh ? '未返回该新闻的详细内容。' : 'No detail returned for this news item.';
    }

    const cacheKey = getNewsDetailCacheKey(trimmed);
    const cachedText = newsDetailCacheRef.current.get(cacheKey);
    if (cachedText) return cachedText;

    const existingInFlight = newsDetailInFlightRef.current.get(cacheKey);
    if (existingInFlight) return existingInFlight;

    const requestPromise = (async () => {
      const prompt = buildNewsDetailPrompt(trimmed);
      let res: Response;
      try {
        res = await fetch(`${apiBaseUrl}/api/ask`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ question: prompt }),
        });
      } catch {
        if (apiBaseUrl === localApiBaseUrl) {
          res = await fetch(`${fallbackHostedApiBaseUrl}/api/ask`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ question: prompt }),
          });
        } else {
          throw new Error('ask-fetch-failed');
        }
      }

      const data = await res.json();
      if (!res.ok) {
        const message = typeof data?.error === 'string' ? data.error : 'Failed to fetch news detail.';
        throw new Error(message);
      }

      const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
      const detailText = answer || (isZh ? '未返回该新闻的详细内容。' : 'No detail returned for this news item.');
      newsDetailCacheRef.current.set(cacheKey, detailText);
      return detailText;
    })();

    newsDetailInFlightRef.current.set(cacheKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      newsDetailInFlightRef.current.delete(cacheKey);
    }
  }, [apiBaseUrl, fallbackHostedApiBaseUrl, getNewsDetailCacheKey, isZh, localApiBaseUrl]);

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

  const handleSummarizeAllSources = async (forceRefresh = false) => {
    const requestSeq = ++workflowRequestSeqRef.current;
    setIsAllSourcesLoading(true);
    setAllSourcesError('');
    setAllSourceSummaries([]);
    setClusteredSourcesResult('');
    setClusteredSourcesMeta('');
    setSelectedRankedNewsIndex(null);
    setNewsDetailText('');
    setNewsDetailError('');
    setIsNewsDetailLoading(false);

    try {
      let res: Response;
      try {
        res = await fetch(`${apiBaseUrl}/api/source-workflow`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sources: sources.map((s) => ({ name: s.name, url: s.url })),
            preferredLanguage,
            forceRefresh,
          }),
        });
      } catch {
        if (apiBaseUrl === localApiBaseUrl) {
          res = await fetch(`${fallbackHostedApiBaseUrl}/api/source-workflow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sources: sources.map((s) => ({ name: s.name, url: s.url })),
              preferredLanguage,
              forceRefresh,
            }),
          });
        } else {
          throw new Error('source-workflow-fetch-failed');
        }
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to fetch source workflow.');
      }
      if (workflowRequestSeqRef.current !== requestSeq) return;

      const summaries = Array.isArray(data?.sourceSummaries) ? data.sourceSummaries : [];
      setAllSourceSummaries(summaries);
      setClusteredSourcesResult(
        typeof data?.clustered === 'string' && data.clustered.trim() ? data.clustered.trim() : ''
      );

      const meta = data?.meta || {};
      const fetchedCount = typeof meta.fetchedCount === 'number' ? meta.fetchedCount : summaries.length;
      const totalSources = typeof meta.totalSources === 'number' ? meta.totalSources : summaries.length;
      const hiddenCount = typeof meta.hiddenCount === 'number' ? meta.hiddenCount : 0;
      const cacheHit = Boolean(data?.cache?.hit);
      setClusteredSourcesMeta(isZh
        ? `已抓取 ${fetchedCount}/${totalSources} 个来源摘要。` +
          (hiddenCount > 0 ? ` 已过滤 ${hiddenCount} 个不可用来源页面。` : '') +
          (cacheHit ? '（来自缓存）' : '（最新刷新）')
        : `Fetched summaries for ${fetchedCount}/${totalSources} sources.` +
          (hiddenCount > 0 ? ` Filtered ${hiddenCount} unusable source pages.` : '') +
          (cacheHit ? ' (served from cache)' : ' (fresh refresh)')
      );
    } catch {
      if (workflowRequestSeqRef.current !== requestSeq) return;
      setAllSourcesError(isZh ? `无法连接 API 服务：${apiBaseUrl}` : `Could not connect to API server at ${apiBaseUrl}.`);
    } finally {
      if (workflowRequestSeqRef.current !== requestSeq) return;
      setIsAllSourcesLoading(false);
    }
  };

  const handleLearnMoreNews = async (newsItemText: string, index: number) => {
    const trimmed = String(newsItemText || '').trim();
    if (!trimmed) return;

    setSelectedRankedNewsIndex(index);
    setIsNewsDetailLoading(true);
    setNewsDetailText('');
    setNewsDetailError('');

    try {
      const detailText = await fetchNewsDetail(trimmed);
      setNewsDetailText(detailText);
    } catch (error) {
      setNewsDetailError(error instanceof Error ? error.message : (isZh ? '获取新闻详情失败。' : 'Failed to fetch news detail.'));
    } finally {
      setIsNewsDetailLoading(false);
    }
  };

  const closeNewsDetailModal = () => {
    setSelectedRankedNewsIndex(null);
  };

  useEffect(() => {
    newsPrefetchedKeysRef.current.clear();
  }, [clusteredSourcesResult, preferredLanguage]);

  useEffect(() => {
    if (!clusteredSourcesResult.trim()) return;
    const topNewsItems = splitRankedClusters(clusteredSourcesResult)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, TOP_NEWS_PREFETCH_COUNT);

    topNewsItems.forEach((item) => {
      const cacheKey = getNewsDetailCacheKey(item);
      if (newsPrefetchedKeysRef.current.has(cacheKey)) return;
      newsPrefetchedKeysRef.current.add(cacheKey);
      void fetchNewsDetail(item).catch(() => {
        newsPrefetchedKeysRef.current.delete(cacheKey);
      });
    });
  }, [clusteredSourcesResult, fetchNewsDetail, getNewsDetailCacheKey]);

  useEffect(() => {
    handleSummarizeAllSources(false);
    const interval = setInterval(() => {
      handleSummarizeAllSources(false);
    }, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [preferredLanguage]);

  useEffect(() => {
    setSelectedRankedNewsIndex(null);
    setNewsDetailText('');
    setNewsDetailError('');
    setIsNewsDetailLoading(false);
  }, [language]);

  return (
    <>
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
          <Text style={styles.title}>{isZh ? '可信新闻' : 'Credible Search'}</Text>
          <Text style={styles.subtitle}>
            {isZh ? '浏览排序新闻，点击任一卡片获取 AI 深度解读。' : 'Browse ranked news and tap any card for deeper AI context.'}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardText}>
            {isZh
              ? '点击下方任一新闻卡片，会发起新的 AI 请求并弹出详情视图。'
              : 'Tap any ranked news card below to generate deeper context with a fresh AI request.'}
          </Text>
        </View>

        <View style={styles.rankClusterTopWrap}>
          <View style={styles.bulkActionWrap}>
            <TouchableOpacity
              style={[styles.bulkActionButton, isAllSourcesLoading ? styles.bulkActionButtonDisabled : null]}
              onPress={() => handleSummarizeAllSources(true)}
              disabled={isAllSourcesLoading}
            >
              <View style={styles.bulkActionButtonRow}>
                <FaRegCompass size={14} color={isAllSourcesLoading ? '#94a3b8' : '#0f766e'} />
                <Text
                  style={[
                    styles.bulkActionButtonText,
                    isAllSourcesLoading ? styles.bulkActionButtonTextDisabled : null,
                  ]}
                >
                  {isAllSourcesLoading
                    ? (isZh ? '正在刷新最新新闻亮点...' : 'Refreshing Latest Source Highlights...')
                    : (isZh ? '发现最新新闻亮点' : 'Discover Latest Highlights')}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {isAllSourcesLoading ? (
            <View style={styles.bulkLoadingWrap}>
              <ActivityIndicator size="small" color="#2563eb" />
              <Text style={styles.bulkLoadingText}>
                {isZh ? '正在并行抓取来源并生成摘要...' : 'Fetching sources in parallel and summarizing each source...'}
              </Text>
            </View>
          ) : null}

          {allSourcesError ? <Text style={styles.bulkErrorText}>{allSourcesError}</Text> : null}
          {clusteredSourcesMeta ? <Text style={styles.bulkMetaText}>{clusteredSourcesMeta}</Text> : null}

          {rankedClusterCards.length > 0 ? (
            <View style={styles.clusterSectionWrap}>
              <Text style={styles.clusterSectionTitle}>{isZh ? '排序新闻' : 'Ranked News'}</Text>
              {isMobileClusterLayout ? (
                <View style={styles.clusterCardsColumn}>
                  {rankedClusterCards.map((clusterText, idx) => (
                    <TouchableOpacity
                      key={`ranked-cluster-${idx}`}
                      style={[
                        styles.clusterCard,
                        styles.clusterCardMobile,
                        selectedRankedNewsIndex === idx ? styles.clusterCardSelected : null,
                      ]}
                      onPress={() => handleLearnMoreNews(clusterText, idx)}
                    >
                      <View style={styles.clusterCardBody}>{renderRichText(clusterText)}</View>
                      <View style={styles.clusterLearnMoreButton}>
                        <Text style={styles.clusterLearnMoreText}>{isZh ? '深入了解' : 'Learn More'}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.clusterCardsRow}
                >
                  {rankedClusterCards.map((clusterText, idx) => (
                    <TouchableOpacity
                      key={`ranked-cluster-${idx}`}
                      style={[
                        styles.clusterCard,
                        selectedRankedNewsIndex === idx ? styles.clusterCardSelected : null,
                      ]}
                      onPress={() => handleLearnMoreNews(clusterText, idx)}
                    >
                      <View style={styles.clusterCardBody}>{renderRichText(clusterText)}</View>
                      <View style={styles.clusterLearnMoreButton}>
                        <Text style={styles.clusterLearnMoreText}>{isZh ? '深入了解' : 'Learn More'}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
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

        <View style={styles.sectionDivider} />

        {displayableSourceSummaries.length > 0 ? (
          <View style={styles.bulkSummaryList}>
            <TouchableOpacity
              style={styles.sourceSummaryToggleButton}
              onPress={() => setShowSourceSummaries((prev) => !prev)}
            >
              <Text style={styles.sourceSummaryToggleText}>
                {showSourceSummaries
                  ? (isZh ? '隐藏来源摘要' : 'Hide Source Summaries')
                  : (isZh
                    ? `显示来源摘要 (${displayableSourceSummaries.length})`
                    : `Show Source Summaries (${displayableSourceSummaries.length})`)}
              </Text>
            </TouchableOpacity>

            {showSourceSummaries ? (
              displayableSourceSummaries.map((item) => (
                <View key={item.name} style={styles.bulkSummaryCard}>
                  <Text style={styles.bulkSummaryTitle}>{item.name}</Text>
                  <Text style={styles.bulkSummaryUrl}>{item.url}</Text>
                  <View style={styles.bulkSummaryBody}>
                    {renderRichText(item.summary)}
                  </View>
                </View>
              ))
            ) : null}
          </View>
        ) : null}

      </View>
    </ScrollView>
    <Modal
      visible={selectedRankedNewsIndex !== null}
      transparent
      animationType="fade"
      onRequestClose={closeNewsDetailModal}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{isZh ? '新闻详情' : 'News Detail'}</Text>
            <TouchableOpacity style={styles.modalCloseButton} onPress={closeNewsDetailModal}>
              <Text style={styles.modalCloseText}>{isZh ? '关闭' : 'Close'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalBodyScroll} contentContainerStyle={styles.modalBodyContent}>
            {isNewsDetailLoading ? (
              <Text style={styles.answerFrameText}>{isZh ? '正在加载深度解读...' : 'Loading deeper context...'}</Text>
            ) : newsDetailError ? (
              <Text style={styles.answerFrameError}>{newsDetailError}</Text>
            ) : (
              <View style={styles.newsDetailBody}>{renderRichText(newsDetailText)}</View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
    </>
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
  rankClusterTopWrap: {
    width: '100%',
    maxWidth: 760,
    marginBottom: 12,
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
    marginTop: 2,
    marginBottom: 8,
  },
  sectionDivider: {
    width: '100%',
    maxWidth: 640,
    marginTop: 30,
    borderTopWidth: 1,
    borderTopColor: '#dbe4ef',
  },
  bulkActionButton: {
    backgroundColor: '#f0fdfa',
    borderRadius: 999,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#99f6e4',
    shadowColor: '#0f766e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 2,
  },
  bulkActionButtonDisabled: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
    shadowOpacity: 0,
    elevation: 0,
  },
  bulkActionButtonText: {
    color: '#0f766e',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  bulkActionButtonTextDisabled: {
    color: '#94a3b8',
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
  clusterSectionWrap: {
    width: '100%',
    maxWidth: 760,
    marginTop: 10,
  },
  clusterSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  clusterCardsRow: {
    paddingRight: 12,
    gap: 10,
  },
  clusterCardsColumn: {
    width: '100%',
    gap: 10,
  },
  clusterCard: {
    width: 320,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  clusterCardSelected: {
    borderColor: '#60a5fa',
    shadowColor: '#2563eb',
    shadowOpacity: 0.14,
  },
  clusterCardMobile: {
    width: '100%',
  },
  clusterCardBody: {
    gap: 4,
  },
  clusterLearnMoreButton: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
  },
  clusterLearnMoreText: {
    color: '#0f766e',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  newsDetailCard: {
    width: '100%',
    maxWidth: 760,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbeafe',
    padding: 14,
    marginTop: 8,
    marginBottom: 10,
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  newsDetailTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  newsDetailBody: {
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 20,
  },
  modalSheet: {
    width: '100%',
    maxWidth: 760,
    maxHeight: '86%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dbeafe',
    overflow: 'hidden',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 8,
  },
  modalHeader: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: -0.2,
  },
  modalCloseButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  modalCloseText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  modalBodyScroll: {
    width: '100%',
  },
  modalBodyContent: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bulkSummaryList: {
    width: '100%',
    maxWidth: 760,
    marginTop: 12,
    gap: 10,
  },
  sourceSummaryToggleButton: {
    width: '100%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  sourceSummaryToggleText: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.1,
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
