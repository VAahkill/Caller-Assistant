import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { VoiceRecorderSheet } from '../components/domain/VoiceRecorderSheet';
import { AsyncContent } from '../components/ui/AsyncContent';
import { Banner } from '../components/ui/Banner';
import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { IconButton } from '../components/ui/IconButton';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { StatusPill } from '../components/ui/StatusPill';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import { errorMessage, useAsyncAction } from '../hooks/useAsyncAction';
import { useDemoPlayer, usePreloadedSources, type DemoPlayer } from '../hooks/useDemoPlayer';
import { useProfile } from '../hooks/useProfile';
import { useResource } from '../hooks/useResource';
import { api, type MediaSource } from '../lib/api';
import { Icon } from '../lib/design';
import { useTokens } from '../lib/design/theme';
import { duration, timeAgo } from '../lib/format';
import { engineName } from '../lib/labels';
import { languageName } from '../lib/languages';
import { useLive } from '../lib/live';
import type { VoiceInfo, VoiceStatus } from '../lib/types';
import { STATUS_LABEL, choosePatch, chosenVoiceId, samplePathFor, statusChanges, suggestName, voiceGroups, type VoiceGroup } from '../lib/voices';

/** How long Undo is offered before a deleted voice is really removed. */
export const DELETE_AFTER_MS = 6000;
/** While a recorded voice is getting ready, the list is checked this often, for up to three minutes. */
export const POLL_MS = 4000;
const POLL_FOR_MS = 3 * 60_000;

const sampleKey = (id: string, lang: string) => `${id}@${lang}`;
const originalKey = (id: string) => `${id}#original`;

/** Voices: your recorded voices first, then the voice for each language your
 *  callers speak, with demos that play at once (preloaded when the screen opens). */
