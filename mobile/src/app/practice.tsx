import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { Transcript } from '../components/domain/Transcript';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Composer } from '../components/ui/Composer';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusPill } from '../components/ui/StatusPill';
import { Switch } from '../components/ui/Switch';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { errorMessage } from '../hooks/useAsyncAction';
import type { Recording } from '../hooks/useHoldToTalk';
import { useProfile } from '../hooks/useProfile';
import { useSentencePlayer } from '../hooks/useSentencePlayer';
import { useTokens } from '../lib/design/theme';
import { ASSISTANT_STATE_LABEL, callView, reduceCall, type CallView, type ServerEvent } from '../lib/events';
import { languageName } from '../lib/languages';
import { PracticeCall, recordingBase64 } from '../lib/simulate';

const LANGS = [
  { value: '', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'te', label: 'Telugu' },
  { value: 'ta', label: 'Tamil' },
];

const STARTERS: Record<string, string[]> = {
  '': ['Hi, I have a Swiggy order for you. Where should I come?', 'Sir, please tell me the OTP for the delivery.'],
  en: ['Hi, I have a Swiggy order for you. Where should I come?', 'Is he free for dinner on Saturday?', 'Sir, please tell me the OTP for the delivery.'],
  hi: ['नमस्ते, आपका पार्सल आया है। कहाँ आना है?', 'सर, डिलीवरी के लिए OTP बताइए।'],
  te: ['నమస్కారం, మీ పార్సెల్ వచ్చింది. మీ ఇల్లు ఎక్కడ?', 'సార్, డెలివరీ కోసం OTP చెప్పండి.'],
  ta: ['வணக்கம், உங்கள் பார்சல் வந்திருக்கு. உங்கள் வீடு எங்கே?', 'சார், டெலிவரிக்கு OTP சொல்லுங்க.'],
};

type Phase = 'idle' | 'connecting' | 'live' | 'ended';

/** You play a caller; your assistant answers exactly as on a real call.
 *  Uses /ws/simulate directly, so it needs no phone line. */
