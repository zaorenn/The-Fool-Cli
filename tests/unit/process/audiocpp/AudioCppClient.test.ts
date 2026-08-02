/**
 * @license
 * Copyright 2026 The Fool contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AudioCppClient, AudioCppClientError } from '@process/services/fool-voice/audiocpp/AudioCppClient';

/** What the stub server saw, so a test can assert on the wire bytes rather than on a spy. */
type CapturedRequest = {
  method: string;
  url: string;
  contentType: string | undefined;
  body: string;
};

type Handler = (request: IncomingMessage, response: ServerResponse, body: string) => void;

const servers: Server[] = [];

/** Starts a throwaway HTTP server on a free loopback port and returns its base URL. */
const startStub = async (handler: Handler): Promise<{ baseUrl: string; captured: CapturedRequest[] }> => {
  const captured: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      captured.push({
        method: request.method ?? '',
        url: request.url ?? '',
        contentType: request.headers['content-type'],
        body,
      });
      handler(request, response, body);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}`, captured };
};

/** A minimal but structurally valid PCM16 WAV, matching what `encode_pcm16_wav` produces. */
const wavBytes = (): Buffer => {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + 4, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(4, 40);
  return Buffer.concat([header, Buffer.from([0, 0, 1, 0])]);
};

const sendWav = (response: ServerResponse): void => {
  const wav = wavBytes();
  response.writeHead(200, {
    'content-type': 'audio/wav',
    'x-audiocpp-wall-ms': '1234.500000',
    'x-audiocpp-audio-duration-ms': '2000.000000',
    'x-audiocpp-rtf': '0.617250',
  });
  response.end(wav);
};

const sendJson = (response: ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          // `close` stops the server accepting new connections and waits for the
          // open ones to end themselves. A keep-alive socket never does, so the
          // callback does not fire until the peer gives up — and when it is torn
          // down underneath, the reset arrives on a socket nobody is listening
          // to any more and vitest reports an uncaught ECONNRESET that fails a
          // run in which every test passed.
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

describe('AudioCppClient.synthesize', () => {
  it('posts the documented speech body and returns the WAV with its timing headers', async () => {
    const { baseUrl, captured } = await startStub((_request, response) => sendWav(response));

    const result = await new AudioCppClient(baseUrl).synthesize({
      model: 'chatterbox',
      input: 'Merhaba dünya.',
    });

    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe('POST');
    expect(captured[0].url).toBe('/v1/audio/speech');
    expect(captured[0].contentType).toContain('application/json');
    // `input`, not `text`; `model` selects the configured entry. Both are required upstream.
    expect(JSON.parse(captured[0].body)).toEqual({ model: 'chatterbox', input: 'Merhaba dünya.' });

    expect(Array.from(result.wav.subarray(0, 4))).toEqual([0x52, 0x49, 0x46, 0x46]);
    expect(result.wallMs).toBeCloseTo(1234.5);
    expect(result.audioDurationMs).toBeCloseTo(2000);
    expect(result.realTimeFactor).toBeCloseTo(0.61725);
  });

  it('sends generation params inside `options`, and language at the top level', async () => {
    const { baseUrl, captured } = await startStub((_request, response) => sendWav(response));

    await new AudioCppClient(baseUrl).synthesize({
      model: 'chatterbox',
      input: 'Hello.',
      language: 'tr',
      options: {
        guidance_scale: 0.5,
        temperature: 0.8,
        repetition_penalty: 1.2,
        max_tokens: 384,
        do_sample: true,
        text_chunk_size: 128,
      },
    });

    const body = JSON.parse(captured[0].body) as Record<string, unknown>;
    // `language` feeds the Transcript, never the options map, so it must stay top level.
    expect(body.language).toBe('tr');
    expect(body.options).toEqual({
      guidance_scale: 0.5,
      temperature: 0.8,
      repetition_penalty: 1.2,
      max_tokens: 384,
      do_sample: true,
      text_chunk_size: 128,
    });
    // Keys stay snake_case and stay nested: the hyphenated CLI spellings are silently
    // ignored by the server, and a flat copy would shadow whatever `options` carried.
    expect(body).not.toHaveProperty('guidance-scale');
    expect(body).not.toHaveProperty('temperature');
  });

  it('passes a cloning reference as a server-local path in `voice_ref`', async () => {
    const { baseUrl, captured } = await startStub((_request, response) => sendWav(response));

    await new AudioCppClient(baseUrl).synthesize({
      model: 'chatterbox',
      input: 'Hello.',
      voiceRef: 'C:\\data\\fool\\voices\\abc\\reference.wav',
      referenceText: 'the reference transcript',
    });

    const body = JSON.parse(captured[0].body) as Record<string, unknown>;
    expect(body.voice_ref).toBe('C:\\data\\fool\\voices\\abc\\reference.wav');
    expect(body.reference_text).toBe('the reference transcript');
    // The reference travels as a path, never as bytes: the route has no multipart branch
    // and no base64 audio field.
    expect(captured[0].contentType).toContain('application/json');
    expect(captured[0].body).not.toContain('base64');
  });

  it('omits every field the caller did not set', async () => {
    const { baseUrl, captured } = await startStub((_request, response) => sendWav(response));

    await new AudioCppClient(baseUrl).synthesize({ model: 'm', input: 'x', options: {} });

    expect(Object.keys(JSON.parse(captured[0].body) as object).toSorted()).toEqual(['input', 'model']);
  });

  it('maps a server error envelope to a typed http error', async () => {
    const { baseUrl } = await startStub((_request, response) =>
      // The upstream server answers a *client* mistake with 500, not 400.
      sendJson(response, 500, { error: { message: 'unknown model id: nope', type: 'server_error' } })
    );

    const error = await new AudioCppClient(baseUrl)
      .synthesize({ model: 'nope', input: 'x' })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AudioCppClientError);
    const typed = error as AudioCppClientError;
    expect(typed.kind).toBe('http');
    expect(typed.status).toBe(500);
    expect(typed.serverType).toBe('server_error');
    expect(typed.message).toContain('unknown model id: nope');
  });

  it('still produces a typed http error when the failure body is not the documented envelope', async () => {
    const { baseUrl } = await startStub((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' });
      response.end('busy');
    });

    const error = (await new AudioCppClient(baseUrl)
      .synthesize({ model: 'm', input: 'x' })
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error).toBeInstanceOf(AudioCppClientError);
    expect(error.kind).toBe('http');
    expect(error.status).toBe(503);
    expect(error.serverType).toBeUndefined();
  });

  it('rejects a 200 whose body is not WAV audio', async () => {
    const { baseUrl } = await startStub((_request, response) => sendJson(response, 200, { audio: 'nope' }));

    const error = (await new AudioCppClient(baseUrl)
      .synthesize({ model: 'm', input: 'x' })
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error).toBeInstanceOf(AudioCppClientError);
    expect(error.kind).toBe('malformed-response');
  });

  it('rejects audio bytes that are not a RIFF/WAVE container', async () => {
    const { baseUrl } = await startStub((_request, response) => {
      response.writeHead(200, { 'content-type': 'audio/wav' });
      response.end(Buffer.from('not actually a wav file at all'));
    });

    const error = (await new AudioCppClient(baseUrl)
      .synthesize({ model: 'm', input: 'x' })
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error.kind).toBe('malformed-response');
  });

  it('maps an unreachable server to a typed transport error', async () => {
    // Bound and immediately closed, so the port is free and the connection is refused.
    const { baseUrl } = await startStub((_request, response) => response.end());
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));

    const error = (await new AudioCppClient(baseUrl)
      .synthesize({ model: 'm', input: 'x' })
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error).toBeInstanceOf(AudioCppClientError);
    expect(error.kind).toBe('transport');
  });
});

describe('AudioCppClient.getHealth', () => {
  it('reads the health payload, where `models` is a count', async () => {
    const { baseUrl, captured } = await startStub((_request, response) =>
      sendJson(response, 200, { status: 'ok', backend: 'cpu', models: 2 })
    );

    const health = await new AudioCppClient(baseUrl).getHealth();

    expect(captured[0].method).toBe('GET');
    expect(captured[0].url).toBe('/health');
    expect(health).toEqual({ status: 'ok', backend: 'cpu', models: 2 });
  });

  it('rejects a health payload whose `models` is an array rather than a count', async () => {
    const { baseUrl } = await startStub((_request, response) =>
      sendJson(response, 200, { status: 'ok', backend: 'cpu', models: ['chatterbox'] })
    );

    const error = (await new AudioCppClient(baseUrl)
      .getHealth()
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error).toBeInstanceOf(AudioCppClientError);
    expect(error.kind).toBe('malformed-response');
  });

  it('rejects a health body that is not JSON at all', async () => {
    const { baseUrl } = await startStub((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{ this is not json');
    });

    const error = (await new AudioCppClient(baseUrl)
      .getHealth()
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error.kind).toBe('malformed-response');
  });
});

describe('AudioCppClient.listModels', () => {
  it('maps the OpenAI-style list into camelCase entries', async () => {
    const { baseUrl, captured } = await startStub((_request, response) =>
      sendJson(response, 200, {
        object: 'list',
        data: [
          {
            id: 'chatterbox',
            object: 'model',
            owned_by: 'engine',
            family: 'chatterbox',
            task: 'clon',
            mode: 'offline',
          },
        ],
      })
    );

    const models = await new AudioCppClient(baseUrl).listModels();

    expect(captured[0].url).toBe('/v1/models');
    expect(models).toEqual([
      { id: 'chatterbox', ownedBy: 'engine', family: 'chatterbox', task: 'clon', mode: 'offline' },
    ]);
  });

  it('rejects a list whose entries are missing documented fields', async () => {
    const { baseUrl } = await startStub((_request, response) =>
      sendJson(response, 200, { object: 'list', data: [{ id: 'chatterbox' }] })
    );

    const error = (await new AudioCppClient(baseUrl)
      .listModels()
      .catch((thrown: unknown) => thrown)) as AudioCppClientError;

    expect(error.kind).toBe('malformed-response');
  });
});
