import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { ActionTiles, type ActionTile } from '../../components/domain/ActionTiles';
import { HoldQuestionCard } from '../../components/domain/HoldQuestionCard';
import { LiveStatusBar } from '../../components/domain/LiveStatusBar';
import { Transcript } from '../../components/domain/Transcript';
import { AudioPlayer } from '../../components/ui/AudioPlayer';
import { Avatar } from '../../components/ui/Avatar';
import { Banner } from '../../components/ui/Banner';
import { Card } from '../../components/ui/Card';
import { Composer } from '../../components/ui/Composer';
import { useConfirm } from '../../components/ui/ConfirmSheet';
import { HeaderRight } from '../../components/ui/HeaderRight';
import { IconButton } from '../../components/ui/IconButton';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';
import { Switch } from '../../components/ui/Switch';
import { Text } from '../../components/ui/Text';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../../hooks/useAsyncAction';
import type { Recording } from '../../hooks/useHoldToTalk';
import { useOutbox } from '../../hooks/useOutbox';
import { useProfile, type ProfileResource } from '../../hooks/useProfile';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import type { CallView } from '../../lib/events';
import { clockTime, duration, prettyNumber, timeAgo } from '../../lib/format';
import { callerName, categoryOf } from '../../lib/labels';
import { languageName } from '../../lib/languages';
import { useLive } from '../../lib/live';
import { isPracticeCall } from '../../lib/practiceCalls';
import { liveQuickReplies } from '../../lib/quickReplies';
import type { CallRecord } from '../../lib/types';

/** One call: live (status, transcript with translation, reply in your own
 *  language) or finished (summary, actions, recording, transcript). */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTokens();
  const live = useLive();
  const view = live.calls[id];
  const stored = useResource(() => api.call(id), `${id}-${!!view}`, !view);
  const profile = useProfile();
  const [showTranslation, setShowTranslation] = useState<boolean | null>(null);
  // Seen live on this screen: when it ends here, say so.
  const [seenLive, setSeenLive] = useState(false);
  if (view && !seenLive) setSeenLive(true);

  const call: CallRecord | undefined = view?.record ?? stored.data;
  const translate = showTranslation ?? profile.data?.translate_live ?? true;

  if (!call) {
    return (
      <View style={[styles.flex, { backgroundColor: t.color.bg, padding: t.space.lg }]}>
        <Stack.Screen options={{ title: '' }} />
        {stored.error ? (
          <Banner tone="danger" title="Couldn't load this call" message={stored.error} action={{ label: 'Retry', onPress: () => void stored.reload() }} />
        ) : (
          <SkeletonRows rows={5} />
        )}
      </View>
    );
  }

  return view ? (
    <LiveCall view={view} profile={profile} translate={translate} onTranslate={setShowTranslation} />
  ) : (
    <FinishedCall
      call={call}
      profile={profile}
      translate={translate}
      onTranslate={setShowTranslation}
      justEnded={seenLive}
      refreshing={stored.refreshing}
      onRefresh={() => void stored.refresh()}
    />
  );
}

// ---------------------------------------------------------------- live