export default function Voices() {
  const t = useTokens();
  const toast = useToast();
  const { voicesKey } = useLive();
  const voices = useResource(() => api.voices(), voicesKey);
  const profile = useProfile();
  const [recording, setRecording] = useState(false);
  const [recordSession, setRecordSession] = useState(0);
  const [renaming, setRenaming] = useState<VoiceInfo | null>(null);
  const [more, setMore] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const onDemoError = useCallback((message: string) => toast.error(message), [toast]);
  const demo = useDemoPlayer(onDemoError);

  const p = profile.data;
  const assistant = p?.assistant_name || 'your assistant';
  const callerLanguages = useMemo(() => p?.caller_languages ?? [], [p?.caller_languages]);
  const all = useMemo(() => (voices.data ?? []).filter((v) => !hidden.has(v.id)), [voices.data, hidden]);
  const mine = useMemo(() => all.filter((v) => v.kind === 'clone'), [all]);
  const groups = useMemo(() => voiceGroups(all, callerLanguages), [all, callerLanguages]);
  const primary = groups.filter((g) => g.primary);
  const others = groups.filter((g) => !g.primary);
  // A recorded voice's demo plays in the first caller language it speaks.
  const demoLang = useCallback((v: VoiceInfo) => callerLanguages.find((l) => v.languages.includes(l)) ?? v.languages[0] ?? 'en', [callerLanguages]);

  // Every demo on the screen, fetched with the server token as soon as the list is known.
  const sources = useMemo(() => {
    const out = new Map<string, MediaSource>();
    const add = (v: VoiceInfo, lang: string) => {
      const s = api.voiceSample({ sample_url: samplePathFor(v, lang) });
      if (s && v.status === 'ready') out.set(s.uri, s);
    };
    for (const g of groups) for (const v of g.voices) add(v, g.lang);
    for (const v of mine) add(v, demoLang(v));
    return [...out.values()];
  }, [groups, mine, demoLang]);
  usePreloadedSources(sources);

  // Getting ready: check again every few seconds (and whenever voice_status arrives).
  const preparing = mine.some((v) => v.status === 'preparing');
  const { reload } = voices;
  useEffect(() => {
    if (!preparing) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > POLL_FOR_MS) clearInterval(timer);
      else void reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [preparing, reload]);

  // Say when a recorded voice becomes ready, or why it failed.
  const seen = useRef<Map<string, VoiceStatus> | null>(null);
  useEffect(() => {
    if (!voices.data) return;
    if (seen.current) {
      for (const { voice } of statusChanges(seen.current, voices.data)) {
        if (voice.status === 'ready') toast.success(`"${voice.name}" is ready. Play it, then pick it for a language below.`);
        else toast.error(`"${voice.name}" didn't work. ${voice.detail || 'Record it again in a quiet room.'}`);
      }
    }
    seen.current = new Map(voices.data.map((v) => [v.id, v.status]));
  }, [voices.data, toast]);

  const choose = async (v: VoiceInfo, lang: string) => {
    if (!p || chosenVoiceId(p, lang) === v.id) return;
    await profile.patch(choosePatch(p, lang, v.id), `${v.name} will answer ${languageName(lang)} callers.`);
  };

  // Delete hides the voice at once and offers Undo; the server delete runs when Undo has gone.
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const unhide = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.delete(id);
      return next;
    });
  const commitDelete = async (v: VoiceInfo) => {
    timers.current.delete(v.id);
    try {
      await api.deleteVoice(v.id);
      voices.mutate((list) => list?.filter((x) => x.id !== v.id));
      void profile.reload();
    } catch (e) {
      toast.error(`"${v.name}" was not deleted. ${errorMessage(e)}`);
    } finally {
      unhide(v.id);
    }
  };
  const remove = (v: VoiceInfo) => {
    demo.stop();
    setHidden((h) => new Set(h).add(v.id));
    timers.current.set(
      v.id,
      setTimeout(() => void commitDelete(v), DELETE_AFTER_MS),
    );
    toast.undo(`Deleted "${v.name}".`, () => {
      clearTimeout(timers.current.get(v.id));
      timers.current.delete(v.id);
      unhide(v.id);
    });
  };
  // Leaving the screen: deletes waiting for their Undo go through now.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const [id, timer] of pending) {
        clearTimeout(timer);
        api.deleteVoice(id).catch((e: unknown) => console.warn('Deleting a voice after leaving the screen failed', id, e));
      }
      pending.clear();
    };
  }, []);

  const usedFor = (v: VoiceInfo) => (p ? callerLanguages.filter((l) => chosenVoiceId(p, l) === v.id).map(languageName) : []);
  const openRecorder = () => {
    demo.stop();
    setRecordSession((n) => n + 1);
    setRecording(true);
  };

  return (
    <Screen bottomInset refreshing={voices.refreshing} onRefresh={() => void voices.refresh()} testID="voices">
      <Text variant="subhead" color="text2">
        Pick how {assistant} sounds for each language your callers speak. Tap play to hear a voice; tap again to stop.
      </Text>

      <Section title="My voices" grouped={false} testID="my-voices">
        {mine.map((v) => (
          <MyVoiceCard
            key={v.id}
            voice={v}
            usedFor={usedFor(v)}
            sampleLang={demoLang(v)}
            demo={demo}
            onRename={() => setRenaming(v)}
            onDelete={() => remove(v)}
            onRecordAgain={openRecorder}
          />
        ))}
        <Card onPress={openRecorder} accessibilityLabel="Record a new voice" testID="record-voice">
          <View style={styles.row}>
            <View style={[styles.addIcon, { backgroundColor: t.color.primaryContainer }]}>
              <Icon name="mic" size={22} color={t.color.onPrimaryContainer} />
            </View>
            <View style={styles.flex}>
              <Text variant="headline">{mine.length ? 'Record another voice' : 'Record your voice'}</Text>
              <Text variant="subhead" color="text2">
                Read a short passage for 15 to 30 seconds. {assistant.charAt(0).toUpperCase() + assistant.slice(1)} can then speak in it.
              </Text>
            </View>
            <Icon name="chevron-forward" size={18} color={t.color.text3} />
          </View>
        </Card>
      </Section>

      <AsyncContent
        data={voices.data}
        loading={voices.loading}
        error={voices.error}
        onRetry={() => void voices.reload()}
        isEmpty={() => groups.every((g) => g.voices.length === 0)}
        empty={{ icon: 'mic-off-outline', title: 'No voices on your server', message: 'The server reported no voices. Check that it finished starting up.' }}
      >
        {() => (
          <>
            {primary.map((g) => (
              <LanguageGroup key={g.lang} group={g} chosen={p ? chosenVoiceId(p, g.lang) : undefined} demo={demo} onChoose={(v) => void choose(v, g.lang)} />
            ))}
            {others.length ? (
              <>
                <Button
                  title={more ? 'Hide other languages' : `More languages (${others.length})`}
                  variant="ghost"
                  icon={more ? 'chevron-up' : 'chevron-down'}
                  onPress={() => setMore((m) => !m)}
                />
                {more
                  ? others.map((g) => (
                      <LanguageGroup key={g.lang} group={g} chosen={p ? chosenVoiceId(p, g.lang) : undefined} demo={demo} onChoose={(v) => void choose(v, g.lang)} />
                    ))
                  : null}
              </>
            ) : null}
          </>
        )}
      </AsyncContent>

      <VoiceRecorderSheet
        key={recordSession}
        visible={recording}
        defaultName={suggestName(mine.map((v) => v.name))}
        onClose={() => setRecording(false)}
        onSaved={(v) => voices.mutate((list) => [v, ...(list ?? []).filter((x) => x.id !== v.id)])}
      />
      <RenameSheet
        voice={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(v) => {
          setRenaming(null);
          voices.mutate((list) => list?.map((x) => (x.id === v.id ? v : x)));
        }}
      />
    </Screen>
  );
}

