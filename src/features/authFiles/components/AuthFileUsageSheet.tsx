import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/Table';
import { apiClient } from '@/services/api/client';
import {
  getCredentialUsage,
  type CredentialUsage,
  type UsageTokens,
  type UsageQuery,
  type UsageRange,
} from '@/services/api/usageHistory';
import type { AuthFileItem } from '@/types';
import { deriveAuthFileIdentity } from '../identity';
import styles from './AuthFileUsageSheet.module.scss';

type Props = { file: AuthFileItem | null; onClose: () => void };
type Outcome = { query: UsageQuery; data?: CredentialUsage; error?: string; code?: string };
const tokenColumns: Array<keyof UsageTokens> = [
  'input',
  'output',
  'cacheRead',
  'cacheWrite',
  'reasoning',
  'unclassified',
  'total',
];

export function AuthFileUsageSheet({ file, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={file !== null}
      onClose={onClose}
      size="xl"
      title={t('auth_usage.title')}
      description={file ? deriveAuthFileIdentity(file).primary : ''}
    >
      {file && (
        <UsageContent key={String(file.authIndex)} authIndex={String(file.authIndex ?? '')} />
      )}
    </Sheet>
  );
}

function UsageContent({ authIndex }: { authIndex: string }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState<UsageQuery>({ range: '24h', page: 1 });
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const revision = apiClient.getConnectionRevision();
    const isCurrent = () =>
      !controller.signal.aborted && revision === apiClient.getConnectionRevision();
    void getCredentialUsage(authIndex, query, controller.signal).then(
      (data) => {
        if (isCurrent()) setOutcome({ query, data });
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        const detail = error as { message?: string; status?: number; apiCode?: string };
        setOutcome({
          query,
          error: detail.message || t('auth_usage.load_error'),
          code: detail.apiCode || (detail.status === 404 ? 'unsupported' : undefined),
        });
      }
    );
    return () => controller.abort();
  }, [authIndex, query, t]);

  const current = outcome?.query === query ? outcome : null;
  const data = current?.data;
  const loading = current === null;
  const number = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const rate = (value: number | null) =>
    value === null
      ? '—'
      : new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 2 }).format(
          value / 100
        );
  const date = (value: string) => new Date(value).toLocaleString(i18n.language);
  const tokenHeads = tokenColumns.map((column) => (
    <TableHead key={column} alignRight>
      {t(`auth_usage.${column}`)}
    </TableHead>
  ));
  const tokenCells = (tokens: UsageTokens) =>
    tokenColumns.map((column) => (
      <TableCell key={column} alignRight>
        {number(tokens[column])}
      </TableCell>
    ));
  const pageCount = data ? Math.max(1, Math.ceil(data.totalEvents / data.pageSize)) : 1;
  const changePage = (page: number) => {
    if (data) setQuery({ ...query, page, from: data.from, to: data.to });
  };
  const translatedError =
    current?.code &&
    [
      'usage_history_unavailable',
      'usage_history_incomplete',
      'credential_not_found',
      'unsupported',
    ].includes(current.code)
      ? t(`auth_usage.${current.code}`)
      : current?.error;

  return (
    <div className={styles.content}>
      <div className={styles.toolbar}>
        <Select
          value={query.range}
          ariaLabel={t('auth_usage.range')}
          fullWidth={false}
          options={(['24h', '7d', '30d'] as const).map((value) => ({
            value,
            label: t(`auth_usage.range_${value}`),
          }))}
          onChange={(value) => setQuery({ range: value as UsageRange, page: 1 })}
        />
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setQuery({ range: query.range, page: 1 })}
        >
          {t('auth_usage.refresh')}
        </Button>
      </div>

      {loading && (
        <div className={styles.loading} role="status">
          <LoadingSpinner size={20} />
          {t('auth_usage.loading')}
        </div>
      )}
      {current?.error && (
        <div className={styles.error} role="alert">
          {translatedError}
        </div>
      )}

      {data && (
        <>
          <div className={styles.summary}>
            <div>
              <span>{t('auth_usage.requests')}</span>
              <strong>{number(data.totals.requests)}</strong>
            </div>
            <div>
              <span>{t('auth_usage.success_failed')}</span>
              <strong>
                {number(data.totals.success)} / {number(data.totals.failed)}
              </strong>
            </div>
            <div>
              <span>{t('auth_usage.success_rate')}</span>
              <strong>{rate(data.totals.successRate)}</strong>
            </div>
            <div>
              <span>{t('auth_usage.total')}</span>
              <strong>{number(data.totals.tokens.total)}</strong>
            </div>
          </div>
          <p className={styles.meta}>
            {date(data.from)} — {date(data.to)}
          </p>
          <p className={styles.meta}>
            {t('auth_usage.retention', {
              days: data.retentionDays,
              since: date(data.availableSince),
            })}
          </p>
          <p className={styles.note}>{t('auth_usage.accounting_note')}</p>
          {data.totals.uncertainEvents > 0 && (
            <p className={styles.warning} role="status">
              {t('auth_usage.uncertain', { count: data.totals.uncertainEvents })}
            </p>
          )}

          {data.totalEvents === 0 ? (
            <EmptyState
              title={t('auth_usage.empty')}
              description={t('auth_usage.empty_description')}
            />
          ) : (
            <>
              <h3>{t('auth_usage.models')}</h3>
              <Table className={styles.table} aria-label={t('auth_usage.models')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auth_usage.model')}</TableHead>
                    <TableHead alignRight>{t('auth_usage.requests')}</TableHead>
                    <TableHead alignRight>{t('auth_usage.success_failed')}</TableHead>
                    <TableHead alignRight>{t('auth_usage.success_rate')}</TableHead>
                    {tokenHeads}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.models.map((model) => (
                    <TableRow key={model.model}>
                      <TableCell className={styles.model}>
                        {model.model || t('auth_usage.unknown_model')}
                      </TableCell>
                      <TableCell alignRight>{number(model.requests)}</TableCell>
                      <TableCell alignRight>
                        {number(model.success)} / {number(model.failed)}
                      </TableCell>
                      <TableCell alignRight>{rate(model.successRate)}</TableCell>
                      {tokenCells(model.tokens)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <h3>{t('auth_usage.events')}</h3>
              <Table className={styles.table} aria-label={t('auth_usage.events')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('auth_usage.time')}</TableHead>
                    <TableHead>{t('auth_usage.model')}</TableHead>
                    <TableHead>{t('auth_usage.status')}</TableHead>
                    <TableHead alignRight>{t('auth_usage.latency')}</TableHead>
                    {tokenHeads}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.events.map((event) => (
                    <TableRow key={event.executionId}>
                      <TableCell>
                        <time dateTime={event.timestamp}>{date(event.timestamp)}</time>
                      </TableCell>
                      <TableCell className={styles.model}>
                        {event.model || t('auth_usage.unknown_model')}
                        {event.alias && event.alias !== event.model && (
                          <small>{t('auth_usage.requested', { model: event.alias })}</small>
                        )}
                        {event.responseModel && event.responseModel !== event.model && (
                          <small>{t('auth_usage.returned', { model: event.responseModel })}</small>
                        )}
                      </TableCell>
                      <TableCell>
                        <span
                          className={
                            event.additionalUsage
                              ? styles.muted
                              : event.failed
                                ? styles.failure
                                : styles.success
                          }
                        >
                          {t(
                            `auth_usage.${event.additionalUsage ? 'additional' : event.failed ? 'failed' : 'success'}`
                          )}
                        </span>
                        {event.statusCode > 0 && <small>HTTP {event.statusCode}</small>}
                        {event.errorCode && (
                          <small>
                            {t(`auth_usage.error_${event.errorCode}`, {
                              defaultValue: event.errorCode,
                            })}
                          </small>
                        )}
                      </TableCell>
                      <TableCell alignRight>{number(event.latencyMs)} ms</TableCell>
                      {tokenCells(event.tokens)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <nav className={styles.pagination} aria-label={t('auth_usage.pagination')}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => changePage(data.page - 1)}
                >
                  {t('auth_usage.previous')}
                </Button>
                <span>
                  {t('auth_usage.page', {
                    page: data.page,
                    pages: pageCount,
                    count: data.totalEvents,
                  })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={data.page >= pageCount}
                  onClick={() => changePage(data.page + 1)}
                >
                  {t('auth_usage.next')}
                </Button>
              </nav>
            </>
          )}
        </>
      )}
    </div>
  );
}