function LiveCall({
  view,
  profile,
  translate,
  onTranslate,
}: {
  view: CallView;
  profile: ProfileResource;
  translate: boolean;
  onTranslate: (on: boolean) => void;
}) {
  const t = useTokens();
  const live = useLive();
  const call = view.record;
  const id = call.id;
  const who = callerName(call);
  const p = profile.data;
  const owner = p?.owner_language ?? 'en';
  const assistant = p?.assistant_name ?? 'Your assistant';
  const callerLang = view.language || call.language;
  const question = live.questions.find((q) => q.callId === id);
  const outbox = useOutbox(call.transcript);
  const scroll = useRef<ScrollView>(null);
  const [dismissedError, setDismissedError] = useState(0);
  const lastError = view.errors.length > dismissedError ? view.errors[view.errors.length - 1] : null;

  const say = (text: string) =>
    outbox.send({ speaker: 'user', kind: 'text', text, lang: owner }, async () => {
      await api.say(id, text, owner);
    });
  const sayAudio = (r: Recording) =>
    outbox.send({ speaker: 'user', kind: 'voice', text: '', lang: owner, seconds: r.durationMs / 1000 }, async () => {
      const res = await api.sayAudio(id, r.uri, owner);
      return { text: res.heard };
    });
  const answer = (text: string) =>
    outbox.send({ speaker: 'user', kind: 'text', text, lang: owner }, async () => {
      await api.answer(id, text, question?.holdId);
    });

  const other = callerLang && callerLang !== owner ? languageName(callerLang) : '';
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <Stack.Screen
        options={{
          title: who,
          headerRight: () => (
            <HeaderRight>
              <EndCallButton callId={id} who={who} />
            </HeaderRight>
          ),
        }}
      />
      <LiveStatusBar
        testID="live-status"
        state={view.status}
        detail={view.statusDetail}
        onHold={call.status === 'on_hold'}
        assistantName={assistant}
        language={callerLang}
        confidence={view.languageConfidence}
        ownerLanguage={owner}
        translate={translate}
        onTranslateChange={onTranslate}
      />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.xl }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <CallIntro call={call} compact />
        {!live.connected || view.stale ? (
          <Banner
            tone="warning"
            icon="cloud-offline-outline"
            title="Reconnecting to your server"
            message="The transcript catches up when it's back. Replies you send still go through."
            testID="reconnecting"
          />
        ) : null}
        {lastError ? (
          <Banner
            tone="warning"
            title={`${assistant} had trouble with a turn`}
            message={`${lastError.detail} It carries on with the call.`}
            onDismiss={() => setDismissedError(view.errors.length)}
          />
        ) : null}
        <Transcript
          lines={call.transcript}
          callerLabel={who}
          assistantLabel={assistant}
          showTranslation={translate}
          ownerLanguage={owner}
          live
          pending={outbox.items}
          onRetry={(oid) => void outbox.retry(oid)}
          onRemove={outbox.remove}
          state={view.status}
        />
        {question ? (
          <HoldQuestionCard
            callId={id}
            holdId={question.holdId}
            who={who}
            question={question.question}
            at={question.at}
            isTask={question.isTask}
            callerLanguage={callerLang}
            ownerLanguage={owner}
            assistantName={assistant}
            inlineInput={false}
          />
        ) : null}
      </ScrollView>
      {question ? (
        <Composer
          testID="composer"
          context={{ icon: 'hand-left-outline', label: `Answering ${who}`, text: question.question }}
          placeholder={`Your answer, in ${languageName(owner)}`}
          hint={other ? `${assistant} tells them in ${other}.` : `${assistant} tells them right away.`}
          busy={outbox.busy}
          onSend={answer}
        />
      ) : (
        <Composer
          testID="composer"
          placeholder={`Reply in ${languageName(owner)}`}
          hint={
            other
              ? `Reply in ${languageName(owner)}, I'll say it in ${other}.`
              : `Type or hold the mic. ${assistant} says it to them right away.`
          }
          suggestions={liveQuickReplies(call.category)}
          busy={outbox.busy}
          onSend={say}
          onVoice={sayAudio}
        />
      )}
    </KeyboardAvoidingView>
  );
}

function EndCallButton({ callId, who }: { callId: string; who: string }) {
  const confirm = useConfirm();
  const end = useAsyncAction(() => api.endCall(callId), { success: 'Wrapping up the call.' });
  return (
    <IconButton
      icon="call"
      label="End the call"
      variant="danger"
      loading={end.busy}
      onPress={() =>
        void confirm({
          title: `End the call with ${who}?`,
          message: 'Your assistant says goodbye politely and hangs up.',
          confirmLabel: 'End call',
          destructive: true,
        }).then((ok) => {
          if (ok) void end.run();
        })
      }
    />
  );
}

// ---------------------------------------------------------------- shared

