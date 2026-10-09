// The Assistant hub's summaries: what each row says, and the short
// "finish setting up" list of things that make the assistant useful.

import { languageName } from './languages';
import { isExpired } from './rules';
import type { Profile, VoiceInfo } from './types';
import { chosenVoiceId } from './voices';

export interface SetupItem {
  id: 'contacts' | 'location' | 'instructions' | 'voices';
  title: string;
  detail: string;
  done: boolean;
  href: string;
}

/** Four things worth doing once: each says why, and is done or not. */
export function setupChecklist(p: Profile): SetupItem[] {
  const pinned = p.location.lat != null && p.location.lng != null;
  const rules = p.instructions.some((i) => i.enabled && !isExpired(i.expires_at));
  const missing = p.caller_languages.filter((l) => !chosenVoiceId(p, l));
  return [
    {
      id: 'contacts',
      title: 'Sync your contacts',
      detail: 'Saved contacts always get through and are greeted by name.',
      done: p.contacts.length > 0,
      href: '/screening',
    },
    {
      id: 'location',
      title: 'Pin your door',
      detail: 'Delivery partners get directions without calling you.',
      done: pinned,
      href: '/location',
    },
    {
      id: 'instructions',
      title: 'Add an instruction',
      detail: 'Tell it how to handle couriers, family or sales calls.',
      done: rules,
      href: '/instructions',
    },
    {
      id: 'voices',
      title: 'Pick a voice for each language',
      detail: missing.length ? `Not picked yet: ${missing.map(languageName).join(', ')}.` : 'Every language your callers speak has a voice.',
      done: missing.length === 0,
      href: '/voices',
    },
  ];
}

/** "Telugu: Padmavathi · English: Heart +2", from the picks per language. */
export function voiceSummary(p: Profile, voices: VoiceInfo[] | undefined): string {
  if (!voices) return 'Pick a voice per language, or record your own';
  const name = (id: string | undefined) => voices.find((v) => v.id === id)?.name;
  const picked = p.caller_languages.map((l) => [l, name(chosenVoiceId(p, l))] as const).filter(([, n]) => !!n);
  if (!picked.length) return 'Pick a voice per language, or record your own';
  const shown = picked.slice(0, 2).map(([l, n]) => `${languageName(l)}: ${n}`);
  return `${shown.join(' · ')}${picked.length > 2 ? ` +${picked.length - 2}` : ''}`;
}
