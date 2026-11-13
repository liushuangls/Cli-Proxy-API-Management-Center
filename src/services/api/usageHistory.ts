import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type UsageRange = '24h' | '7d' | '30d';
export type UsageQuery = {
  range: UsageRange;
  page: number;
  from?: string;
  to?: string;
};

export type UsageTokens = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  total: number;
  unclassified: number;
};

export type UsageStats = {
  requests: number;
  success: number;
  failed: number;
  successRate: number | null;
  additionalEvents: number;
  uncertainEvents: number;
  tokens: UsageTokens;
};

export type UsageEvent = {
  executionId: string;
  traceId: string;
  timestamp: string;
  model: string;
  alias: string;
  responseModel: string;
  additionalUsage: boolean;
  failed: boolean;
  statusCode: number;
  errorCode: string;
  latencyMs: number;
  quality: string;
  tokens: UsageTokens;
};

export type CredentialUsage = {
  authIndex: string;
  from: string;
  to: string;
  availableSince: string;
  retentionDays: number;
  totals: UsageStats;
  models: Array<UsageStats & { model: string }>;
  events: UsageEvent[];
  page: number;
  pageSize: number;
  totalEvents: number;
};

const invalid = (): never => {
  throw new Error('Invalid credential usage response');
};
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : invalid());
const text = (value: unknown): string => (typeof value === 'string' ? value : invalid());
const count = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid();
const flag = (value: unknown): boolean => (typeof value === 'boolean' ? value : invalid());
const timestamp = (value: unknown): string => {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
};

const tokens = (value: unknown): UsageTokens => {
  const raw = record(value);
  const result = {
    input: count(raw.input),
    output: count(raw.output),
    cacheRead: count(raw.cache_read),
    cacheWrite: count(raw.cache_write),
    reasoning: count(raw.reasoning),
    total: count(raw.total),
    unclassified: count(raw.unclassified),
  };
  if (
    result.total !== result.input + result.output + result.unclassified ||
    result.cacheRead + result.cacheWrite > result.input ||
    result.reasoning > result.output
  )
    invalid();
  return result;
};

const stats = (value: unknown): UsageStats => {
  const raw = record(value);
  const result: UsageStats = {
    requests: count(raw.requests),
    success: count(raw.success),
    failed: count(raw.failed),
    successRate: null,
    additionalEvents: count(raw.additional_events),
    uncertainEvents: count(raw.uncertain_events),
    tokens: tokens(raw.tokens),
  };
  if (result.requests !== result.success + result.failed) invalid();
  if (result.requests === 0) {
    if (raw.success_rate !== null) invalid();
  } else {
    if (
      typeof raw.success_rate !== 'number' ||
      !Number.isFinite(raw.success_rate) ||
      Math.abs(raw.success_rate - (result.success / result.requests) * 100) > 0.00001
    )
      invalid();
    result.successRate = raw.success_rate as number;
  }
  return result;
};

export function normalizeCredentialUsage(value: unknown): CredentialUsage {
  const raw = record(value);
  if (!Array.isArray(raw.models) || !Array.isArray(raw.events)) invalid();
  const models = (raw.models as unknown[]).map((value) => {
    const model = record(value);
    return { ...stats(model), model: text(model.model) };
  });
  const events = (raw.events as unknown[]).map((value): UsageEvent => {
    const event = record(value);
    return {
      executionId: text(event.execution_id),
      traceId: text(event.trace_id),
      timestamp: timestamp(event.timestamp),
      model: text(event.model),
      alias: text(event.alias),
      responseModel: text(event.response_model),
      additionalUsage: flag(event.additional_usage),
      failed: flag(event.failed),
      statusCode: count(event.status_code),
      errorCode: text(event.error_code),
      latencyMs: count(event.latency_ms),
      quality: text(event.quality),
      tokens: tokens(event.tokens),
    };
  });
  const result: CredentialUsage = {
    authIndex: text(raw.auth_index),
    from: timestamp(raw.from),
    to: timestamp(raw.to),
    availableSince: timestamp(raw.available_since),
    retentionDays: count(raw.retention_days),
    totals: stats(raw.totals),
    models,
    events,
    page: count(raw.page),
    pageSize: count(raw.page_size),
    totalEvents: count(raw.total_events),
  };
  if (result.page < 1 || result.pageSize < 1 || result.retentionDays < 1) invalid();
  return result;
}

export async function getCredentialUsage(
  authIndex: string,
  query: UsageQuery,
  signal: AbortSignal
): Promise<CredentialUsage> {
  const revision = apiClient.getConnectionRevision();
  const client = apiClient.captureConnection();
  const raw = await client.get<unknown>('/observability/usage/credentials', {
    signal,
    params: {
      auth_index: authIndex,
      page: query.page,
      page_size: 25,
      ...(query.from && query.to ? { from: query.from, to: query.to } : { range: query.range }),
    },
  });
  if (revision !== apiClient.getConnectionRevision()) {
    throw new DOMException('The management connection changed.', 'AbortError');
  }
  const result = normalizeCredentialUsage(raw);
  if (result.authIndex !== authIndex) invalid();
  return result;
}
