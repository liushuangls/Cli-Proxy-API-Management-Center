import { afterEach, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import {
  normalizeTryoutModels,
  normalizeTryoutReply,
  sendCredentialTryout,
  validateTryoutMessages,
  type TryoutMessage,
} from '../src/services/api/credentialTryout';

test('tryout models and replies fail visibly for missing or mismatched data', () => {
  expect(normalizeTryoutModels({ models: [] })).toEqual([]);
  expect(() => normalizeTryoutModels({})).toThrow();
  expect(() => normalizeTryoutModels({ models: [{}] })).toThrow();
  expect(() =>
    normalizeTryoutReply(
      { auth_index: 'b', text: 'hello', finish_reason: 'stop', elapsed_ms: 10 },
      'a'
    )
  ).toThrow();
  expect(() =>
    normalizeTryoutReply({ auth_index: 'a', text: '', finish_reason: 'stop', elapsed_ms: 10 }, 'a')
  ).toThrow();
});

test('conversation limits preserve complete history instead of silently truncating it', () => {
  const messages: TryoutMessage[] = [
    { role: 'user', content: 'Remember blue.' },
    { role: 'assistant', content: 'Understood.' },
    { role: 'user', content: 'Which color?' },
  ];
  expect(validateTryoutMessages(messages)).toBeNull();
  expect(
    validateTryoutMessages(Array.from({ length: 41 }, () => ({ role: 'user', content: 'x' })))
  ).toBe('turn_limit');
  expect(validateTryoutMessages([{ role: 'user', content: 'x'.repeat(32001) }])).toBe(
    'context_limit'
  );
});

const originalCapture = apiClient.captureConnection;
afterEach(() => {
  apiClient.captureConnection = originalCapture;
});

test('multi-turn requests carry account, session and history with cancellable transport', async () => {
  const client = originalCapture.call(apiClient);
  const messages: TryoutMessage[] = [
    { role: 'user', content: 'blue' },
    { role: 'assistant', content: 'OK' },
    { role: 'user', content: 'What color?' },
  ];
  const signal = new AbortController().signal;
  client.post = (async (url, body, config) => {
    expect(url).toBe('/credentials/try');
    expect(body).toEqual({
      auth_index: 'a',
      model: 'm',
      conversation_id: 'conversation',
      messages,
    });
    expect(config?.signal).toBe(signal);
    expect(config?.timeout).toBe(0);
    return { auth_index: 'a', text: 'blue', finish_reason: 'stop', elapsed_ms: 10 };
  }) as typeof client.post;
  apiClient.captureConnection = () => client;
  expect((await sendCredentialTryout('a', 'm', 'conversation', messages, signal)).text).toBe(
    'blue'
  );
});

test('cancelled tryout responses cannot enter the conversation', async () => {
  const client = originalCapture.call(apiClient);
  const controller = new AbortController();
  client.post = (async () => {
    controller.abort();
    return { auth_index: 'a', text: 'late reply', finish_reason: 'stop', elapsed_ms: 1 };
  }) as typeof client.post;
  apiClient.captureConnection = () => client;
  await expect(
    sendCredentialTryout('a', 'm', 'id', [{ role: 'user', content: 'hi' }], controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
});
