/**
 * @module notifier
 * Pluggable notification system for test failures, build errors, and pipeline events.
 *
 * Built-in channels:
 * - ConsoleNotifier: logs to stdout (always available)
 * - WebhookNotifier: sends JSON payloads via HTTP POST
 *
 * Custom channels implement the NotificationChannel interface.
 */

// =====================================================================
// Types
// =====================================================================

export type NotificationLevel = 'info' | 'warning' | 'error';

export interface Notification {
  level: NotificationLevel;
  title: string;
  message: string;
  project?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface NotificationChannel {
  readonly name: string;
  send(notification: Notification): Promise<void>;
}

export interface NotifierOptions {
  channels?: NotificationChannel[];
  /** Only send notifications at or above this level. Default: 'warning'. */
  minLevel?: NotificationLevel;
}

// =====================================================================
// Notifier — fan-out to multiple channels
// =====================================================================

const LEVEL_ORDER: Record<NotificationLevel, number> = { info: 0, warning: 1, error: 2 };

export class Notifier {
  private channels: NotificationChannel[] = [];
  private minLevel: NotificationLevel;

  constructor(options?: NotifierOptions) {
    this.minLevel = options?.minLevel ?? 'warning';
    if (options?.channels) {
      this.channels = [...options.channels];
    }
  }

  addChannel(channel: NotificationChannel): void {
    this.channels.push(channel);
  }

  removeChannel(name: string): boolean {
    const idx = this.channels.findIndex(c => c.name === name);
    if (idx >= 0) {
      this.channels.splice(idx, 1);
      return true;
    }
    return false;
  }

  getChannels(): string[] {
    return this.channels.map(c => c.name);
  }

  async notify(notification: Notification): Promise<{ sent: string[]; failed: { channel: string; error: string }[] }> {
    if (LEVEL_ORDER[notification.level] < LEVEL_ORDER[this.minLevel]) {
      return { sent: [], failed: [] };
    }

    const sent: string[] = [];
    const failed: { channel: string; error: string }[] = [];

    await Promise.allSettled(
      this.channels.map(async channel => {
        try {
          await channel.send(notification);
          sent.push(channel.name);
        } catch (err) {
          failed.push({ channel: channel.name, error: (err as Error).message });
        }
      }),
    );

    return { sent, failed };
  }

  // Convenience helpers

  async notifyTestFailure(project: string, suite: string, error: string): Promise<void> {
    await this.notify({
      level: 'error',
      title: `Test Failed: ${suite}`,
      message: error,
      project,
      timestamp: Date.now(),
      metadata: { suite },
    });
  }

  async notifyBuildFailure(project: string, image: string, error: string): Promise<void> {
    await this.notify({
      level: 'error',
      title: `Build Failed: ${image}`,
      message: error,
      project,
      timestamp: Date.now(),
      metadata: { image },
    });
  }

  async notifyPipelineComplete(project: string, success: boolean, detail?: string): Promise<void> {
    await this.notify({
      level: success ? 'info' : 'error',
      title: success ? 'Pipeline Succeeded' : 'Pipeline Failed',
      message: detail ?? (success ? 'All stages completed successfully.' : 'Pipeline failed.'),
      project,
      timestamp: Date.now(),
    });
  }
}

// =====================================================================
// ConsoleNotifier
// =====================================================================

export class ConsoleNotifier implements NotificationChannel {
  readonly name = 'console';

  async send(notification: Notification): Promise<void> {
    const prefix = notification.level === 'error' ? '❌' : notification.level === 'warning' ? '⚠️' : 'ℹ️';
    const project = notification.project ? ` [${notification.project}]` : '';
    console.log(`${prefix}${project} ${notification.title}: ${notification.message}`);
  }
}

// =====================================================================
// WebhookNotifier
// =====================================================================

export interface WebhookNotifierOptions {
  url: string;
  /** Custom headers (e.g. Authorization). */
  headers?: Record<string, string>;
  /** Timeout in ms. Default: 10000. */
  timeout?: number;
  /** Custom channel name. Default: 'webhook'. */
  name?: string;
}

export class WebhookNotifier implements NotificationChannel {
  readonly name: string;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(options: WebhookNotifierOptions) {
    this.name = options.name ?? 'webhook';
    this.url = options.url;
    this.headers = { 'Content-Type': 'application/json', ...options.headers };
    this.timeout = options.timeout ?? 10_000;
  }

  async send(notification: Notification): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(notification),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

// =====================================================================
// Factory
// =====================================================================

export interface NotifierConfig {
  /** Minimum notification level. Default: 'warning'. */
  minLevel?: NotificationLevel;
  /** Enable console output. Default: false. */
  console?: boolean;
  /** Webhook endpoints. */
  webhooks?: WebhookNotifierOptions[];
}

export function createNotifier(config?: NotifierConfig): Notifier {
  const channels: NotificationChannel[] = [];
  if (config?.console) channels.push(new ConsoleNotifier());
  if (config?.webhooks) {
    for (const wh of config.webhooks) channels.push(new WebhookNotifier(wh));
  }
  return new Notifier({ channels, minLevel: config?.minLevel });
}
