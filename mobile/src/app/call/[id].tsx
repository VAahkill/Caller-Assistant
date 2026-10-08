import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, ScrollView, Share, StyleSheet, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';

import { HoldQuestionCard, QUICK_ANSWERS } from '../../components/domain/HoldQuestionCard';
import { Transcript } from '../../components/domain/Transcript';
import { AudioPlayer } from '../../components/ui/AudioPlayer';
import { Avatar } from '../../components/ui/Avatar';
import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Composer } from '../../components/ui/Composer';
import { useConfirm } from '../../components/ui/ConfirmSheet';
import { IconButton } from '../../components/ui/IconButton';
import { SkeletonRows } from '../../components/ui/Skeleton';
import { StatusPill } from '../../components/ui/StatusPill';
import { Switch } from '../../components/ui/Switch';
import { Text } from '../../components/ui/Text';
import { useToast } from '../../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../../hooks/useAsyncAction';
import type { Recording } from '../../hooks/useHoldToTalk';
import { useProfile, type ProfileResource } from '../../hooks/useProfile';
import { useResource } from '../../hooks/useResource';
import { api } from '../../lib/api';
import { Icon } from '../../lib/design';
import { useTokens } from '../../lib/design/theme';
import { ASSISTANT_STATE_LABEL } from '../../lib/events';
import { clockTime, duration, prettyNumber, timeAgo } from '../../lib/format';
import { callerName, categoryOf } from '../../lib/labels';
import { languageName } from '../../lib/languages';
import { useLive } from '../../lib/live';
import type { CallRecord } from '../../lib/types';

/** One call: live (transcript, translation, status, reply in your language)
 *  or finished (summary, actions, recording, transcript). */
export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTokens();
  const live = useLive();
  const view = live.calls[id];
  const stored = useResource(() => api.call(id), `${id}-${!!view}`, !view);
  const profile = useProfile();
  const [showTranslation, setShowTranslation] = useState<boolean | null>(null);
  const scroll = useRef<ScrollView>(null);

  const call: CallRecord | undefined = view?.record ?? stored.data;
  const owner = profile.data?.owner_language ?? 'en';
  const translate = showTranslation ?? profile.data?.translate_live ?? true;
  const isLive = !!view;

  if (!call) {
    return (
      <View style={[styles.flex, { backgroundColor: t.color.bg, padding: t.space.lg }]}>
        <Stack.Screen options={{ title: 'Call' }} />
        {stored.error ? (
          <Banner tone="danger" title="Couldn't load this call" message={stored.error} action={{ label: 'Retry', onPress: () => void stored.reload() }} />
        ) : (
          <SkeletonRows rows={5} />
        )}
      </View>
    );
  }

  const who = callerName(call);
  const callerLang = view?.language || call.language;
  const question = live.questions.find((q) => q.callId === id);
  const needsTranslation = callerLang && callerLang !== owner;

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.flex, { backgroundColor: t.color.bg }]}>
      <Stack.Screen options={{ title: call.contact_name || prettyNumber(call.number) || 'Unknown caller', headerRight: isLive ? () => <EndCallButton callId={id} who={who} /> : undefined }} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ padding: t.space.lg, gap: t.space.lg, paddingBottom: t.space.x3 }}
        onContentSizeChange={() => isLive && scroll.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        <CallHeader call={call} live={isLive} language={callerLang} status={view ? ASSISTANT_STATE_LABEL[view.status] : null} />

        {!isLive ? <Summary call={call} profile={profile} /> : null}

        {view?.errors.length ? (
          <Banner tone="warning" title="The assistant had trouble with a turn" message={view.errors[view.errors.length - 1].detail} />
        ) : null}

        <View style={styles.transcriptHead}>
          <Text variant="overline" color="text2" style={styles.flex}>
            Transcript
          </Text>
          {needsTranslation ? (
            <View style={styles.toggle}>
              <Text variant="footnote" color="text2">
                Show in {languageName(owner)}
              </Text>
              <Switch value={translate} onValueChange={setShowTranslation} accessibilityLabel={`Show the call in ${languageName(owner)}`} />
            </View>
          ) : null}
        </View>
        <Transcript
          lines={call.transcript}
          callerLabel={who}
          assistantLabel={profile.data?.assistant_name}
          showTranslation={translate}
          ownerLanguage={owner}
          live={isLive}
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
          />
        ) : null}
      </ScrollView>
      {isLive && !question ? <LiveComposer callId={id} owner={owner} callerLang={callerLang} /> : null}
    </KeyboardAvoidingView>
  );
}

function CallHeader({ call, live, language, status }: { call: CallRecord; live: boolean; language: string; status: string | null }) {
  const cat = categoryOf(call.category);
  const length = call.ended_at ? duration(call.ended_at - call.started_at) : '';
  return (
    <View style={styles.header}>
      <Avatar name={call.contact_name || call.number} size={56} icon={call.category === 'delivery' ? 'bicycle' : undefined} />
      <View style={styles.flex}>
        <Text variant="title2" numberOfLines={1}>
          {callerName(call)}
        </Text>
        <Text variant="footnote" color="text2">
          {call.contact_name ? `${prettyNumber(call.number)} · ` : ''}
          {call.direction === 'outbound' ? 'Called for you' : 'Incoming'} · {clockTime(call.started_at)}
          {length ? ` · ${length}` : ''}
        </Text>
        <View style={styles.pills}>
          {live ? (
            <StatusPill label={call.status === 'on_hold' ? 'On hold' : status ?? 'Live'} tone={call.status === 'on_hold' ? 'warning' : 'success'} dot pulse />
          ) : null}
          <StatusPill label={cat.label} tone={cat.tone} icon={cat.icon} />
          {language ? <StatusPill label={languageName(language)} tone="info" icon="language-outline" /> : null}
          {call.urgent ? <StatusPill label="Urgent" tone="danger" icon="alert-circle-outline" /> : null}
        </View>
      </View>
    </View>
  );
}

