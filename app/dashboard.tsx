import { ActivityIndicator, Platform, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type EndpointMetric = {
  endpoint: string;
  method: string;
  total: number;
  success: number;
  errors: number;
  status2xx: number;
  status4xx: number;
  status5xx: number;
  rateLimited: number;
  cacheHits: number;
  cacheMisses: number;
  avgLatencyMs: number;
  lastSeenAt: string;
};

type RecentRequestMetric = {
  ts: string;
  endpoint: string;
  method: string;
  statusCode: number;
  durationMs: number;
  cacheHit: boolean | null;
  cacheBackend: string;
};

type UsageMetrics = {
  generatedAt: string;
  startedAt: string;
  uptimeSec: number;
  totals: {
    requests: number;
    successRequests: number;
    errorRequests: number;
    successRate: number;
    avgLatencyMs: number;
  };
  endpoints: EndpointMetric[];
  recentRequests: RecentRequestMetric[];
};

function formatDuration(seconds: number) {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatPercent(value: number) {
  return `${(Math.max(0, Math.min(1, value)) * 100).toFixed(1)}%`;
}

export default function DashboardScreen() {
  const envApiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  const hasPlaceholderApiBaseUrl =
    envApiBaseUrl.includes('<your-vercel-project>') || envApiBaseUrl.includes('your-vercel-project');
  const isLocalWebHost =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const isGithubPagesHost =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location.hostname.endsWith('github.io');
  const localApiBaseUrl = 'http://127.0.0.1:3001';
  const hostedApiBaseUrl = 'https://discoveragent.vercel.app';
  const defaultApiBaseUrl = isLocalWebHost ? localApiBaseUrl : isGithubPagesHost ? hostedApiBaseUrl : '';
  const apiBaseUrl = (
    isLocalWebHost
      ? localApiBaseUrl
      : hasPlaceholderApiBaseUrl || !envApiBaseUrl
        ? defaultApiBaseUrl
        : envApiBaseUrl
  ).replace(/\/$/, '');

  const [metrics, setMetrics] = useState<UsageMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  const fetchMetrics = useCallback(async (isPullRefresh = false) => {
    if (!mountedRef.current) return;
    if (isPullRefresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');

    try {
      const response = await fetch(`${apiBaseUrl}/api/metrics`, {
        method: 'GET',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : 'Failed to fetch usage metrics.');
      }
      if (!mountedRef.current) return;
      setMetrics(data as UsageMetrics);
    } catch {
      if (!mountedRef.current) return;
      setError(`Could not connect to API server at ${apiBaseUrl}.`);
    } finally {
      if (!mountedRef.current) return;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [apiBaseUrl]);

  useEffect(() => {
    mountedRef.current = true;
    fetchMetrics(false);
    const interval = setInterval(() => {
      fetchMetrics(false);
    }, 30 * 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchMetrics]);

  const topStats = useMemo(() => {
    if (!metrics) {
      return {
        requests: '0',
        successRate: '0.0%',
        avgLatency: '0 ms',
        uptime: '0s',
      };
    }
    return {
      requests: String(metrics.totals.requests || 0),
      successRate: formatPercent(metrics.totals.successRate || 0),
      avgLatency: `${Math.round(metrics.totals.avgLatencyMs || 0)} ms`,
      uptime: formatDuration(metrics.uptimeSec || 0),
    };
  }, [metrics]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => fetchMetrics(true)} />}
    >
      <View style={styles.backgroundSeaTint} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleOne]} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleTwo]} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleThree]} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleFour]} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleFive]} />
      <View style={[styles.backgroundBubble, styles.backgroundBubbleSix]} />

      <View style={styles.content}>
        <View style={styles.heroBlock}>
          <Text style={styles.title}>Usage Dashboard</Text>
          <Text style={styles.subtitle}>Live request metrics from your API instance.</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingCard}>
            <ActivityIndicator size="small" color="#1f2937" />
            <Text style={styles.loadingText}>Loading metrics...</Text>
          </View>
        ) : null}

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {metrics ? (
          <View style={styles.cardsWrap}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Total Requests</Text>
              <Text style={styles.statValue}>{topStats.requests}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Success Rate</Text>
              <Text style={styles.statValue}>{topStats.successRate}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Avg Latency</Text>
              <Text style={styles.statValue}>{topStats.avgLatency}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Uptime</Text>
              <Text style={styles.statValue}>{topStats.uptime}</Text>
            </View>
          </View>
        ) : null}

        {metrics?.endpoints?.length ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Endpoint Breakdown</Text>
            {metrics.endpoints.map((endpoint) => (
              <View key={`${endpoint.method}:${endpoint.endpoint}`} style={styles.endpointRow}>
                <View style={styles.endpointTopLine}>
                  <Text style={styles.endpointName}>{endpoint.endpoint}</Text>
                  <Text style={styles.endpointMethod}>{endpoint.method}</Text>
                </View>
                <Text style={styles.endpointMeta}>
                  {endpoint.total} req | {Math.round(endpoint.avgLatencyMs)} ms avg | {endpoint.status4xx}x 4xx | {endpoint.status5xx}x 5xx
                </Text>
                {endpoint.cacheHits + endpoint.cacheMisses > 0 ? (
                  <Text style={styles.endpointMeta}>
                    cache: {endpoint.cacheHits} hit / {endpoint.cacheMisses} miss
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {metrics?.recentRequests?.length ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Recent Requests</Text>
            {metrics.recentRequests.slice(0, 12).map((item, idx) => (
              <View key={`${item.ts}-${idx}`} style={styles.recentRow}>
                <Text style={styles.recentText}>
                  {item.method} {item.endpoint}
                </Text>
                <Text style={styles.recentMeta}>
                  {item.statusCode} | {Math.round(item.durationMs)} ms
                  {typeof item.cacheHit === 'boolean' ? ` | cache ${item.cacheHit ? 'hit' : 'miss'}` : ''}
                </Text>
              </View>
            ))}
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
    paddingBottom: 40,
  },
  content: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 20,
    gap: 12,
  },
  heroBlock: {
    width: '100%',
    maxWidth: 740,
    marginBottom: 2,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111827',
    letterSpacing: -0.6,
  },
  subtitle: {
    marginTop: 6,
    color: '#4b5563',
    fontSize: 13,
    lineHeight: 18,
  },
  cardsWrap: {
    gap: 10,
  },
  statCard: {
    backgroundColor: '#ffffffee',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statLabel: {
    color: '#6b7280',
    fontSize: 12,
    fontWeight: '600',
  },
  statValue: {
    marginTop: 6,
    color: '#111827',
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  panel: {
    backgroundColor: '#ffffffee',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  panelTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '700',
  },
  endpointRow: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  endpointTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  endpointName: {
    color: '#111827',
    fontSize: 13,
    fontWeight: '700',
  },
  endpointMethod: {
    color: '#334155',
    backgroundColor: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  endpointMeta: {
    marginTop: 4,
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
  },
  recentRow: {
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  recentText: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  recentMeta: {
    marginTop: 4,
    color: '#64748b',
    fontSize: 12,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffffee',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  loadingText: {
    color: '#374151',
    fontSize: 13,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  errorText: {
    color: '#991b1b',
    fontSize: 12,
    lineHeight: 18,
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
});
