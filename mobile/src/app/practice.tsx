import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { HoldQuestionCard } from '../components/domain/HoldQuestionCard';
import { LiveStatusBar } from '../components/domain/LiveStatusBar';
import { Transcript } from '../components/domain/Transcript';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Chip } from '../components/ui/Chip';
import { Composer } from '../components/ui/Composer';
import { HeaderRight } from '../components/ui/HeaderRight';
import { IconButton } from '../components/ui/IconButton';
import { ListRow } from '../components/ui/ListRow';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Text } from '../components/ui/Text';
import { errorMessage } from '../hooks/useAsyncAction';
import type { Recording } from '../hooks/useHoldToTalk';
import { useOutbox } from '../hooks/useOutbox';
import { useProfile } from '../hooks/useProfile';
import { useSentencePlayer } from '../hooks/useSentencePlayer';
import { Icon, type IconName } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { callView, openHold, reduceCall, type CallView, type ServerEvent } from '../lib/events';
import { duration } from '../lib/format';
import { languageName } from '../lib/languages';
import { liveQuickReplies } from '../lib/quickReplies';
import { scriptLanguage } from '../lib/script';
import { PRACTICE_NUMBER, PracticeCall, recordingBase64 } from '../lib/simulate';
import type { TranscriptLine } from '../lib/types';

const PRACTICE_LANGUAGES = [
  { value: '', label: 'Auto' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'te', label: 'Telugu' },
  { value: 'ta', label: 'Tamil' },
];

const STARTERS: Record<string, string[]> = {
  '': ['Hi, I have a Swiggy order for you. Where should I come?', 'Sir, please tell me the OTP for the delivery.'],
  en: [
    'Hi, I have a Swiggy order for you. Where should I come?',
    'Is he free for dinner on Saturday?',
    'Sir, please tell me the OTP for the delivery.',
  ],
  hi: ['नमस्ते, आपका पार्सल आया है। कहाँ आना है?', 'सर, डिलीवरी के लिए OTP बताइए।'],
  te: ['నమస్కారం, మీ పార్సెల్ వచ్చింది. మీ ఇల్లు ఎక్కడ?', 'సార్, డెలివరీ కోసం OTP చెప్పండి.'],
  ta: ['வணக்கம், உங்கள் பார்சல் வந்திருக்கு. உங்கள் வீடு எங்கே?', 'சார், டெலிவரிக்கு OTP சொல்லுங்க.'],
};

const IDEAS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'bicycle-outline', title: 'A delivery at your gate', detail: 'Ask where to come. It gives the way to your door.' },
  { icon: 'shield-checkmark-outline', title: 'Someone asks for an OTP', detail: 'It refuses, every time, and alerts you.' },
  { icon: 'chatbox-ellipses-outline', title: 'Leave a message', detail: 'It takes it down. Find it in Inbox, under Practice.' },
  { icon: 'hand-left-outline', title: 'Ask something only you know', detail: 'It puts you on hold and asks you here.' },
  { icon: 'language-outline', title: 'Speak Telugu, Hindi or Tamil', detail: 'Read every line in your language as it goes.' },
];

type Phase = 'idle' | 'connecting' | 'live' | 'ended';
type Role = 'caller' | 'owner';

const NO_LINES: TranscriptLine[] = [];

function practiceRecord(callId: string, lang: string) {
  return {
    id: callId,
    direction: 'inbound' as const,
    number: PRACTICE_NUMBER,
    contact_name: 'You, as the caller',
    category: 'unknown',
    status: 'active' as const,
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
  };
}

/** You play a caller; your assistant answers exactly as on a real call. It uses
 *  /ws/simulate on its own (no phone line, no events socket), and every message
 *  waits for the server's ack or error, so nothing is dropped silently. */
