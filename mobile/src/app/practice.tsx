import { LinearGradient } from 'expo-linear-gradient';
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useConfirm } from '../components/ui/ConfirmSheet';
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
import { ownerTextLanguage, scriptLanguage } from '../lib/script';
import { PRACTICE_NUMBER, PracticeCall, recordingBase64, type PracticeTask } from '../lib/simulate';
import { TASK_KINDS } from '../lib/tasks';
import type { TaskKind, TranscriptLine } from '../lib/types';

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

// Practising Call for me: the owner answers as the place the assistant calls.
// The first starter answers the phone with the place's name, as a shop would.
function placeStarters(lang: string, place: string): string[] {
  switch (lang) {
    case 'hi':
      return [
        place ? `नमस्ते, ${place}। बताइए, क्या मदद करूँ?` : 'नमस्ते, बताइए, क्या मदद करूँ?',
        'माफ़ कीजिए, उस समय जगह नहीं है। रात 9 बजे चलेगा?',
        'ठीक है। किस नाम से बुक करूँ?',
      ];
    case 'te':
      return [
        place ? `నమస్కారం, ${place}. చెప్పండి, ఏం కావాలి?` : 'నమస్కారం, చెప్పండి, ఏం కావాలి?',
        'క్షమించండి, ఆ టైమ్ ఖాళీ లేదు. రాత్రి 9 గంటలకు సరిపోతుందా?',
        'సరే. ఏ పేరు మీద బుక్ చేయమంటారు?',
      ];
    case 'ta':
      return [
        place ? `வணக்கம், ${place}. சொல்லுங்க, என்ன வேணும்?` : 'வணக்கம், சொல்லுங்க, என்ன வேணும்?',
        'மன்னிக்கவும், அந்த நேரம் ஃபுல் ஆகிவிட்டது. இரவு 9 மணிக்கு சரியா?',
        'சரி. எந்தப் பெயரில் புக் பண்ணணும்?',
      ];
    default:
      return [
        place ? `Hello, ${place}. How can I help you?` : 'Hello, how can I help you?',
        "Sorry, that time is full. We have 9 PM, would that work?",
        'Sure. What name should I put it under?',
      ];
  }
}

const TASK_IDEAS: { icon: IconName; title: string; detail: string }[] = [
  { icon: 'call-outline', title: "Answer with the place's name", detail: 'Say hello as the place would. It tells you why it is calling.' },
  { icon: 'time-outline', title: 'Say that time is full', detail: 'Offer another one. Anything different, it asks you first, right here.' },
  { icon: 'person-outline', title: 'Ask for a name or number', detail: 'It gives your name, and never shares an OTP or bank details.' },
  { icon: 'checkmark-done-outline', title: 'Confirm, then hang up', detail: 'The result appears in Call for me, marked Practice.' },
];

/** Route params from Call for me ("Practise this call"); with a goal the
 *  assistant calls the owner, who plays the place. */
type PracticeParams = { goal?: string; kind?: string; target?: string; number?: string };
const KINDS: TaskKind[] = ['enquire', 'book', 'callback', 'custom'];

function taskFrom(params: PracticeParams): (PracticeTask & { number: string }) | null {
  const goal = (params.goal ?? '').trim();
  if (!goal) return null;
  const kind = KINDS.includes(params.kind as TaskKind) ? (params.kind as TaskKind) : 'enquire';
  return { goal, kind, target_name: (params.target ?? '').trim(), number: (params.number ?? '').trim() || PRACTICE_NUMBER };
}

type Phase = 'idle' | 'connecting' | 'live' | 'ending' | 'ended';

/** After a hang-up the server sends the summary and closes; past this, stop waiting. */
const ENDING_TIMEOUT_MS = 30000;
type Role = 'caller' | 'owner';

const NO_LINES: TranscriptLine[] = [];

function practiceRecord(callId: string, lang: string, task: { number: string; target_name?: string; id: string | null } | null) {
  return {
    id: callId,
    // Practising Call for me, the assistant is the one calling.
    direction: task ? ('outbound' as const) : ('inbound' as const),
    number: task ? task.number : PRACTICE_NUMBER,
    contact_name: task ? task.target_name || 'The place' : 'You, as the caller',
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
    task_id: task?.id ?? null,
    reject_reason: '',
    urgent: false,
    action_items: [],
  };
}