function LanguageGroup({ group, chosen, demo, onChoose }: { group: VoiceGroup; chosen?: string; demo: DemoPlayer; onChoose: (v: VoiceInfo) => void }) {
  const name = languageName(group.lang);
  const picked = group.voices.some((v) => v.id === chosen);
  return (
    <Section
      // English name only: the overline's letter spacing breaks Indic scripts apart.
      title={name}
      footer={
        group.voices.length === 0
          ? undefined
          : picked
            ? `Used when callers speak ${name}.`
            : `Not picked yet: your server uses its default ${name} voice.`
      }
      testID={`voices-${group.lang}`}
    >
      {group.voices.length === 0 ? (
        <View style={styles.none}>
          <Text variant="subhead" color="text2">
            No {name} voice on your server yet. Callers who speak {name} hear the closest voice it has.
          </Text>
        </View>
      ) : (
        group.voices.map((v) => <VoiceRow key={v.id} voice={v} lang={group.lang} chosen={chosen === v.id} demo={demo} onChoose={() => onChoose(v)} />)
      )}
    </Section>
  );
}

function VoiceRow({ voice: v, lang, chosen, demo, onChoose }: { voice: VoiceInfo; lang: string; chosen: boolean; demo: DemoPlayer; onChoose: () => void }) {
  const t = useTokens();
  const key = sampleKey(v.id, lang);
  const phase = demo.phaseOf(key);
  const mine = v.kind === 'clone';
  const meta = mine
    ? ['Your voice', v.seconds ? `${duration(v.seconds)} recording` : null]
    : [v.gender && v.gender.charAt(0).toUpperCase() + v.gender.slice(1), v.engine && engineName(v.engine)];
  return (
    <View testID={`voice-${v.id}-${lang}`}>
      <Pressable
        onPress={onChoose}
        accessibilityRole="radio"
        accessibilityState={{ checked: chosen }}
        accessibilityLabel={`${v.name}${mine ? ', your voice' : v.gender ? `, ${v.gender}` : ''}, for ${languageName(lang)}`}
        android_ripple={{ color: t.color.surface3 }}
        style={[styles.voiceRow, { paddingHorizontal: t.space.lg }]}
      >
        <Icon name={chosen ? 'radio-button-on' : 'radio-button-off'} size={22} color={chosen ? t.color.primary : t.color.text3} />
        <View style={styles.flex}>
          <Text variant="headline">{v.name}</Text>
          <Text variant="footnote" color={phase === 'error' ? 'danger' : 'text2'}>
            {phase === 'playing' ? 'Playing…' : phase === 'loading' ? 'Loading…' : phase === 'error' ? "Couldn't play. Tap to try again." : meta.filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon={phase === 'playing' || phase === 'loading' ? 'stop' : phase === 'error' ? 'refresh' : 'play'}
          label={phase === 'playing' || phase === 'loading' ? `Stop ${v.name}` : `Play ${v.name}`}
          variant="tonal"
          loading={phase === 'loading'}
          onPress={() => demo.toggle(key, api.voiceSample({ sample_url: samplePathFor(v, lang) }))}
          testID={`play-${v.id}-${lang}`}
        />
      </Pressable>
      {phase === 'playing' ? <ProgressLine value={demo.progress} /> : null}
    </View>
  );
}

function MyVoiceCard({
  voice: v,
  usedFor,
  sampleLang,
  demo,
  onRename,
  onDelete,
  onRecordAgain,
}: {
  voice: VoiceInfo;
  usedFor: string[];
  sampleLang: string;
  demo: DemoPlayer;
  onRename: () => void;
  onDelete: () => void;
  onRecordAgain: () => void;
}) {
  const t = useTokens();
  const original = originalKey(v.id);
  const sample = sampleKey(v.id, sampleLang);
  const originalPhase = demo.phaseOf(original);
  const samplePhase = demo.phaseOf(sample);
  const busy = (x: string) => x === 'playing' || x === 'loading';
  const tone = v.status === 'ready' ? 'success' : v.status === 'preparing' ? 'info' : 'danger';
  return (
    <Card testID={`my-voice-${v.id}`}>
      <View style={styles.row}>
        <View style={styles.flex}>
          <Text variant="headline" numberOfLines={1}>
            {v.name}
          </Text>
          <View style={styles.meta}>
            <StatusPill label={STATUS_LABEL[v.status]} tone={tone} dot={v.status === 'preparing'} pulse={v.status === 'preparing'} />
            <Text variant="footnote" color="text2">
              {[v.seconds ? duration(v.seconds) : null, v.created_at ? `recorded ${timeAgo(v.created_at)}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>
        <IconButton icon="create-outline" label={`Rename ${v.name}`} onPress={onRename} />
        <IconButton icon="trash-outline" label={`Delete ${v.name}`} onPress={onDelete} />
      </View>
      {v.status === 'preparing' ? (
        <Text variant="footnote" color="text2">
          Your server is getting it ready. This takes about a minute; we will tell you when it is done.
        </Text>
      ) : null}
      {v.status === 'failed' ? (
        <Banner
          tone="danger"
          title="Couldn't make a voice from this recording"
          message={v.detail || 'Record it again in a quiet room, 15 to 30 seconds, about a hand away from the phone.'}
          action={{ label: 'Record again', onPress: onRecordAgain }}
        />
      ) : null}
      {usedFor.length ? (
        <View style={styles.used}>
          <Icon name="checkmark-circle" size={16} color={t.color.success} />
          <Text variant="footnote" color="text2">
            Answers {usedFor.join(', ')} callers
          </Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button
          title={busy(originalPhase) ? 'Stop' : 'Play original'}
          icon={busy(originalPhase) ? 'stop' : 'play'}
          variant="tonal"
          size="sm"
          loading={originalPhase === 'loading'}
          onPress={() => demo.toggle(original, api.voiceRecording(v))}
        />
        <Button
          title={busy(samplePhase) ? 'Stop' : v.status === 'preparing' ? 'Getting ready…' : 'Play in assistant voice'}
          icon={busy(samplePhase) ? 'stop' : 'sparkles-outline'}
          variant="tonal"
          size="sm"
          loading={samplePhase === 'loading'}
          disabled={v.status !== 'ready'}
          onPress={() => demo.toggle(sample, api.voiceSample({ sample_url: samplePathFor(v, sampleLang) }))}
        />
      </View>
      {busy(originalPhase) || busy(samplePhase) ? <ProgressLine value={demo.progress} /> : null}
    </Card>
  );
}

function ProgressLine({ value }: { value: number }) {
  const t = useTokens();
  return (
    <View
      style={[styles.progress, { backgroundColor: t.color.surface3 }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}
    >
      <View style={[styles.progressFill, { width: `${Math.round(value * 100)}%`, backgroundColor: t.color.primary }]} />
    </View>
  );
}

function RenameSheet({ voice, onClose, onRenamed }: { voice: VoiceInfo | null; onClose: () => void; onRenamed: (v: VoiceInfo) => void }) {
  const [name, setName] = useState('');
  const [forVoice, setForVoice] = useState<VoiceInfo | null>(null);
  if (voice && voice !== forVoice) {
    setForVoice(voice);
    setName(voice.name);
  }
  const save = useAsyncAction(() => api.renameVoice(voice!.id, name.trim()), { success: (v) => `Renamed to "${v.name}".`, error: false });
  return (
    <BottomSheet visible={!!voice} onClose={onClose} title="Rename voice">
      <View style={styles.sheet}>
        <TextField label="Name" value={name} onChangeText={setName} autoFocus maxLength={40} error={save.error} />
        <Button title="Save" loading={save.busy} disabled={!name.trim() || name.trim() === voice?.name} fullWidth onPress={() => void save.run().then((v) => v && onRenamed(v))} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 64, paddingVertical: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  used: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  none: { padding: 16 },
  sheet: { gap: 16 },
  progress: { height: 3, borderRadius: 2, overflow: 'hidden', marginHorizontal: 16, marginBottom: 6 },
  progressFill: { height: 3, borderRadius: 2 },
});
