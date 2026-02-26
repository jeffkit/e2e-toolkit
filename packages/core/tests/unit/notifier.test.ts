import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  Notifier,
  ConsoleNotifier,
  WebhookNotifier,
  createNotifier,
  type Notification,
  type NotificationChannel,
} from '../../src/notifier.js';

// =====================================================================
// Helpers
// =====================================================================

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    level: 'error',
    title: 'Test Failed',
    message: 'Assertion error in login test',
    project: '/my-project',
    timestamp: Date.now(),
    ...overrides,
  };
}

class SpyChannel implements NotificationChannel {
  readonly name: string;
  readonly sent: Notification[] = [];
  shouldFail = false;

  constructor(name = 'spy') {
    this.name = name;
  }

  async send(notification: Notification): Promise<void> {
    if (this.shouldFail) throw new Error(`${this.name} failed`);
    this.sent.push(notification);
  }
}

// =====================================================================
// Notifier core
// =====================================================================

describe('Notifier', () => {
  let spy: SpyChannel;
  let notifier: Notifier;

  beforeEach(() => {
    spy = new SpyChannel();
    notifier = new Notifier({ channels: [spy], minLevel: 'warning' });
  });

  it('sends notification to all channels', async () => {
    const spy2 = new SpyChannel('spy2');
    notifier.addChannel(spy2);
    await notifier.notify(makeNotification());
    expect(spy.sent).toHaveLength(1);
    expect(spy2.sent).toHaveLength(1);
  });

  it('filters notifications below minLevel', async () => {
    const result = await notifier.notify(makeNotification({ level: 'info' }));
    expect(spy.sent).toHaveLength(0);
    expect(result.sent).toHaveLength(0);
  });

  it('sends warning level when minLevel is warning', async () => {
    await notifier.notify(makeNotification({ level: 'warning' }));
    expect(spy.sent).toHaveLength(1);
  });

  it('sends error level when minLevel is warning', async () => {
    await notifier.notify(makeNotification({ level: 'error' }));
    expect(spy.sent).toHaveLength(1);
  });

  it('reports failed channels without blocking others', async () => {
    const failSpy = new SpyChannel('failer');
    failSpy.shouldFail = true;
    notifier.addChannel(failSpy);

    const result = await notifier.notify(makeNotification());
    expect(result.sent).toContain('spy');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].channel).toBe('failer');
  });

  it('addChannel / removeChannel', () => {
    expect(notifier.getChannels()).toEqual(['spy']);
    notifier.addChannel(new SpyChannel('extra'));
    expect(notifier.getChannels()).toEqual(['spy', 'extra']);
    expect(notifier.removeChannel('spy')).toBe(true);
    expect(notifier.getChannels()).toEqual(['extra']);
    expect(notifier.removeChannel('nope')).toBe(false);
  });
});

// =====================================================================
// Convenience methods
// =====================================================================

describe('Notifier convenience methods', () => {
  it('notifyTestFailure sends error notification', async () => {
    const spy = new SpyChannel();
    const notifier = new Notifier({ channels: [spy], minLevel: 'error' });
    await notifier.notifyTestFailure('/proj', 'login.yaml', 'Status 500');
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0].level).toBe('error');
    expect(spy.sent[0].title).toContain('login.yaml');
  });

  it('notifyBuildFailure sends error notification', async () => {
    const spy = new SpyChannel();
    const notifier = new Notifier({ channels: [spy], minLevel: 'error' });
    await notifier.notifyBuildFailure('/proj', 'app:latest', 'Dockerfile not found');
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0].title).toContain('app:latest');
  });

  it('notifyPipelineComplete sends correct level', async () => {
    const spy = new SpyChannel();
    const notifier = new Notifier({ channels: [spy], minLevel: 'info' });

    await notifier.notifyPipelineComplete('/proj', true);
    expect(spy.sent[0].level).toBe('info');
    expect(spy.sent[0].title).toContain('Succeeded');

    await notifier.notifyPipelineComplete('/proj', false);
    expect(spy.sent[1].level).toBe('error');
    expect(spy.sent[1].title).toContain('Failed');
  });
});

// =====================================================================
// ConsoleNotifier
// =====================================================================

describe('ConsoleNotifier', () => {
  it('logs notification to console', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const channel = new ConsoleNotifier();
    await channel.send(makeNotification({ level: 'error', title: 'Boom' }));
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain('Boom');
    consoleSpy.mockRestore();
  });

  it('uses different prefixes for levels', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const channel = new ConsoleNotifier();

    await channel.send(makeNotification({ level: 'info' }));
    expect(consoleSpy.mock.calls[0][0]).toContain('ℹ️');

    await channel.send(makeNotification({ level: 'warning' }));
    expect(consoleSpy.mock.calls[1][0]).toContain('⚠️');

    await channel.send(makeNotification({ level: 'error' }));
    expect(consoleSpy.mock.calls[2][0]).toContain('❌');

    consoleSpy.mockRestore();
  });
});

// =====================================================================
// WebhookNotifier
// =====================================================================

describe('WebhookNotifier', () => {
  it('sends JSON payload via POST', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new WebhookNotifier({ url: 'https://example.com/hook' });
    const notification = makeNotification();
    await channel.send(notification);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toMatchObject({ title: notification.title });

    vi.unstubAllGlobals();
  });

  it('throws on non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' }));

    const channel = new WebhookNotifier({ url: 'https://example.com/hook' });
    await expect(channel.send(makeNotification())).rejects.toThrow('500');

    vi.unstubAllGlobals();
  });

  it('includes custom headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
    vi.stubGlobal('fetch', fetchMock);

    const channel = new WebhookNotifier({
      url: 'https://example.com/hook',
      headers: { Authorization: 'Bearer secret' },
    });
    await channel.send(makeNotification());

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
    vi.unstubAllGlobals();
  });

  it('uses custom name', () => {
    const channel = new WebhookNotifier({ url: 'https://x.com', name: 'slack' });
    expect(channel.name).toBe('slack');
  });
});

// =====================================================================
// createNotifier factory
// =====================================================================

describe('createNotifier factory', () => {
  it('creates notifier with console channel', () => {
    const notifier = createNotifier({ console: true });
    expect(notifier.getChannels()).toContain('console');
  });

  it('creates notifier with webhook channels', () => {
    const notifier = createNotifier({
      webhooks: [
        { url: 'https://a.com/hook' },
        { url: 'https://b.com/hook', name: 'slack' },
      ],
    });
    expect(notifier.getChannels()).toEqual(['webhook', 'slack']);
  });

  it('creates empty notifier by default', () => {
    const notifier = createNotifier();
    expect(notifier.getChannels()).toEqual([]);
  });
});
