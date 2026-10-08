import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '../components/ui/Avatar';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ChatBubble } from '../components/ui/ChatBubble';
import { Chip } from '../components/ui/Chip';
import { CountryPicker } from '../components/ui/CountryPicker';
import { EmptyState } from '../components/ui/EmptyState';
import { IconButton } from '../components/ui/IconButton';
import { ListRow } from '../components/ui/ListRow';
import { Screen } from '../components/ui/Screen';
import { Section } from '../components/ui/Section';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { SkeletonRows } from '../components/ui/Skeleton';
import { StatusPill } from '../components/ui/StatusPill';
import { Text } from '../components/ui/Text';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/Toast';
import type { TranscriptLine } from '../lib/types';

const LINES: TranscriptLine[] = [
  {
    id: 'g1',
    speaker: 'caller',
    text: 'అన్నా, స్విగ్గీ ఆర్డర్ వచ్చింది. గేట్ ఎక్కడ?',
    lang: 'te',
    translation: 'Brother, the Swiggy order is here. Where is the gate?',
    translation_lang: 'en',
    english: '',
    at: 1_700_000_000,
    kind: 'speech',
  },
  {
    id: 'g2',
    speaker: 'assistant',
    text: 'గేట్ 2 వద్దకు రండి, సెక్యూరిటీకి ఫ్లాట్ నంబర్ చెప్పండి.',
    lang: 'te',
    translation: 'Come to Gate 2 and tell security the flat number.',
    translation_lang: 'en',
    english: '',
    at: 1_700_000_010,
    kind: 'speech',
  },
];

/** Every shared component in one place, for design review and screenshots. Not linked from the app. */
export default function Gallery() {
  const toast = useToast();
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [chip, setChip] = useState(true);
  const [on, setOn] = useState(true);
  const [country, setCountry] = useState('+91');
  return (
    <Screen bottomInset testID="gallery">
      <Section title="Text" grouped={false}>
        <Text variant="largeTitle">Large title</Text>
        <Text variant="title1">Title one</Text>
        <Text variant="title2">Title two</Text>
        <Text variant="headline">Headline</Text>
        <Text variant="body">Body text that wraps across lines to check rhythm and spacing in a paragraph.</Text>
        <Text variant="body">తెలుగు, हिन्दी, தமிழ்: line height for Indic scripts.</Text>
        <Text variant="subhead" color="text2">
          Secondary subhead
        </Text>
        <Text variant="footnote" color="text3">
          Tertiary footnote
        </Text>
        <Text variant="overline" color="text2">
          Overline
        </Text>
      </Section>

      <Section title="Buttons" grouped={false}>
        <View style={styles.wrap}>
          <Button title="Filled" icon="checkmark" onPress={() => toast.success('Saved.')} />
          <Button title="Tonal" variant="tonal" onPress={() => toast.info('Information.')} />
          <Button title="Outline" variant="outline" />
          <Button title="Ghost" variant="ghost" />
          <Button title="Delete" variant="destructive" icon="trash-outline" onPress={() => toast.undo('Deleted.', () => toast.success('Restored.'))} />
          <Button title="Loading" loading />
          <Button title="Done" success successTitle="Saved" />
          <Button title="Disabled" disabled />
          <Button title="Small" size="sm" variant="tonal" icon="add" />
        </View>
        <Button title="Large full width" size="lg" fullWidth icon="call" onPress={() => toast.error('That did not work.')} />
        <View style={styles.wrap}>
          <IconButton icon="play" label="Play" variant="tonal" />
          <IconButton icon="call" label="Call" variant="filled" />
          <IconButton icon="close" label="Close" />
          <IconButton icon="call" label="End call" variant="danger" />
          <IconButton icon="refresh" label="Loading" loading />
        </View>
      </Section>

      <Section title="Inputs" grouped={false}>
        <TextField label="Name" value="Arjun" onChangeText={() => undefined} helper="Callers hear this." clearable />
        <TextField label="Address" value="192.168.1.7" onChangeText={() => undefined} error="That doesn't look like a server address." icon="server-outline" />
        <TextField label="Token" value="secret-token" onChangeText={() => undefined} secret />
        <CountryPicker value={country} onChange={setCountry} />
        <SegmentedControl
          segments={[
            { value: 'a', label: 'Messages' },
            { value: 'b', label: 'Calls' },
            { value: 'c', label: 'Both' },
          ]}
          value={seg}
          onChange={setSeg}
          accessibilityLabel="Example"
        />
        <View style={styles.wrap}>
          <Chip label="Filter" selected={chip} onPress={() => setChip(!chip)} />
          <Chip label="Unread" count={3} />
          <Chip label="Suggestion" kind="suggestion" icon="add" />
          <Chip label="+91 98480 12345" kind="input" onRemove={() => undefined} />
        </View>
      </Section>

      <Section title="Rows">
        <ListRow icon="person-circle-outline" iconTone="primary" title="With value" value="India (+91)" chevron onPress={() => undefined} />
        <ListRow icon="notifications-outline" title="With switch" subtitle="Saves at once" switchValue={on} onSwitchChange={setOn} />
        <ListRow leading={<Avatar name="Amma" ring />} title="Amma" subtitle="+91 98480 12345" chevron onPress={() => undefined} />
        <ListRow icon="trash-outline" title="Destructive" destructive onPress={() => undefined} />
      </Section>

      <Section title="Status" grouped={false}>
        <View style={styles.wrap}>
          <StatusPill label="Live" tone="success" dot pulse />
          <StatusPill label="Delivery" tone="info" icon="bicycle-outline" />
          <StatusPill label="Spam" tone="danger" icon="ban-outline" />
          <StatusPill label="Waiting" tone="warning" />
          <StatusPill label="Primary" tone="primary" />
          <StatusPill label="Neutral" />
        </View>
        <Banner tone="info" title="Information" message="Something useful to know." />
        <Banner tone="success" title="Done" message="It worked." />
        <Banner tone="warning" title="Careful" message="Something needs attention." action={{ label: 'Fix', onPress: () => undefined }} />
        <Banner tone="danger" title="Security alert" message="The caller asked for an OTP. Your assistant refused." onDismiss={() => undefined} />
      </Section>

      <Section title="Cards" grouped={false}>
        <Card>
          <Text variant="headline">Default card</Text>
          <Text variant="subhead" color="text2">
            On the surface colour.
          </Text>
        </Card>
        <Card tone="primary">
          <Text variant="headline" color="onPrimaryContainer">
            Primary card
          </Text>
        </Card>
        <Card tone="warning">
          <Text variant="headline" color="onWarningContainer">
            Warning card
          </Text>
        </Card>
      </Section>

      <Section title="Chat" grouped={false}>
        {LINES.map((l) => (
          <ChatBubble key={l.id} line={l} assistantLabel="Ava" showTranslation ownerLanguage="en" />
        ))}
      </Section>

      <Section title="Empty and loading" grouped={false}>
        <EmptyState icon="file-tray-outline" title="Nothing here yet" message="New messages show up here." action={{ label: 'Refresh', onPress: () => undefined }} compact />
        <SkeletonRows rows={2} />
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
