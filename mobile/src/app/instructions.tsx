import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { Body, Button, Card, Chip, Input, Muted, Title } from '../components/ui';
import { api } from '../lib/api';
import type { Instruction, KnowledgeNote } from '../lib/types';

const IDEAS = [
  'If my mom calls, tell her I will call back within an hour.',
  'Couriers can leave parcels with the security guard.',
  'Never book anything that needs a prepayment without asking me.',
  'Speak Hindi first if the caller sounds unsure in English.',
];

/** How calls should be handled, and what the assistant may tell callers. */
export default function Instructions() {
  const [instructions, setInstructions] = useState<Instruction[]>([]);
  const [notes, setNotes] = useState<KnowledgeNote[]>([]);
  const [ins, setIns] = useState('');
  const [note, setNote] = useState('');
  const [anyone, setAnyone] = useState(false);

  const load = useCallback(() => {
    api.profile().then((p) => {
      setInstructions(p.instructions);
      setNotes(p.knowledge);
    }).catch(() => {});
  }, []);
  useEffect(load, [load]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Title>Instructions</Title>
        <Muted>Rules for how your assistant handles calls.</Muted>
        {instructions.map((i) => (
          <View key={i.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1 }}>• {i.text}</Body>
            <Button title="✕" kind="secondary" onPress={() => api.deleteInstruction(i.id).then(load)} />
          </View>
        ))}
        <Input value={ins} onChangeText={setIns} placeholder="Add an instruction" multiline />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {IDEAS.map((idea) => (
            <Chip key={idea} label={idea} onPress={() => setIns(idea)} />
          ))}
        </View>
        <Button title="Add instruction" disabled={!ins.trim()} onPress={() => api.addInstruction(ins).then(() => { setIns(''); load(); })} />
      </Card>

      <Card>
        <Title>What callers may know</Title>
        <Muted>Facts the assistant can share, e.g. "I'm in a meeting until 5". Anything else, it checks with you first.</Muted>
        {notes.map((n) => (
          <View key={n.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Body style={{ flex: 1 }}>• {n.text} <Muted>({n.share_with === 'anyone' ? 'anyone' : 'contacts only'})</Muted></Body>
            <Button title="✕" kind="secondary" onPress={() => api.deleteNote(n.id).then(load)} />
          </View>
        ))}
        <Input value={note} onChangeText={setNote} placeholder="Add a note" multiline />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Chip label="Contacts only" active={!anyone} onPress={() => setAnyone(false)} />
          <Chip label="Anyone" active={anyone} onPress={() => setAnyone(true)} />
        </View>
        <Button title="Add note" disabled={!note.trim()}
          onPress={() => api.addNote(note, anyone ? 'anyone' : 'contacts').then(() => { setNote(''); load(); })} />
      </Card>
    </ScrollView>
  );
}
