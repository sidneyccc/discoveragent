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
  refresh?: {
    totalRuns: number;
    successRuns: number;
    failedRuns: number;
    avgDurationMs: number;
    lastRunAt: string;
    lastStatus: string;
    recentRuns: Array<{
      ts: string;
      trigger: string;
      status: string;
      sourceCount: number;
      usableCount: number;
      failedCount: number;
      hiddenCount: number;
      durationMs: number;
      cacheHit: boolean | null;
      cacheBackend: string;
      error: string;
    }>;
  };
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

function formatTimestamp(isoLike: string) {
  if (!isoLike) return 'n/a';
  const ms = Date.parse(isoLike);
  if (!Number.isFinite(ms)) return isoLike;
  return new Date(ms).toLocaleString();
}

function formatHourLabel(isoLike: string) {
  const ms = Date.parse(isoLike);
  if (!Number.isFinite(ms)) return '--';
  const d = new Date(ms);
  const hour = d.getHours();
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}${suffix}`;
}

export default function DashboardScreen() {
  const envApiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();
  const isLocalWebHost =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const localApiBaseUrl = 'http://127.0.0.1:3001';
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

  const requestsTimeline = useMemo(() => {
    const requests = metrics?.recentRequests || [];
    if (!requests.length) return [];
    const bucketMap = new Map<string, { label: string; count: number; totalLatencyMs: number }>();

    for (const req of requests) {
      const ms = Date.parse(req.ts);
      if (!Number.isFinite(ms)) continue;
      const d = new Date(ms);
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      const current = bucketMap.get(key) || { label: formatHourLabel(key), count: 0, totalLatencyMs: 0 };
      current.count += 1;
      current.totalLatencyMs += Math.max(0, Number(req.durationMs || 0));
      bucketMap.set(key, current);
    }

    return Array.from(bucketMap.entries())
      .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0]))
      .slice(-8)
      .map(([, item]) => ({ label: item.label, count: item.count }));
  }, [metrics?.recentRequests]);

  const endpointUsageBars = useMemo(() => {
    const endpoints = metrics?.endpoints || [];
    const totalRequests = endpoints.reduce((sum, entry) => sum + (entry.total || 0), 0);
    return endpoints.slice(0, 6).map((entry) => ({
      endpoint: entry.endpoint,
      total: entry.total,
      pct: totalRequests ? entry.total / totalRequests : 0,
    }));
  }, [metrics?.endpoints]);

  const refreshTimeline = useMemo(() => {
    const runs = metrics?.refresh?.recentRuns || [];
    if (!runs.length) return [];
    return runs
      .slice(0, 10)
      .reverse()
      .map((run) => ({
        label: formatHourLabel(run.ts),
        durationMs: Math.max(0, Number(run.durationMs || 0)),
        status: run.status,
      }));
  }, [metrics?.refresh?.recentRuns]);

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

        {metrics?.refresh ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>News Refresh History</Text>
            <Text style={styles.endpointMeta}>
              Last run: {formatTimestamp(metrics.refresh.lastRunAt)} | status: {metrics.refresh.lastStatus || 'unknown'}
            </Text>
            <Text style={styles.endpointMeta}>
              Total runs: {metrics.refresh.totalRuns || 0} | success: {metrics.refresh.successRuns || 0} | failed: {metrics.refresh.failedRuns || 0}
            </Text>
            <Text style={styles.endpointMeta}>
              Avg refresh duration: {Math.round(metrics.refresh.avgDurationMs || 0)} ms
            </Text>

            {refreshTimeline.length ? (
              <View style={styles.chartFrame}>
                <View style={styles.chartBarsRow}>
                  {refreshTimeline.map((run, idx) => {
                    const maxDuration = Math.max(...refreshTimeline.map((item) => item.durationMs), 1);
                    const height = Math.max(8, Math.round((run.durationMs / maxDuration) * 92));
                    return (
                      <View key={`${run.label}-${idx}`} style={styles.chartBarWrap}>
                        <View
                          style={[
                            styles.chartBar,
                            run.status === 'success' ? styles.chartBarSuccess : styles.chartBarFailed,
                            { height },
                          ]}
                        />
                        <Text style={styles.chartBarLabel}>{run.label}</Text>
                        <Text style={styles.chartBarValue}>{Math.round(run.durationMs)}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {metrics.refresh.recentRuns?.length ? (
              <View style={styles.refreshRunsWrap}>
                {metrics.refresh.recentRuns.slice(0, 10).map((run, idx) => (
                  <View key={`${run.ts}-${idx}`} style={styles.recentRow}>
                    <Text style={styles.recentText}>
                      {run.status.toUpperCase()} | {run.trigger}
                    </Text>
                    <Text style={styles.recentMeta}>
                      {formatTimestamp(run.ts)} | {run.usableCount}/{run.sourceCount} usable | {Math.round(run.durationMs)} ms
                    </Text>
                    {run.error ? <Text style={styles.recentMeta}>error: {run.error}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {requestsTimeline.length ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Request Timeline (Recent Hours)</Text>
            <View style={styles.chartFrame}>
              <View style={styles.chartBarsRow}>
                {requestsTimeline.map((bucket, idx) => {
                  const maxCount = Math.max(...requestsTimeline.map((b) => b.count), 1);
                  const height = Math.max(8, Math.round((bucket.count / maxCount) * 92));
                  return (
                    <View key={`${bucket.label}-${idx}`} style={styles.chartBarWrap}>
                      <View style={[styles.chartBar, { height }]} />
                      <Text style={styles.chartBarLabel}>{bucket.label}</Text>
                      <Text style={styles.chartBarValue}>{bucket.count}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          </View>
        ) : null}

        {metrics?.endpoints?.length ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Endpoint Breakdown</Text>
            <View style={styles.endpointBarsWrap}>
              {endpointUsageBars.map((item) => (
                <View key={item.endpoint} style={styles.endpointBarRow}>
                  <View style={styles.endpointBarHeader}>
                    <Text style={styles.endpointBarTitle}>{item.endpoint}</Text>
                    <Text style={styles.endpointBarValue}>{item.total} req</Text>
                  </View>
                  <View style={styles.endpointBarTrack}>
                    <View style={[styles.endpointBarFill, { width: `${Math.max(4, item.pct * 100)}%` }]} />
                  </View>
                </View>
              ))}
            </View>
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
  endpointBarsWrap: {
    gap: 8,
  },
  endpointBarRow: {
    gap: 4,
  },
  endpointBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  endpointBarTitle: {
    color: '#111827',
    fontSize: 12,
    fontWeight: '700',
  },
  endpointBarValue: {
    color: '#475569',
    fontSize: 12,
    fontWeight: '600',
  },
  endpointBarTrack: {
    width: '100%',
    height: 8,
    borderRadius: 999,
    backgroundColor: '#e2e8f0',
    overflow: 'hidden',
  },
  endpointBarFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#3b82f6',
  },
  chartFrame: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
  },
  chartBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 6,
    minHeight: 132,
  },
  chartBarWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
  },
  chartBar: {
    width: '100%',
    maxWidth: 24,
    borderRadius: 6,
    backgroundColor: '#2563eb',
  },
  chartBarSuccess: {
    backgroundColor: '#0f766e',
  },
  chartBarFailed: {
    backgroundColor: '#dc2626',
  },
  chartBarLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '600',
  },
  chartBarValue: {
    color: '#111827',
    fontSize: 10,
    fontWeight: '700',
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
  refreshRunsWrap: {
    gap: 8,
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