function Summary({ call, profile }: { call: CallRecord; profile: ProfileResource }) {
  const t = useTokens();
  const toast = useToast();
  const confirm = useConfirm();
  const p = profile.data;
  const blocked = !!p?.blocked_numbers.includes(call.number);
  const vip = !!p?.vip_numbers.includes(call.number);
  const recording = call.recording ? api.recordingSource(call.id) : null;

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
      profile.mutate(() => p && { ...p, blocked_numbers: p.blocked_numbers.filter((n) => n !== call.number) });
      return api.unblockNumber(call.number);
    }
    const ok = await confirm({
      title: `Block ${callerName(call)}?`,
      message: 'Their calls will be rejected without ringing. You can unblock them later.',
      confirmLabel: 'Block',
      destructive: true,
    });
    if (!ok) return null;
    const saved = await api.blockNumber(call.number);
    toast.undo(`${callerName(call)} is blocked.`, () => {
      api.unblockNumber(call.number).then(
        (pp) => profile.mutate(() => pp),
        (e: unknown) => toast.error(`Couldn't unblock: ${errorMessage(e)}`),
      );
    });
    return saved;
  });

  const toggleVip = async () => {
    if (!p) return;
    const next = vip ? p.vip_numbers.filter((n) => n !== call.number) : [...p.vip_numbers, call.number];
    await profile.patch({ vip_numbers: next }, vip ? 'Removed from VIPs.' : `${callerName(call)} is a VIP: urgent alerts for their calls.`);
  };

  const share = async () => {
    const text = [
      `${callerName(call)} · ${new Date(call.started_at * 1000).toLocaleString()}`,
      call.summary,
      '',
      ...call.transcript.map((l) => `${l.speaker === 'caller' ? callerName(call) : l.speaker === 'user' ? 'You' : 'Assistant'}: ${l.text}${l.translation && l.translation !== l.text ? ` (${l.translation})` : ''}`),
    ].join('\n');
    try {
      await Share.share({ message: text });
    } catch (e) {
      console.warn('Share failed', e);
      toast.error("Couldn't open sharing.");
    }
  };

  const digits = call.number.replace(/\D/g, '');
  return (
    <>
      {call.summary || call.message ? (
        <Card tone={call.urgent ? 'warning' : 'default'}>
          {call.summary ? <Text variant="body">{call.summary}</Text> : null}
          {call.message && call.message !== call.summary ? (
            <View style={[styles.quote, { borderLeftColor: t.color.primary }]}>
              <Text variant="overline" color="text2">
                Message
              </Text>
              <Text variant="callout">{call.message}</Text>
            </View>
          ) : null}
          {call.action_items.length ? (
            <View style={styles.items}>
              {call.action_items.map((a) => (
                <View key={a} style={styles.item}>
                  <Icon name="checkbox-outline" size={18} color={t.color.primary} />
                  <Text variant="callout" style={styles.flex}>
                    {a}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text variant="caption" color="text2">
            {timeAgo(call.started_at)}
          </Text>
        </Card>
      ) : null}
      {call.number ? (
        <View style={styles.actions}>
          <Button title="Call back" icon="call-outline" variant="tonal" size="sm" onPress={() => void open(`tel:${call.number}`, 'the dialler')} />
          <Button title="WhatsApp" icon="logo-whatsapp" variant="tonal" size="sm" onPress={() => void open(`https://wa.me/${digits}`, 'WhatsApp')} />
          <Button title={vip ? 'VIP' : 'Save as VIP'} icon={vip ? 'star' : 'star-outline'} variant="tonal" size="sm" disabled={!p} onPress={() => void toggleVip()} />
          <Button
            title={blocked ? 'Unblock' : 'Block'}
            icon="ban-outline"
            variant={blocked ? 'tonal' : 'destructive'}
            size="sm"
            loading={block.busy}
            onPress={() => void block.run().then((pp) => pp && profile.mutate(() => pp))}
          />
          <Button title="Share" icon="share-outline" variant="tonal" size="sm" onPress={() => void share()} />
        </View>
      ) : null}
      {recording ? <AudioPlayer source={recording} title="Call recording" knownDuration={call.ended_at ? call.ended_at - call.started_at : null} /> : null}
    </>
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

function LiveComposer({ callId, owner, callerLang }: { callId: string; owner: string; callerLang: string }) {
  const say = useAsyncAction((text: string) => api.say(callId, text, owner), { error: (e) => `Not said. ${errorMessage(e)}` });
  const sayAudio = useAsyncAction((r: Recording) => api.sayAudio(callId, r.uri, owner), {
    success: (r) => (r.heard ? `Said: "${r.heard}"` : 'Said.'),
    error: (e) => `Not said. ${errorMessage(e)}`,
  });
  const translated = callerLang && callerLang !== owner;
  return (
    <Composer
      placeholder={`Reply in ${languageName(owner)}`}
      hint={translated ? `Type or hold the mic in ${languageName(owner)}. I'll say it in ${languageName(callerLang)}.` : 'Type or hold the mic. Your assistant says it right away.'}
      suggestions={QUICK_ANSWERS}
      busy={say.busy || sayAudio.busy}
      onSend={async (text) => {
        await say.run(text);
      }}
      onVoice={async (r) => {
        await sayAudio.run(r);
      }}
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  transcriptHead: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  quote: { borderLeftWidth: 3, paddingLeft: 10, gap: 2 },
  items: { gap: 6 },
  item: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
