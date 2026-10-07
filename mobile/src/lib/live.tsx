import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Vibration } from 'react-native';

import { loadConfig, wsUrl } from './api';
import { notifyLocal, pushRegistered } from './notifications';
import type { CallRecord, ServerEvent, Task } from './types';

export interface PendingQuestion {
  callId: string;
  holdId: string;
  question: string;
  who: string;
  isTask: boolean;
}

export interface Alert {
  callId: string;
  text: string;
  who: string;
  at: number;
}

interface LiveState {
  connected: boolean;
  liveCalls: Record<string, CallRecord>;
  questions: PendingQuestion[];
  alerts: Alert[];
  taskUpdates: Record<string, Task>;
  version: number; // bumps on every event so lists can refresh
  reconnect: () => void;
  answerViaSocket: (callId: string, text: string, holdId?: string) => boolean;
}

const LiveContext = createContext<LiveState | null>(null);

export function useLive(): LiveState {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLive outside LiveProvider');
  return ctx;
}

/** Keeps one websocket to the server and turns its events into app state. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [liveCalls, setLiveCalls] = useState<Record<string, CallRecord>>({});
  const [questions, setQuestions] = useState<PendingQuestion[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [taskUpdates, setTaskUpdates] = useState<Record<string, Task>>({});
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const ws = useRef<WebSocket | null>(null);

  const onEvent = useCallback((ev: ServerEvent) => {
    setVersion((v) => v + 1);
    switch (ev.event) {
      case 'call_started':
      case 'call_snapshot':
        setLiveCalls((c) => ({ ...c, [ev.call.id]: ev.call }));
        if (ev.event === 'call_started' && !pushRegistered) {
          const who = ev.call.contact_name || ev.call.number || 'Unknown caller';
          notifyLocal('Assistant answering', `${who}. Tap to follow live.`, { call_id: ev.call.id });
        }
        break;
      case 'transcript':
        setLiveCalls((c) => {
          const call = c[ev.call_id];
          if (!call) return c;
          return { ...c, [ev.call_id]: { ...call, transcript: [...call.transcript, ev.line] } };
        });
        break;
      case 'call_category':
        setLiveCalls((c) => (c[ev.call_id] ? { ...c, [ev.call_id]: { ...c[ev.call_id], category: ev.category } } : c));
        break;
      case 'hold_question':
      case 'task_needs_decision':
        Vibration.vibrate([0, 400, 200, 400]);
        setQuestions((q) => [
          ...q,
          { callId: ev.call_id, holdId: ev.hold_id, question: ev.question, who: ev.who, isTask: ev.event === 'task_needs_decision' },
        ]);
        setLiveCalls((c) => (c[ev.call_id] ? { ...c, [ev.call_id]: { ...c[ev.call_id], status: 'on_hold' } } : c));
        if (!pushRegistered) {
          notifyLocal(`${ev.who} is waiting`, ev.question, { call_id: ev.call_id, hold_id: ev.hold_id }, true);
        }
        break;
      case 'hold_resolved':
        setQuestions((q) => q.filter((x) => x.holdId !== ev.hold_id));
        setLiveCalls((c) => (c[ev.call_id] ? { ...c, [ev.call_id]: { ...c[ev.call_id], status: 'active' } } : c));
        break;
      case 'sensitive_request':
        Vibration.vibrate(600);
        setAlerts((a) => [{ callId: ev.call_id, text: ev.text, who: ev.who, at: Date.now() }, ...a].slice(0, 20));
        if (!pushRegistered) notifyLocal('Security alert', `${ev.who}: ${ev.text}`, { call_id: ev.call_id });
        break;
      case 'call_ended':
        setLiveCalls((c) => {
          const { [ev.call.id]: _, ...rest } = c;
          return rest;
        });
        setQuestions((q) => q.filter((x) => x.callId !== ev.call.id));
        break;
      case 'message_taken':
        if (!pushRegistered) notifyLocal(`Message from ${ev.who}`, ev.message.text, { message_id: ev.message.id });
        break;
      case 'task_update':
        setTaskUpdates((t) => ({ ...t, [ev.task.id]: ev.task }));
        if (!pushRegistered && (ev.task.status === 'done' || ev.task.status === 'failed')) {
          notifyLocal('Call task finished', ev.title, { task_id: ev.task.id });
        }
        break;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      await loadConfig();
      const url = wsUrl('/ws/events');
      if (!url || cancelled) return;
      const socket = new WebSocket(url);
      ws.current = socket;
      socket.onopen = () => setConnected(true);
      socket.onmessage = (m) => {
        try {
          onEvent(JSON.parse(String(m.data)) as ServerEvent);
        } catch {}
      };
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) retry = setTimeout(() => setAttempt((a) => a + 1), Math.min(30000, 2000 * (attempt + 1)));
      };
    })();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      ws.current?.close();
    };
  }, [attempt, onEvent]);

  const answerViaSocket = useCallback((callId: string, text: string, holdId?: string) => {
    if (ws.current?.readyState !== WebSocket.OPEN) return false;
    ws.current.send(JSON.stringify({ action: 'answer', call_id: callId, hold_id: holdId, text }));
    return true;
  }, []);

  const value: LiveState = {
    connected,
    liveCalls,
    questions,
    alerts,
    taskUpdates,
    version,
    reconnect: () => setAttempt((a) => a + 1),
    answerViaSocket,
  };
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
