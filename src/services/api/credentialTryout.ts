import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

export type TryoutMessage = { role: 'user' | 'assistant'; content: string };
export type TryoutModel = { id: string; label: string };
export type TryoutReply = { text: string; finishReason: string; elapsedMs: number };

export function validateTryoutMessages(
  messages: TryoutMessage[]
): 'turn_limit' | 'context_limit' | 'empty' | null {
  if (messages.length > 39) return 'turn_limit';
  if (!messages.length || messages.some((m) => !m.content.trim())) return 'empty';
  if (messages.reduce((sum, m) => sum + Array.from(m.content).length, 0) > 32000)
    return 'context_limit';
  return null;
}

export function normalizeTryoutModels(raw: unknown): TryoutModel[] {
  if (!isRecord(raw) || !Array.isArray(raw.models))
    throw new Error('Invalid tryout model response');
  return raw.models.map((value) => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      !value.id ||
      typeof value.label !== 'string'
    ) {
      throw new Error('Invalid tryout model response');
    }
    return { id: value.id, label: value.label };
  });
}

export function normalizeTryoutReply(raw: unknown, authIndex: string): TryoutReply {
  if (
    !isRecord(raw) ||
    raw.auth_index !== authIndex ||
    typeof raw.text !== 'string' ||
    !raw.text.trim() ||
    typeof raw.finish_reason !== 'string' ||
    typeof raw.elapsed_ms !== 'number' ||
    !Number.isFinite(raw.elapsed_ms) ||
    raw.elapsed_ms < 0
  ) {
    throw new Error('Invalid credential tryout response');
  }
  return { text: raw.text, finishReason: raw.finish_reason, elapsedMs: raw.elapsed_ms };
}

function connection(signal: AbortSignal) {
  const revision = apiClient.getConnectionRevision();
  const isCurrent = () => !signal.aborted && revision === apiClient.getConnectionRevision();
  return {
    client: apiClient.captureConnection(isCurrent),
    check: () => {
      if (!isCurrent()) throw new DOMException('The management connection changed.', 'AbortError');
    },
  };
}

export async function getTryoutModels(authIndex: string, signal: AbortSignal) {
  const { client, check } = connection(signal);
  const raw = await client.get<unknown>('/credentials/try/models', {
    params: { auth_index: authIndex },
    signal,
  });
  check();
  return normalizeTryoutModels(raw);
}

export async function sendCredentialTryout(
  authIndex: string,
  model: string,
  conversationId: string,
  messages: TryoutMessage[],
  signal: AbortSignal
) {
  const { client, check } = connection(signal);
  const raw = await client.post<unknown>(
    '/credentials/try',
    {
      auth_index: authIndex,
      model,
      conversation_id: conversationId,
      messages,
    },
    { signal, timeout: 0 }
  );
  check();
  return normalizeTryoutReply(raw, authIndex);
}