function CallIntro({ call, compact }: { call: CallRecord; compact?: boolean }) {
  const cat = categoryOf(call.category);
  const blocked = call.status === 'rejected';
  const length = call.ended_at && !blocked ? duration(call.ended_at - call.started_at) : '';
  const when = compact ? `Started ${timeAgo(call.started_at)}` : clockTime(call.started_at);
  return (
    <View style={styles.intro}>
      <Avatar
        name={call.contact_name || call.number}
        size={compact ? 44 : 64}
        icon={call.category === 'delivery' ? 'bicycle' : blocked ? 'ban' : undefined}
      />
      <View style={styles.flex}>
        {!compact ? (
          <Text variant="title2" numberOfLines={1}>
            {callerName(call)}
          </Text>
        ) : null}
        <Text variant="footnote" color="text2">
          {call.contact_name ? `${prettyNumber(call.number)} · ` : ''}
          {call.direction === 'outbound' ? 'Called for you' : blocked ? 'Blocked' : 'Incoming'} · {when}
          {length ? ` · ${length}` : ''}
        </Text>
        <View style={styles.pills}>
          {isPracticeCall(call) ? (
            <StatusPill label="Practice" tone="neutral" icon="headset-outline" />
          ) : (
            <StatusPill label={blocked ? 'Blocked' : cat.label} tone={blocked ? 'danger' : cat.tone} icon={blocked ? 'ban-outline' : cat.icon} />
          )}
          {call.language ? <StatusPill label={languageName(call.language)} tone="info" icon="language-outline" /> : null}
          {call.urgent ? <StatusPill label="Urgent" tone="danger" icon="alert-circle-outline" /> : null}
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- finished

function FinishedCall({
  call,
  profile,
  translate,
  onTranslate,
  justEnded,
  refreshing,
  onRefresh,
}: {
  call: CallRecord;
  profile: ProfileResource;
  translate: boolean;
  onTranslate: (on: boolean) => void;
  justEnded: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTokens();
  const p = profile.data;
  const owner = p?.owner_language ?? 'en';
  const needsTranslation = call.transcript.some((l) => l.lang && l.lang !== owner && l.translation);
  const recording = call.recording ? api.recordingSource(call.id) : null;
  return (
    <ScrollView
      style={{ backgroundColor: t.color.bg }}
      contentContainerStyle={{ padding: t.space.lg, gap: t.space.xl, paddingBottom: t.space.x4 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[t.color.primary]}
          tintColor={t.color.primary}
          progressBackgroundColor={t.color.surface2}
        />
      }
      testID="call-finished"
    >
      <Stack.Screen options={{ title: '', headerRight: undefined }} />
      {justEnded ? (
        <Banner tone="info" icon="call-outline" title="The call has ended" message="Here is what happened. Pull down to refresh the summary." />
      ) : null}
      <CallIntro call={call} />
      <SummaryCard call={call} />
      {call.number && !isPracticeCall(call) ? <CallActions call={call} profile={profile} /> : null}
      {recording ? (
        <AudioPlayer source={recording} title="Call recording" knownDuration={call.ended_at ? call.ended_at - call.started_at : null} testID="recording" />
      ) : null}
      {call.transcript.length ? (
        <View style={{ gap: t.space.md }}>
          <View style={styles.transcriptHead}>
            <Text variant="overline" color="text2" style={styles.flex}>
              Transcript
            </Text>
            {needsTranslation ? (
              <View style={styles.toggle}>
                <Text variant="footnote" color="text2">
                  Show in {languageName(owner)}
                </Text>
                <Switch value={translate} onValueChange={onTranslate} accessibilityLabel={`Show the call in ${languageName(owner)}`} />
              </View>
            ) : null}
          </View>
          <Transcript
            lines={call.transcript}
            callerLabel={callerName(call)}
            assistantLabel={p?.assistant_name}
            showTranslation={translate}
            ownerLanguage={owner}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

function SummaryCard({ call }: { call: CallRecord }) {
  const t = useTokens();
  const c = t.color;
  const blocked = call.status === 'rejected';
  if (!call.summary && !call.message && !call.action_items.length && !blocked) return null;
  return (
    <Card testID="summary">
      <View style={styles.cardHead}>
        <Icon name={blocked ? 'shield-checkmark' : 'sparkles'} size={16} color={blocked ? c.danger : c.primary} />
        <Text variant="overline" color="text2" style={styles.flex}>
          {blocked ? 'Blocked' : 'Summary'}
        </Text>
        <Text variant="caption" color="text2">
          {timeAgo(call.started_at)}
        </Text>
      </View>
      {call.summary ? <Text variant="body">{call.summary}</Text> : null}
      {blocked && call.reject_reason ? (
        <Text variant="subhead" color="text2">
          Why: {call.reject_reason}
        </Text>
      ) : null}
      {call.message && call.message !== call.summary ? (
        <View style={[styles.quote, { borderLeftColor: c.primary, backgroundColor: c.surface2, borderRadius: t.radius.sm }]}>
          <Text variant="caption" weight="semibold" color="text2">
            Message for you
          </Text>
          <Text variant="callout">"{call.message}"</Text>
        </View>
      ) : null}
      {call.action_items.length ? (
        <View style={styles.items}>
          <Text variant="caption" weight="semibold" color="text2">
            To do
          </Text>
          {call.action_items.map((a) => (
            <View key={a} style={styles.item}>
              <Icon name="ellipse-outline" size={16} color={c.primary} style={styles.itemIcon} />
              <Text variant="callout" style={styles.flex}>
                {a}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function CallActions({ call, profile }: { call: CallRecord; profile: ProfileResource }) {
  const toast = useToast();
  const confirm = useConfirm();
  const p = profile.data;
  const name = callerName(call);
  const blocked = !!p?.blocked_numbers.includes(call.number);
  const vip = !!p?.vip_numbers.includes(call.number);
  const digits = call.number.replace(/\D/g, '');

  const open = async (url: string, what: string) => {
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.warn(`Couldn't open ${what}`, e);
      toast.error(`Couldn't open ${what} on this phone.`);
    }
  };

  const block = useAsyncAction(async () => {
    if (blocked) {
      const saved = await api.unblockNumber(call.number);
      toast.success(`${name} is unblocked.`);
      return saved;
    }
    const ok = await confirm({
      title: `Block ${name}?`,
      message: 'Their calls will be rejected without ringing. You can unblock them later.',
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return null;
    const saved = await api.blockNumber(call.number);
    toast.undo(`${name} is blocked.`, () => {
      api.unblockNumber(call.number).then(
        (pp) => profile.mutate(() => pp),
        (e: unknown) => toast.error(`Couldn't unblock: ${errorMessage(e)}`),
      );
    });
    return saved;
  });

  const vipAction = useAsyncAction(async () => {
    if (!p) return;
    const next = vip ? p.vip_numbers.filter((n) => n !== call.number) : [...p.vip_numbers, call.number];
    await profile.patch({ vip_numbers: next }, vip ? `${name} is no longer a VIP.` : `${name} is a VIP: their calls alert you as urgent.`);
  });

  const share = async () => {
    const text = [
      `${name} · ${new Date(call.started_at * 1000).toLocaleString()}`,
      call.summary,
      '',
      ...call.transcript.map(
        (l) =>
          `${l.speaker === 'caller' ? name : l.speaker === 'user' ? 'You' : 'Assistant'}: ${l.text}${
            l.translation && l.translation !== l.text ? ` (${l.translation})` : ''
          }`,
      ),
    ].join('\n');
    try {
      await Share.share({ message: text });
    } catch (e) {
      console.warn('Share failed', e);
      toast.error("Couldn't open sharing.");
    }
  };

  const actions: ActionTile[] = [
    { icon: 'call', label: 'Call back', accessibilityLabel: `Call back ${name}`, onPress: () => void open(`tel:${call.number}`, 'the dialler') },
    { icon: 'logo-whatsapp', label: 'WhatsApp', tone: 'success', onPress: () => void open(`https://wa.me/${digits}`, 'WhatsApp') },
    {
      icon: vip ? 'star' : 'star-outline',
      label: vip ? 'VIP' : 'Save as VIP',
      accessibilityLabel: vip ? `VIP: remove ${name} from VIPs` : `Save as VIP: ${name}`,
      tone: 'warning',
      active: vip,
      loading: vipAction.busy,
      disabled: !p,
      onPress: () => void vipAction.run(),
    },
    {
      icon: 'ban',
      label: blocked ? 'Unblock' : 'Block',
      accessibilityLabel: blocked ? `Unblock ${name}` : `Block ${name}`,
      tone: 'danger',
      active: blocked,
      loading: block.busy,
      disabled: !p,
      onPress: () => void block.run().then((pp) => pp && profile.mutate(() => pp)),
    },
    { icon: 'share-outline', label: 'Share', accessibilityLabel: 'Share the transcript', onPress: () => void share() },
  ];
  return <ActionTiles actions={actions} testID="call-actions" />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  transcriptHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quote: { borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  items: { gap: 6, marginTop: 2 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  itemIcon: { marginTop: 3 },
});
