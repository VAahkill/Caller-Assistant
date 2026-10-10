import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, Vibration } from 'react-native';

import { loadConfig, wsUrl } from './api';
import { initialLive, liveReducer, parseEvent, type LiveData, type SecurityAlert, type ServerEvent } from './events';
import { notifyLocal, pushRegistered } from './notifications';
import { getTransport, refusedToken, SOCKET_OPEN, type SocketLike } from './transport';

export type { CallView, PendingQuestion, SecurityAlert } from './events';

/** Owner actions the events socket accepts (API contract v2). */
export type OwnerAction =
  | { action: 'answer'; call_id: string; text: string; hold_id?: string }
  | { action: 'say'; call_id: string; text: string; lang?: string }
  | { action: 'say_audio'; call_id: string; audio_b64: string; lang?: string };

export interface LiveState extends LiveData {
  connected: boolean;
  reconnect: () => void;
  dismissAlert: (id: string) => void;
  restoreAlert: (alert: SecurityAlert) => void;
  /** Reload stored lists and the profile, after a change made outside the events (e.g. the owner chat). */
  invalidate: () => void;
  /** Sends over the events socket; false when it isn't open (use the HTTP API then). */
  send: (action: OwnerAction) => boolean;
}

const LiveContext = createContext<LiveState | null>(null);

export function useLive(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive outside LiveProvider');
  return ctx;
}

const warn = (what: string) => (e: unknown) => console.warn(what, e);

// While the app runs and the server can't push to this phone, the app raises
// the notifications itself from the event stream.
function notifyFor(ev: ServerEvent) {
  if (Platform.OS === 'web') return;
  const local = (title: string, body: string, data: Record<string, unknown>, hold = false) => {
    if (!pushRegistered) notifyLocal(title, body, data, hold).catch(warn("Couldn't show a notification"));
  };
  switch (ev.event) {
    case 'call_started':
      local('Assistant answering', `${ev.who || 'Unknown caller'}. Tap to follow live.`, { call_id: ev.call_id });
      break;
    case 'hold_question':
    case 'task_needs_decision':
      Vibration.vibrate([0, 400, 200, 400]);
      local(`${ev.who} is waiting`, ev.question, { call_id: ev.call_id, hold_id: ev.hold_id }, true);
      break;
    case 'sensitive_request':
      Vibration.vibrate(600);
      local('Security alert', `${ev.who}: ${ev.text}`, { call_id: ev.call_id });
      break;
    case 'message_taken':
      local(`Message from ${ev.who}`, ev.message.text, { message_id: ev.message.id });
      break;
    case 'task_update':
      if (ev.task.status === 'done' || ev.task.status === 'failed') local('Call task finished', ev.title, { task_id: ev.task.id });
      break;
  }
}

/** How long after (re)connecting the snapshots of live calls must have arrived. */
export const SNAPSHOT_GRACE_MS = 3000;

/** Keeps one websocket to the server and turns its events into app state. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(liveReducer, initialLive);
  const [connected, setConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failures = useRef(0);
  const ws = useRef<SocketLike | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    loadConfig()
      .then(() => {
        const url = wsUrl('/ws/events');
        if (!url || cancelled) return;
        const socket = getTransport().openSocket(url);
        ws.current = socket;
        // Every handler first checks the socket is still the current one: after a
        // reconnect the old socket's late events must not touch the app.
        const stale = () => cancelled || ws.current !== socket;
        socket.onopen = () => {
          if (stale()) {
            socket.close();
            return;
          }
          failures.current = 0;
          setConnected(true);
          // The server sends a snapshot of each live call right away. Calls it
          // doesn't send again have ended while we were away: drop them shortly.
          dispatch({ type: 'reset' });
          if (settle) clearTimeout(settle);
          settle = setTimeout(() => dispatch({ type: 'dropStale' }), SNAPSHOT_GRACE_MS);
        };
        socket.onmessage = (m) => {
          if (stale()) return;
          const parsed = parseEvent(m.data);
          if (!parsed.ok) {
            console.warn('Ignored a live event:', parsed.reason);
            return;
          }
          const ev = parsed.event as ServerEvent;
          dispatch({ type: 'event', event: ev });
          notifyFor(ev);
        };
        socket.onerror = () => undefined; // onclose follows and schedules the retry
        socket.onclose = (e) => {
          if (stale()) return;
          ws.current = null;
          setConnected(false);
          // A refused token never gets better by retrying fast.
          failures.current = refusedToken(e?.code, e?.reason) ? Math.max(failures.current + 1, 10) : failures.current + 1;
          retry = setTimeout(() => setAttempt((a) => a + 1), Math.min(30000, 2000 * failures.current));
        };
      })
      .catch(warn("Couldn't load the server settings"));
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      if (settle) clearTimeout(settle);
      const old = ws.current;
      ws.current = null;
      setConnected(false);
      if (old) {
        old.onmessage = null;
        old.onclose = null;
        // On Android, close() does nothing while the socket is still connecting,
        // so one that opens later is closed then.
        old.onopen = () => old.close();
        old.close();
      }
    };
  }, [attempt]);

  // Coming back to the app: reconnect straight away instead of waiting out the backoff.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !ws.current) {
        failures.current = 0;
        setAttempt((a) => a + 1);
      }
    });
    return () => sub.remove();
  }, []);

  const send = useCallback((action: OwnerAction) => {
    const socket = ws.current;
    if (!socket || socket.readyState !== SOCKET_OPEN) return false;
    socket.send(JSON.stringify(action));
    return true;
  }, []);

  const reconnect = useCallback(() => {
    failures.current = 0;
    setAttempt((a) => a + 1);
  }, []);

  const dismissAlert = useCallback((id: string) => dispatch({ type: 'dismissAlert', id }), []);
  const restoreAlert = useCallback((alert: SecurityAlert) => dispatch({ type: 'restoreAlert', alert }), []);
  const invalidate = useCallback(() => dispatch({ type: 'invalidate' }), []);

  const value = useMemo<LiveState>(
    () => ({ ...data, connected, reconnect, dismissAlert, restoreAlert, invalidate, send }),
    [data, connected, reconnect, dismissAlert, restoreAlert, invalidate, send],
  );
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