export default function Practice() {
  const t = useTokens();
  const toast = useToast();
  const profile = useProfile();
  const [lang, setLang] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [view, setView] = useState<CallView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showTranslation, setShowTranslation] = useState(true);
  const call = useRef<PracticeCall | null>(null);
  const scroll = useRef<ScrollView>(null);
  const audio = useSentencePlayer(setProblem);

  const onEvent = useCallback((ev: ServerEvent) => {
    setView((v) => (v ? reduceCall(v, ev) : v));
  }, []);

  useEffect(
    () => () => {
      call.current?.hangup();
    },
    [],
  );

  const start = async () => {
    setProblem(null);
    setPhase('connecting');
    try {
      await audio.prepare().catch((e: unknown) => console.warn('Audio mode not set', e));
      const c = await PracticeCall.start(
        { lang },
        {
          onEvent,
          onAudio: audio.push,
          onClose: ({ message }) => {
            setPhase('ended');
            setView((v) => (v ? { ...v, status: 'idle' } : v));
            if (message) setProblem(message);
          },
        },
      );
      call.current = c;
      setView(
        callView({
          id: c.callId,
          direction: 'inbound',
          number: '+919800000000',
          contact_name: 'You, as the caller',
          category: 'unknown',
          status: 'active',
          language: lang,
          started_at: Date.now() / 1000,
          ended_at: null,
          transcript: [],
          holds: [],
          summary: '',
          message: '',
          recording: '',
          task_id: null,
          reject_reason: '',
          urgent: false,
          action_items: [],
        }),
      );
      setPhase('live');
    } catch (e) {
      setPhase('idle');
      setProblem(errorMessage(e));
    }
  };

  const hangUp = () => {
    audio.stop();
    call.current?.hangup();
  };

  // Each message waits for the server's ack; an error comes back as a toast.
  const guarded = async (what: () => Promise<void>) => {
    setSending(true);
    try {
      await what();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const sendText = (text: string) => guarded(() => call.current!.sendText(text, lang || undefined));
  const sendVoice = (r: Recording) => guarded(async () => call.current!.sendAudio(await recordingBase64(r.uri), lang || undefined));

  const owner = profile.data?.owner_language ?? 'en';
  const lines = view?.record.transcript ?? [];
  const hold = view?.record.holds.find((h) => !h.answer);
  const callerLang = view?.language || lang;

  if (phase === 'idle') {
    return (
      <View style={[styles.flex, { backgroundColor: t.color.bg }]}>
        <ScrollView contentContainerStyle={{ padding: t.space.lg, gap: t.space.xl }}>
          <EmptyState
            icon="mic-circle-outline"
            title="Try your assistant, no phone line needed"
            message="You play someone calling you. Your assistant answers in its own voice, exactly as on a real call. Hold the mic and speak, or type."
          />
          <Card>
            <Text variant="overline" color="text2">
              The caller speaks
            </Text>
            <View style={styles.chips}>
              {LANGS.map((l) => (
                <Chip key={l.value || 'auto'} label={l.label} kind="filter" selected={lang === l.value} onPress={() => setLang(l.value)} />
              ))}
            </View>
            <Text variant="footnote" color="text2">
              {lang ? `The assistant expects ${languageName(lang)} and answers in it.` : 'The assistant works out the language from what you say.'}
            </Text>
          </Card>
          {problem ? <Banner tone="danger" title="Couldn't start the practice call" message={problem} /> : null}
          <Button title="Start practice call" icon="call" size="lg" fullWidth onPress={() => void start()} />
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <Stack.Screen
        options={{
          headerRight: () =>
            phase === 'ended' ? (
              <Button title="Call again" size="sm" variant="tonal" icon="refresh" onPress={() => void start()} />
            ) : (
              <Button title="Hang up" size="sm" variant="destructive" icon="call" onPress={hangUp} />
            ),
        }}
      />
      <View style={[styles.bar, { borderBottomColor: t.color.border, paddingHorizontal: t.space.lg }]}>
        <StatusPill
          label={phase === 'connecting' ? 'Connecting' : phase === 'ended' ? 'Call ended' : audio.speaking ? 'Speaking' : view ? ASSISTANT_STATE_LABEL[view.status] : 'Live'}
          tone={phase === 'ended' ? 'neutral' : 'success'}
          dot
          pulse={phase !== 'ended'}
        />
        {callerLang ? <StatusPill label={languageName(callerLang)} tone="info" icon="language-outline" /> : null}
        <View style={styles.flex} />
        {callerLang && callerLang !== owner ? (
          <View style={styles.toggle}>
            <Text variant="footnote" color="text2">
              {languageName(owner)}
            </Text>
            <Switch value={showTranslation} onValueChange={setShowTranslation} accessibilityLabel={`Show translations in ${languageName(owner)}`} />
          </View>
        ) : null}
      </View>
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {problem ? <Banner tone="warning" title="Problem" message={problem} onDismiss={() => setProblem(null)} /> : null}
        {view?.errors.length ? <Banner tone="warning" title="The assistant had trouble" message={view.errors[view.errors.length - 1].detail} /> : null}
        <Transcript
          lines={lines}
          callerLabel="You (caller)"
          assistantLabel={profile.data?.assistant_name}
          showTranslation={showTranslation}
          ownerLanguage={owner}
          live={phase === 'live'}
          emptyText={phase === 'connecting' ? 'Connecting…' : 'Your assistant is picking up…'}
        />
        {hold && phase === 'live' ? <PracticeHold question={hold.question} onAnswer={(text) => guarded(() => call.current!.answer(text, hold.id))} /> : null}
      </ScrollView>
      {phase === 'live' ? (
        <Composer
          placeholder="Say something as the caller"
          hint={sending ? 'Sending…' : undefined}
          suggestions={lines.some((l) => l.speaker === 'caller') ? undefined : STARTERS[lang] ?? STARTERS['']}
          busy={sending}
          onSend={sendText}
          onVoice={sendVoice}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PracticeHold({ question, onAnswer }: { question: string; onAnswer: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  return (
    <Card tone="warning">
      <Text variant="overline" color="onWarningContainer">
        Your assistant is asking you
      </Text>
      <Text variant="headline" color="onWarningContainer">
        {question}
      </Text>
      <TextField label="Your answer" value={text} onChangeText={setText} returnKeyType="send" onSubmitEditing={() => void onAnswer(text).then(() => setText(''))} />
      <Button title="Send answer" icon="send" disabled={!text.trim()} onPress={() => void onAnswer(text).then(() => setText(''))} />
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
