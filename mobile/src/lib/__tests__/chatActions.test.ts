import { chatActionChip } from '../chatActions';

test('each owner chat action becomes a chip that opens where it changed', () => {
  expect(chatActionChip({ type: 'task_created', task: { target_name: 'Paradise Biryani', number: '+914023456789' } })).toEqual({
    icon: 'call-outline',
    label: 'Calling Paradise Biryani',
    href: '/tasks',
  });
  expect(chatActionChip({ type: 'task_created', task: { target_name: '', number: '+914023456789' } })?.label).toBe('Calling +914023456789');
  expect(chatActionChip({ type: 'instruction_added', text: 'Be brief' })).toMatchObject({ label: 'Instruction: Be brief', href: '/instructions' });
  expect(chatActionChip({ type: 'note_added', text: 'Gate 2 is next to the lift' })).toMatchObject({ label: 'Noted: Gate 2 is next to the lift', href: '/notes' });
  expect(chatActionChip({ type: 'availability', available: false })).toMatchObject({ label: 'You are marked busy', href: '/away' });
  expect(chatActionChip({ type: 'enabled', enabled: true })).toEqual({ icon: 'headset-outline', label: 'Assistant turned on' });
});

test('long texts are shortened, missing fields fall back, unknown types are skipped', () => {
  const long = 'Always ask delivery partners to leave parcels with the guard at Gate 2 near the lift';
  const label = chatActionChip({ type: 'instruction_added', text: long })!.label;
  expect(label.length).toBeLessThanOrEqual('Instruction: '.length + 48);
  expect(label.endsWith('…')).toBe(true);
  expect(chatActionChip({ type: 'note_added' })?.label).toBe('Note saved');
  expect(chatActionChip({ type: 'task_created' })?.label).toBe('Call started');
  expect(chatActionChip({ type: 'something_new', x: 1 })).toBeNull();
});