/** You play a caller; your assistant answers exactly as on a real call. Opened
 *  from Call for me with a goal, it is the other way round: your assistant calls
 *  you, and you play the place. It uses /ws/simulate on its own (no phone line,
 *  no events socket), and every message waits for the server's ack or error, so
 *  nothing is dropped silently. */
export default function Practice() {
  const t = useTokens();
  const profile = useProfile();
  const params = useLocalSearchParams<PracticeParams>();
  const { goal, kind, target, number } = params;
  const task = useMemo(() => taskFrom({ goal, kind, target, number }), [goal, kind, target, number]);
  const place = task?.target_name || 'the place';
  const [lang, setLang] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [role, setRole] = useState<Role>('caller');
  const [view, setView] = useState<CallView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Until the owner flips it here, translation follows the profile, as on a real call.
  const [translateChoice, setTranslateChoice] = useState<boolean | null>(null);
  const [ended, setEnded] = useState<{ seconds: number } | null>(null);
  const [dismissedError, setDismissedError] = useState(0);
  const call = useRef<PracticeCall | null>(null);
  // The start in progress, so leaving or hanging up while it connects cancels it.
  const starting = useRef<AbortController | null>(null);
  const endingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startedAt = useRef(0);
  const scroll = useRef<ScrollView>(null);
  const audio = useSentencePlayer(setProblem);
  const lines = view?.record.transcript ?? NO_LINES;
  // A recording the server heard no words in gets a turn error, not a line: it fails, with Retry.
  const outbox = useOutbox(lines, view ? { count: view.turnErrors, detail: view.errors.at(-1)?.detail ?? '' } : null);

  const p = profile.data;
  const owner = p?.owner_language ?? 'en';
  const assistant = p?.assistant_name ?? 'Your assistant';
  const translateLive = p?.translate_live ?? true;
  const showTranslation = translateChoice ?? translateLive;

  // Leaving while the call is on (back button, gesture or header) asks first,
  // so a stray back gesture doesn't hang up.
  const navigation = useNavigation();
  const confirm = useConfirm();
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (e) => {
        if (phaseRef.current !== 'live' && phaseRef.current !== 'connecting') return;
        e.preventDefault();
        void confirm({
          title: 'End the practice call?',
          message: 'Leaving this screen hangs up.',
          confirmLabel: 'End call',
          cancelLabel: 'Stay',
          destructive: true,
        }).then((leave) => {
          if (leave) navigation.dispatch(e.data.action);
        });
      }),
    [navigation, confirm],
  );

  const onEvent = useCallback((ev: ServerEvent) => {
    setView((v) => (v ? reduceCall(v, ev) : v));
  }, []);

  useEffect(
    () => () => {
      starting.current?.abort();
      clearTimeout(endingTimer.current);
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
    const attempt = new AbortController();
    starting.current = attempt;
    try {
      await audio.prepare().catch((e: unknown) => console.warn('Audio mode not set', e));
      const c = await PracticeCall.start(
        task ? { lang, number: task.number, task } : { lang },
        {
          onEvent,
          onAudio: audio.push,
          onClose: ({ message }) => {
            clearTimeout(endingTimer.current);
            setPhase('ended');
            setEnded({ seconds: (Date.now() - startedAt.current) / 1000 });
            setView((v) => (v ? { ...v, status: 'idle' } : v));
            if (message) setProblem(message);
          },
        },
        attempt.signal,
      );
      starting.current = null;
      if (attempt.signal.aborted) {
        c.hangup();
        return;
      }
      call.current = c;
      startedAt.current = Date.now();
      setView(callView(practiceRecord(c.callId, lang, task ? { ...task, id: c.taskId } : null)));
      setPhase('live');
    } catch (e) {
      starting.current = null;
      // Hung up or left while connecting: nothing to report.
      if (attempt.signal.aborted) return;
      setPhase('idle');
      setProblem(errorMessage(e));
    }
  };

  const hangUp = () => {
    audio.stop();
    if (phase === 'connecting') {
      starting.current?.abort();
      setPhase('idle');
      return;
    }
    if (!call.current || phase !== 'live') return;
    // The server closes the call only after its summary: show the end at once.
    setPhase('ending');
    const ending = call.current;
    ending.hangup();
    clearTimeout(endingTimer.current);
    endingTimer.current = setTimeout(() => {
      if (call.current === ending && phaseRef.current === 'ending') ending.close();
    }, ENDING_TIMEOUT_MS);
  };

  const active = () => {
    const c = call.current;
    if (!c) throw new Error('The practice call has ended. Start a new one.');
    return c;
  };

  const callerLang = view?.language || lang;
  // As the owner, typed words go without a language so the server reads it from
  // the script, and the built-in quick replies are English (see the call screen).
  const sendText = (text: string, ownerLang?: string) =>
    role === 'caller'
      ? outbox.send({ speaker: 'caller', kind: 'text', text, lang: lang || scriptLanguage(text) || callerLang }, async () => {
          await active().sendText(text, lang || undefined);
        })
      : outbox.send({ speaker: 'user', kind: 'text', text, lang: ownerLang ?? ownerTextLanguage(text, owner) }, async () => {
          await active().say(text, ownerLang);
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
        <Stack.Screen options={{ headerRight: undefined, ...(task ? { title: 'Practise Call for me' } : {}) }} />
        {task ? (
          <PracticeHero
            title={`You play ${place}`}
            text={`${assistant} calls you, exactly as it would call ${place} for real. Answer as ${place} would, by typing or holding the mic and speaking.`}
          />
        ) : (
          <PracticeHero
            title={`Try ${assistant}, no phone line needed`}
            text={`You play someone calling you. ${assistant} answers in its own voice, exactly as on a real call. Type, or hold the mic and speak.`}
          />
        )}
        {problem ? <Banner tone="danger" title="Couldn't start the practice call" message={problem} onDismiss={() => setProblem(null)} /> : null}
        {task ? (
          <Section title={`${assistant} is calling to`} footer={TASK_KINDS.find((k) => k.value === task.kind)?.explain} testID="practice-goal">
            <View style={{ padding: t.space.lg }}>
              <Text variant="body">{task.goal}</Text>
            </View>
          </Section>
        ) : null}
        <Section
          title={task ? 'The place speaks' : 'The caller speaks'}
          footer={lang ? `${assistant} expects ${languageName(lang)} and answers in it.` : `${assistant} works out the language from what you say.`}
        >
          <View style={[styles.chips, { padding: t.space.lg }]}>
            {PRACTICE_LANGUAGES.map((l) => (
              <Chip key={l.value || 'auto'} label={l.label} kind="filter" selected={lang === l.value} onPress={() => setLang(l.value)} />
            ))}
          </View>
        </Section>
        <Section title="Things to try">
          {(task ? TASK_IDEAS : IDEAS).map((i) => (
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
          ...(task ? { title: 'Practise Call for me' } : {}),
          headerRight: () => (
            <HeaderRight>
              {phase === 'ended' ? (
                <Button title="Call again" size="sm" variant="tonal" icon="refresh" onPress={() => void start()} />
              ) : phase === 'ending' ? (
                <Button title="Ending…" size="sm" variant="destructive" icon="call" loading />
              ) : (
                <Button title="Hang up" size="sm" variant="destructive" icon="call" onPress={hangUp} />
              )}
            </HeaderRight>
          ),
        }}
      />
      <LiveStatusBar
        testID="practice-status"
        phase={phase}
        state={view?.status ?? 'listening'}
        detail={view?.statusDetail}
        onHold={view?.record.status === 'on_hold'}
        speaking={audio.speaking}
        assistantName={assistant}
        language={callerLang}
        confidence={view?.languageConfidence}
        ownerLanguage={owner}
        translate={showTranslation}
        onTranslateChange={setTranslateChoice}
        trailing={
          <IconButton
            icon={audio.muted ? 'volume-mute-outline' : 'volume-high-outline'}
            label={audio.muted ? `Unmute ${assistant}` : `Mute ${assistant}`}
            selected={audio.muted}
            onPress={() => audio.setMuted(!audio.muted)}
          />
        }
      />
      {phase === 'connecting' || phase === 'live' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.langBar, { borderBottomColor: t.color.border }]} contentContainerStyle={styles.langRow}>
          <Text variant="caption" weight="semibold" color="text2">
            {task ? 'Place speaks' : 'Caller speaks'}
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
          callerLabel={task ? `You (${place})` : 'You (caller)'}
          assistantLabel={assistant}
          showTranslation={showTranslation}
          ownerLanguage={owner}
          live={phase === 'live'}
          translating={translateLive}
          pending={outbox.items}
          userLabel="You (owner)"
          onRetry={(id) => void outbox.retry(id)}
          onRemove={outbox.remove}
          state={view?.status}
          emptyText={
            task
              ? phase === 'connecting'
                ? `${assistant} is calling you…`
                : `Answer as ${place}: say hello, or wait for ${assistant} to speak.`
              : phase === 'connecting'
                ? 'Calling your assistant…'
                : `${assistant} is picking up…`
          }
        />
        {hold && phase === 'live' ? (
          <HoldQuestionCard
            callId={view!.record.id}
            holdId={hold.id}
            who={task ? `You (${place})` : 'You (caller)'}
            question={hold.question}
            at={hold.asked_at}
            isTask={!!task}
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
            {task ? (
              <Text variant="footnote" color="text2">
                What {assistant} found out is in Call for me, marked Practice.
              </Text>
            ) : null}
            <View style={styles.endActions}>
              <Button title="Done" variant="ghost" size="sm" onPress={() => router.back()} />
              <Button title="Call again" icon="refresh" size="sm" onPress={() => void start()} />
            </View>
          </Card>
        ) : null}
      </ScrollView>
      {phase === 'live' || phase === 'ending' ? (
        <Composer
          testID="composer"
          disabled={phase === 'ending'}
          disabledReason="Ending the call…"
          header={
            <SegmentedControl<Role>
              accessibilityLabel="Speak as"
              value={role}
              onChange={setRole}
              segments={[
                { value: 'caller', label: task ? 'As the place' : 'As the caller' },
                { value: 'owner', label: 'As you, the owner' },
              ]}
            />
          }
          placeholder={role === 'caller' ? (task ? `Answer as ${place}` : 'Say something as the caller') : `Reply in ${languageName(owner)}`}
          hint={
            role === 'owner'
              ? other
                ? `Reply in ${languageName(owner)}, I'll say it in ${other}.`
                : `Cut in as yourself; ${assistant} says it to ${task ? place : 'the caller'}.`
              : lang
                ? `Type or hold the mic and speak ${languageName(lang)}.`
                : 'Type, or hold the mic and speak any language.'
          }
          suggestions={
            role === 'caller'
              ? task
                ? // Answering the phone is for the start; the rest fit any time.
                  placeStarters(lang, task.target_name ?? '').slice(callerSpoke ? 1 : 0)
                : callerSpoke
                  ? undefined
                  : STARTERS[lang] ?? STARTERS['']
              : liveQuickReplies(task ? 'business' : 'delivery')
          }
          busy={outbox.busy}
          onSend={(text) => sendText(text)}
          onSuggestion={(text) => sendText(text, role === 'owner' ? 'en' : undefined)}
          onVoice={sendVoice}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

function PracticeHero({ title, text }: { title: string; text: string }) {
  const t = useTokens();
  const c = t.color;
  return (
    <LinearGradient colors={[c.heroFrom, c.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { borderRadius: t.radius.xl }]}>
      <View style={[styles.heroIcon, { backgroundColor: c.onHeroOverlay }]}>
        <Icon name="headset" size={26} color={c.onHero} />
      </View>
      <Text variant="title1" color={c.onHero}>
        {title}
      </Text>
      <Text variant="subhead" color={c.onHero2}>
        {text}
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
