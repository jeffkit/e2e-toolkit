/**
 * @module openapi/recorder
 * Record/replay subsystem for OpenAPI Smart Mock.
 *
 * - Record mode: proxy requests to the real API, save request/response pairs
 * - Replay mode: serve recorded responses by matching request signatures
 * - Smart mode: replay when available, fall back to auto-generated response
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  RecordingEntry,
  RecordingFile,
  RecordingStore,
  RequestSignature,
} from './types.js';

interface SSEBusLike {
  emit(channel: string, message: { event: string; data: unknown }): void;
}

/**
 * Compute a request signature for recording matching.
 * Format: `${METHOD}:${path}?${sortedQueryString}`
 */
export function computeSignature(
  method: string,
  reqPath: string,
  query: Record<string, string>,
): RequestSignature {
  const sortedQuery = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join('&');
  return `${method.toUpperCase()}:${reqPath}${sortedQuery ? '?' + sortedQuery : ''}`;
}

/**
 * In-memory recording store with file persistence.
 */
export class RecordingStoreImpl implements RecordingStore {
  private entries: RecordingEntry[] = [];
  private index = new Map<RequestSignature, number[]>();
  private mockName: string;
  private recordingsDir: string;
  private specFile?: string;

  constructor(mockName: string, recordingsDir: string, specFile?: string) {
    this.mockName = mockName;
    this.recordingsDir = recordingsDir;
    this.specFile = specFile;
  }

  save(entry: RecordingEntry): void {
    const idx = this.entries.length;
    this.entries.push(entry);

    const sig = computeSignature(
      entry.request.method,
      entry.request.path,
      entry.request.query,
    );
    const existing = this.index.get(sig) ?? [];
    existing.push(idx);
    this.index.set(sig, existing);
  }

  find(signature: RequestSignature): RecordingEntry | undefined {
    const indices = this.index.get(signature);
    if (!indices || indices.length === 0) return undefined;
    return this.entries[indices[indices.length - 1]!];
  }

  has(signature: RequestSignature): boolean {
    return this.index.has(signature);
  }

  async flush(): Promise<void> {
    const filePath = this.getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const file: RecordingFile = {
      metadata: {
        mockName: this.mockName,
        recordedAt: new Date().toISOString(),
        specFile: this.specFile,
        version: 1,
      },
      recordings: this.entries,
    };

    await fs.writeFile(filePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  async load(): Promise<void> {
    const filePath = this.getFilePath();
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const file = JSON.parse(raw) as RecordingFile;
      this.entries = file.recordings ?? [];

      this.index.clear();
      for (let i = 0; i < this.entries.length; i++) {
        const entry = this.entries[i]!;
        const sig = computeSignature(
          entry.request.method,
          entry.request.path,
          entry.request.query,
        );
        const existing = this.index.get(sig) ?? [];
        existing.push(i);
        this.index.set(sig, existing);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.entries = [];
        this.index.clear();
        return;
      }
      throw err;
    }
  }

  private getFilePath(): string {
    return path.resolve(this.recordingsDir, `${this.mockName}.json`);
  }
}

export interface RecordHandlerOptions {
  eventBus?: SSEBusLike;
  mockName?: string;
}

/**
 * Create a Fastify handler that proxies requests to the real API
 * and records the request/response pair.
 */
export function createRecordHandler(
  target: string,
  store: RecordingStore,
  options?: RecordHandlerOptions,
): (req: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const baseUrl = target.replace(/\/$/, '');

  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const urlPath = req.url;
    const fullUrl = `${baseUrl}${urlPath}`;

    try {
      const fetchHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string' && key !== 'host' && key !== 'connection') {
          fetchHeaders[key] = value;
        }
      }

      const fetchOptions: RequestInit = {
        method: req.method,
        headers: fetchHeaders,
      };

      if (req.body !== undefined && req.body !== null && req.method !== 'GET' && req.method !== 'HEAD') {
        fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      }

      const response = await fetch(fullUrl, fetchOptions);
      const responseBody = await response.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(responseBody);
      } catch {
        parsedBody = responseBody;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      const query = (req.query ?? {}) as Record<string, string>;
      const reqHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(req.headers)) {
        if (typeof value === 'string') {
          reqHeaders[key] = value;
        }
      }

      const entry: RecordingEntry = {
        request: {
          method: req.method,
          path: req.url.split('?')[0]!,
          query,
          headers: reqHeaders,
          body: req.body ?? undefined,
        },
        response: {
          status: response.status,
          headers: responseHeaders,
          body: parsedBody,
        },
        timestamp: new Date().toISOString(),
      };

      store.save(entry);

      options?.eventBus?.emit('setup', {
        event: 'mock_recording_saved',
        data: {
          type: 'mock_recording_saved',
          name: options?.mockName ?? 'mock',
          method: req.method,
          path: req.url.split('?')[0]!,
          timestamp: Date.now(),
        },
      });

      for (const [key, value] of Object.entries(responseHeaders)) {
        if (key !== 'content-encoding' && key !== 'transfer-encoding') {
          void reply.header(key, value);
        }
      }

      return reply.status(response.status).send(parsedBody);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(502).send({
        error: 'Record proxy failed',
        message: `Failed to reach target API: ${message}`,
        target: fullUrl,
      });
    }
  };
}
