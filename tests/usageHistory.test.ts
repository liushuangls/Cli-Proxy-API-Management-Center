import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '../src/services/api/client';
import { getCredentialUsage, normalizeCredentialUsage } from '../src/services/api/usageHistory';

function fixture() {
  const tokens = {
    input: 100,
    output: 50,
    cache_read: 40,
    cache_write: 10,
    reasoning: 20,
    total: 150,
    unclassified: 0,
  };
  const totals = {
    requests: 2,
    success: 1,
    failed: 1,
    success_rate: 50,
    additional_events: 0,
    uncertain_events: 0,
    tokens,
  };
  return {
    auth_index: 'auth-a',
    from: '2026-11-12T00:00:00Z',
    to: '2026-11-13T00:00:00Z',
    available_since: '2026-11-01T00:00:00Z',
    retention_days: 30,
    totals,
    models: [{ model: 'model-a', ...totals }],
    events: [
      {
        execution_id: 'one',
        trace_id: 'trace',
        timestamp: '2026-11-12T12:00:00Z',
        model: 'model-a',
        alias: 'alias-a',
        response_model: '',
        additional_usage: false,
        failed: true,
        status_code: 502,
        error_code: 'stream_truncated',
        latency_ms: 500,
        quality: 'complete',
        tokens,
      },
    ],
    page: 1,
    page_size: 25,
    total_events: 2,
  };
}

describe('credential usage response', () => {
  test('normalizes fields without adding token subsets twice', () => {
    const data = normalizeCredentialUsage(fixture());
    expect(data.totals.tokens).toEqual({
      input: 100,
      output: 50,
      cacheRead: 40,
      cacheWrite: 10,
      reasoning: 20,
      total: 150,
      unclassified: 0,
    });
    expect(data.events[0]).toMatchObject({
      executionId: 'one',
      errorCode: 'stream_truncated',
      failed: true,
    });
    expect(data.models[0].successRate).toBe(50);
  });

  test('preserves null success rate when there are no attempts', () => {
    const data = fixture();
    const empty = {
      ...data,
      totals: { ...data.totals, requests: 0, success: 0, failed: 0, success_rate: null },
      models: [],
      events: [],
      total_events: 0,
    };
    expect(normalizeCredentialUsage(empty).totals.successRate).toBeNull();
    expect(() =>
      normalizeCredentialUsage({ ...empty, totals: { ...empty.totals, success_rate: 100 } })
    ).toThrow();
  });

  test('rejects partial or inconsistent responses rather than showing zeros', () => {
    expect(() => normalizeCredentialUsage({})).toThrow();
    const data = fixture();
    data.totals.tokens.total += data.totals.tokens.cache_read;
    expect(() => normalizeCredentialUsage(data)).toThrow();
    const invalid = fixture();
    invalid.totals.success_rate = 100;
    expect(() => normalizeCredentialUsage(invalid)).toThrow();
  });

  test('all supported locales supply the complete usage vocabulary', () => {
    const locales = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];
    const sections = locales.map(
      (locale) =>
        JSON.parse(
          readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
        ).auth_usage
    );
    for (const section of sections)
      expect(Object.keys(section).sort()).toEqual(Object.keys(sections[0]).sort());
  });
});

const originalCapture = apiClient.captureConnection;
afterEach(() => {
  apiClient.captureConnection = originalCapture;
});

test('pagination pins the server time window and retains credential scope', async () => {
  const captured = originalCapture.call(apiClient);
  let params: unknown;
  captured.get = (async (url, config) => {
    expect(url).toBe('/observability/usage/credentials');
    params = config?.params;
    return fixture();
  }) as typeof captured.get;
  apiClient.captureConnection = () => captured;
  await getCredentialUsage(
    'auth-a',
    { range: '24h', page: 2, from: fixture().from, to: fixture().to },
    new AbortController().signal
  );
  expect(params).toEqual({
    auth_index: 'auth-a',
    page: 2,
    page_size: 25,
    from: fixture().from,
    to: fixture().to,
  });
});

test('late responses cannot cross a connection change, including ABA switches', async () => {
  apiClient.setConfig({ apiBase: 'https://server-a.invalid', managementKey: 'fixture-a' });
  const captured = originalCapture.call(apiClient);
  let resolve!: (value: ReturnType<typeof fixture>) => void;
  captured.get = (() =>
    new Promise((done) => {
      resolve = done;
    })) as typeof captured.get;
  apiClient.captureConnection = () => captured;
  const pending = getCredentialUsage(
    'auth-a',
    { range: '24h', page: 1 },
    new AbortController().signal
  );
  apiClient.setConfig({ apiBase: 'https://server-b.invalid', managementKey: 'fixture-b' });
  apiClient.setConfig({ apiBase: 'https://server-a.invalid', managementKey: 'fixture-a' });
  resolve(fixture());
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
});
