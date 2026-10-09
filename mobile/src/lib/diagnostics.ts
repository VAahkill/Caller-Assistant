// Settings, About and diagnostics: a server check that also times the round
// trip, and a plain-text report to paste into a message or an issue. The
// report never contains the access token.

import { api, type ServerConfig } from './api';
import { dialerName } from './format';
import type { Health } from './types';

export interface HealthCheck {
  health: Health;
  /** Round trip of GET /health, in milliseconds. */
  ms: number;
  /** When it answered (ms since the epoch). */
  at: number;
}

export async function checkHealth(now: () => number = Date.now): Promise<HealthCheck> {
  const started = now();
  const health = await api.health();
  const at = now();
  return { health, ms: Math.max(0, at - started), at };
}

/** "Fast", "OK" or "Slow" for a round trip, for the Connection row. */
export function speedWord(ms: number): string {
  return ms < 300 ? 'Fast' : ms < 1500 ? 'OK' : 'Slow';
}

export interface DiagnosticsInput {
  appVersion: string;
  platform: string;
  config: ServerConfig | null;
  connected: boolean;
  check: HealthCheck | null;
  error: string | null;
  at?: Date;
}

/** What someone helping with a problem needs to know, one fact per line. */
export function diagnosticsText({ appVersion, platform, config, connected, check, error, at = new Date() }: DiagnosticsInput): string {
  const h = check?.health;
  const ready = h?.ready
    ? Object.entries(h.ready)
        .map(([k, v]) => `${k} ${v ? 'ready' : 'loading'}`)
        .join(', ')
    : 'not reported';
  const lines = [
    `OpenCall app ${appVersion || 'unknown'} on ${platform}`,
    `Report made ${at.toISOString()}`,
    `Server: ${config ? config.url : 'not set up'}`,
    `Live updates: ${!config ? 'off' : connected ? 'connected' : 'reconnecting'}`,
  ];
  if (h) {
    lines.push(
      `Server version: ${h.version || 'unknown'}`,
      `Response time: ${check.ms} ms`,
      `Parts: ${ready}`,
      `Language model: ${h.llm_model || 'not reported'}`,
      `Outbound calling: ${dialerName(h.dialer)}`,
      `Calls right now: ${h.active_calls}`,
    );
  }
  if (error) lines.push(`Last error: ${error}`);
  return lines.join('\n');
}

/** The compose service in docker-compose.yml is "opencall". Run directly on
 *  the host (the Bluetooth route), the logs are in the server's own window. */
export const LOGS_COMMAND = 'docker compose logs -f opencall';
