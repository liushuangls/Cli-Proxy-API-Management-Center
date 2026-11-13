import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Sheet } from '@/components/ui/Sheet';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { AuthFileItem } from '@/types';
import { apiClient } from '@/services/api/client';
import {
  getTryoutModels,
  sendCredentialTryout,
  validateTryoutMessages,
  type TryoutMessage,
  type TryoutModel,
} from '@/services/api/credentialTryout';
import { deriveAuthFileIdentity } from '../identity';
import styles from './AuthFileTryoutSheet.module.scss';

type ChatMessage = TryoutMessage & { elapsedMs?: number; truncated?: boolean };
type Props = { file: AuthFileItem | null; open: boolean; onClose: () => void };

export function AuthFileTryoutSheet({ file, open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Sheet
      open={open && file !== null}
      onClose={onClose}
      size="lg"
      title={t('auth_tryout.title')}
      description={file ? deriveAuthFileIdentity(file).primary : ''}
    >
      {file && (
        <TryoutChat key={String(file.authIndex)} authIndex={String(file.authIndex)} open={open} />
      )}
    </Sheet>
  );
}

function TryoutChat({ authIndex, open }: { authIndex: string; open: boolean }) {
  const { t } = useTranslation();
  const [models, setModels] = useState<TryoutModel[] | null>(null);
  const [modelError, setModelError] = useState('');
  const [model, setModel] = useState('');
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const flight = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const transcript = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flight.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!open) flight.current?.abort();
  }, [open]);
  useEffect(() => {
    const controller = new AbortController();
    void getTryoutModels(authIndex, controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setModels(value);
      },
      (reason: unknown) => {
        if (!controller.signal.aborted)
          setModelError(reason instanceof Error ? reason.message : 'Request failed');
      }
    );
    return () => controller.abort();
  }, [authIndex]);
  useEffect(() => {
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }, [messages, sending, open]);

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!open || flight.current || !model || !draft.trim()) return;
    const next: TryoutMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: draft },
    ];
    const invalid = validateTryoutMessages(next);
    if (invalid) {
      setError(t(`auth_tryout.${invalid}`));
      return;
    }
    const controller = new AbortController();
    const revision = apiClient.getConnectionRevision();
    const current = () =>
      mounted.current &&
      !controller.signal.aborted &&
      revision === apiClient.getConnectionRevision();
    flight.current = controller;
    setSending(true);
    setError('');
    setNotice('');
    try {
      const result = await sendCredentialTryout(
        authIndex,
        model,
        conversationId,
        next,
        controller.signal
      );
      if (!current()) return;
      setMessages([
        ...messages,
        { role: 'user', content: draft },
        {
          role: 'assistant',
          content: result.text,
          elapsedMs: result.elapsedMs,
          truncated: result.finishReason === 'length',
        },
      ]);
      setDraft('');
    } catch (reason: unknown) {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : t('auth_tryout.failed'));
    } finally {
      if (flight.current === controller) {
        flight.current = null;
        if (mounted.current) setSending(false);
      }
    }
  };

  return (
    <div className={styles.chat}>
      <div className={styles.toolbar}>
        <div className={styles.modelField}>
          <span>{t('auth_tryout.model')}</span>
          <Select
            value={model}
            options={(models ?? []).map((m) => ({
              value: m.id,
              label: m.label === m.id ? m.id : `${m.label} · ${m.id}`,
            }))}
            placeholder={t('auth_tryout.choose_model')}
            ariaLabel={t('auth_tryout.model')}
            disabled={!models?.length || sending || messages.length > 0}
            onChange={setModel}
          />
        </div>
        <Button
          variant="secondary"
          disabled={sending}
          onClick={() => {
            setMessages([]);
            setDraft('');
            setError('');
            setNotice('');
            setConversationId(crypto.randomUUID());
          }}
        >
          {t('auth_tryout.new_chat')}
        </Button>
      </div>
      <p className={styles.hint}>{t('auth_tryout.hint')}</p>
      {modelError && (
        <p className={styles.error} role="alert">
          {t('auth_tryout.models_failed')}: {modelError}
        </p>
      )}
      {models === null && !modelError && (
        <p role="status">
          <LoadingSpinner size={16} /> {t('auth_tryout.loading_models')}
        </p>
      )}
      {models?.length === 0 && <p className={styles.hint}>{t('auth_tryout.no_models')}</p>}
      <div
        ref={transcript}
        className={styles.transcript}
        role="log"
        aria-label={t('auth_tryout.transcript')}
        aria-live="polite"
      >
        {messages.length === 0 && !sending && (
          <p className={styles.empty}>{t('auth_tryout.welcome')}</p>
        )}
        {messages.map((message, index) => (
          <article key={index} className={message.role === 'user' ? styles.user : styles.assistant}>
            <strong>{t(`auth_tryout.${message.role}`)}</strong>
            <div className={styles.message}>{message.content}</div>
            {message.elapsedMs !== undefined && (
              <small>
                {t('auth_tryout.duration', { seconds: (message.elapsedMs / 1000).toFixed(2) })}
              </small>
            )}
            {message.truncated && <small>{t('auth_tryout.truncated')}</small>}
          </article>
        ))}
        {sending && (
          <>
            <article className={styles.user}>
              <strong>{t('auth_tryout.user')}</strong>
              <div className={styles.message}>{draft}</div>
            </article>
            <p className={styles.waiting} role="status">
              <LoadingSpinner size={18} />
              {t('auth_tryout.waiting')}
            </p>
          </>
        )}
      </div>
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className={styles.hint} role="status">
          {notice}
        </p>
      )}
      <form onSubmit={(event) => void send(event)} className={styles.composer}>
        <label>
          <span>{t('auth_tryout.input')}</span>
          <textarea
            rows={3}
            value={draft}
            maxLength={4000}
            disabled={sending}
            placeholder={t('auth_tryout.placeholder')}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                (event.ctrlKey || event.metaKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
        </label>
        <div className={styles.actions}>
          <span>{t('auth_tryout.turns', { count: messages.length / 2 })}</span>
          {sending ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                flight.current?.abort();
                setNotice(t('auth_tryout.stopped'));
              }}
            >
              {t('auth_tryout.stop')}
            </Button>
          ) : (
            <Button
              type="submit"
              disabled={!open || !model || !draft.trim() || messages.length >= 40}
            >
              {t('auth_tryout.send')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