export default function Practice() {
  const t = useTokens();
  const profile = useProfile();
  const [lang, setLang] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [role, setRole] = useState<Role>('caller');
  const [view, setView] = useState<CallView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [showTranslation, setShowTranslation] = useState(true);
  const [ended, setEnded] = useState<{ seconds: number } | null>(null);
  const [dismissedError, setDismissedError] = useState(0);
  const call = useRef<PracticeCall | null>(null);
  const startedAt = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const audio = useSentencePlayer(setProblem);
  const lines = view?.record.transcript ?? NO_LINES;
  const outbox = useOutbox(lines);

  const p = profile.data;
  const owner = p?.owner_language ?? 'en';
  const assistant = p?.assistant_name ?? 'Your assistant';

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
    setEnded(null);
    setDismissedError(0);
    outbox.clear();
    audio.stop();
    setRole('caller');
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
            setEnded({ seconds: (Date.now() - startedAt.current) / 1000 });
            setView((v) => (v ? { ...v, status: 'idle' } : v));
            if (message) setProblem(message);
          },
        },
      );
      call.current = c;
      startedAt.current = Date.now();
      setView(callView(practiceRecord(c.callId, lang)));
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

  const active = () => {
    const c = call.current;
    if (!c) throw new Error('The practice call has ended. Start a new one.');
    return c;
  };

  const callerLang = view?.language || lang;
  const sendText = (text: string) =>
    role === 'caller'
      ? outbox.send({ speaker: 'caller', kind: 'text', text, lang: lang || scriptLanguage(text) || callerLang }, async () => {
          await active().sendText(text, lang || undefined);
        })
      : outbox.send({ speaker: 'user', kind: 'text', text, lang: owner }, async () => {
          await active().say(text, owner);
        });

  const sendVoice = (r: Recording) =>
    role === 'caller'
      ? outbox.send({ speaker: 'caller', kind: 'voice', text: '', lang: lang || callerLang, seconds: r.durationMs / 1000 }, async () => {
          const ack = await active().sendAudio(await recordingBase64(r.uri), lang || undefined);
          return { seconds: ack.seconds };
        })
      : outbox.send({ speaker: 'user', kind: 'voice', text: '', lang: owner, seconds: r.durationMs / 1000 }, async () => {
          await active().sayAudio(await recordingBase64(r.uri), owner);
        });

  if (phase === 'idle') {
    return (
      <Screen
        bottomInset
        testID="practice-intro"
        footer={<Button title="Start practice call" icon="call" size="lg" fullWidth onPress={() => void start()} />}
      >
        <Stack.Screen options={{ headerRight: undefined }} />
        <PracticeHero assistantName={assistant} />
        {problem ? <Banner tone="danger" title="Couldn't start the practice call" message={problem} onDismiss={() => setProblem(null)} /> : null}
        <Section title="The caller speaks" footer={lang ? `${assistant} expects ${languageName(lang)} and answers in it.` : `${assistant} works out the language from what you say.`}>
          <View style={[styles.chips, { padding: t.space.lg }]}>
            {PRACTICE_LANGUAGES.map((l) => (
              <Chip key={l.value || 'auto'} label={l.label} kind="filter" selected={lang === l.value} onPress={() => setLang(l.value)} />
            ))}
          </View>
        </Section>
        <Section title="Things to try">
          {IDEAS.map((i) => (
            <ListRow key={i.title} icon={i.icon} iconTone="primary" title={i.title} subtitle={i.detail} />
          ))}
        </Section>
      </Screen>
    );
  }

  const hold = view ? openHold(view.record) : null;
  const lastError = view && view.errors.length > dismissedError ? view.errors[view.errors.length - 1] : null;
  const callerSpoke = lines.some((l) => l.speaker === 'caller') || outbox.items.some((i) => i.speaker === 'caller');
  const other = callerLang && callerLang !== owner ? languageName(callerLang) : '';

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <HeaderRight>
              {phase === 'ended' ? (
                <Button title="Call again" size="sm" variant="tonal" icon="refresh" onPress={() => void start()} />
              ) : (
                <Button title="Hang up" size="sm" variant="destructive" icon="call" onPress={hangUp} />
              )}
            </HeaderRight>
          ),
        }}
      />
      <LiveStatusBar
        testID="practice-status"
        phase={phase === 'connecting' ? 'connecting' : phase === 'ended' ? 'ended' : 'live'}
        state={view?.status ?? 'listening'}
        detail={view?.statusDetail}
        onHold={view?.record.status === 'on_hold'}
        speaking={audio.speaking}
        assistantName={assistant}
        language={callerLang}
        confidence={view?.languageConfidence}
        ownerLanguage={owner}
        translate={showTranslation}
        onTranslateChange={setShowTranslation}
        trailing={
          <IconButton
            icon={audio.muted ? 'volume-mute-outline' : 'volume-high-outline'}
            label={audio.muted ? `Unmute ${assistant}` : `Mute ${assistant}`}
            selected={audio.muted}
            onPress={() => audio.setMuted(!audio.muted)}
          />
        }
      />
      {phase !== 'ended' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.langBar, { borderBottomColor: t.color.border }]} contentContainerStyle={styles.langRow}>
          <Text variant="caption" weight="semibold" color="text2">
            Caller speaks
          </Text>
          {PRACTICE_LANGUAGES.map((l) => (
            <Chip key={l.value || 'auto'} label={l.label} kind="filter" selected={lang === l.value} onPress={() => setLang(l.value)} />
          ))}
        </ScrollView>
      ) : null}
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xl }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {problem ? <Banner tone="warning" title="Problem with the practice call" message={problem} onDismiss={() => setProblem(null)} /> : null}
        {lastError ? (
          <Banner
            tone="warning"
            title={`${assistant} had trouble with that turn`}
            message={lastError.detail}
            onDismiss={() => setDismissedError(view?.errors.length ?? 0)}
          />
        ) : null}
        <Transcript
          lines={lines}
          callerLabel="You (caller)"
          assistantLabel={assistant}
          showTranslation={showTranslation}
          ownerLanguage={owner}
          live={phase === 'live'}
          pending={outbox.items}
          userLabel="You (owner)"
          onRetry={(id) => void outbox.retry(id)}
          onRemove={outbox.remove}
          state={view?.status}
          emptyText={phase === 'connecting' ? 'Calling your assistant…' : `${assistant} is picking up…`}
        />
        {hold && phase === 'live' ? (
          <HoldQuestionCard
            callId={view!.record.id}
            holdId={hold.id}
            who="You (caller)"
            question={hold.question}
            at={hold.asked_at}
            callerLanguage={callerLang}
            ownerLanguage={owner}
            assistantName={assistant}
            onAnswer={(text) => active().answer(text, hold.id)}
          />
        ) : null}
        {phase === 'ended' ? (
          <Card testID="practice-ended">
            <View style={styles.endHead}>
              <View style={[styles.endIcon, { backgroundColor: t.color.surface3 }]}>
                <Icon name="call-outline" size={18} color={t.color.text2} />
              </View>
              <View style={styles.flex}>
                <Text variant="headline">Practice call ended</Text>
                <Text variant="footnote" color="text2">
                  {ended ? duration(ended.seconds) : '0:00'} · {lines.length} {lines.length === 1 ? 'line' : 'lines'}
                  {callerLang ? ` · ${languageName(callerLang)}` : ''}
                </Text>
              </View>
            </View>
            <View style={styles.endActions}>
              <Button title="Done" variant="ghost" size="sm" onPress={() => router.back()} />
              <Button title="Call again" icon="refresh" size="sm" onPress={() => void start()} />
            </View>
          </Card>
        ) : null}
      </ScrollView>
      {phase === 'live' ? (
        <Composer
          testID="composer"
          header={
            <SegmentedControl<Role>
              accessibilityLabel="Speak as"
              value={role}
              onChange={setRole}
              segments={[
                { value: 'caller', label: 'As the caller' },
                { value: 'owner', label: 'As you, the owner' },
              ]}
            />
          }
          placeholder={role === 'caller' ? 'Say something as the caller' : `Reply in ${languageName(owner)}`}
          hint={
            role === 'owner'
              ? other
                ? `Reply in ${languageName(owner)}, I'll say it in ${other}.`
                : `Cut in as yourself; ${assistant} says it to the caller.`
              : lang
                ? `Type or hold the mic and speak ${languageName(lang)}.`
                : 'Type, or hold the mic and speak any language.'
          }
          suggestions={role === 'caller' ? (callerSpoke ? undefined : STARTERS[lang] ?? STARTERS['']) : liveQuickReplies('delivery')}
          busy={outbox.busy}
          onSend={sendText}
          onVoice={sendVoice}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PracticeHero({ assistantName }: { assistantName: string }) {
  const t = useTokens();
  const c = t.color;
  return (
    <LinearGradient colors={[c.heroFrom, c.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { borderRadius: t.radius.xl }]}>
      <View style={[styles.heroIcon, { backgroundColor: c.onHeroOverlay }]}>
        <Icon name="headset" size={26} color={c.onHero} />
      </View>
      <Text variant="title1" color={c.onHero}>
        Try {assistantName}, no phone line needed
      </Text>
      <Text variant="subhead" color={c.onHero2}>
        You play someone calling you. {assistantName} answers in its own voice, exactly as on a real call. Type, or hold the mic and speak.
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  hero: { padding: 20, gap: 10 },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  langBar: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  langRow: { gap: 8, paddingHorizontal: 16, paddingVertical: 8, alignItems: 'center' },
  endHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  endIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  endActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
