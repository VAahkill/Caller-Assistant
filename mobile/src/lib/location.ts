// Delivery location helpers: what the assistant tells a delivery partner,
// unsaved-change detection, and a short line from a reverse-geocoded address.

import type { Location } from './types';

const FIELDS: (keyof Location)[] = ['lat', 'lng', 'address', 'building', 'floor_unit', 'landmarks', 'gate_instructions'];

/** True when the two differ in anything the owner can edit. */
export function locationChanged(a: Location, b: Location): boolean {
  return FIELDS.some((k) => {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) > 1e-7;
    return (typeof x === 'string' ? x.trim() : x) !== (typeof y === 'string' ? y.trim() : y);
  });
}

const sentence = (s: string) => {
  const t = s.trim();
  return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : '';
};

// "Use Gate 2" reads as "use Gate 2" mid-sentence; "ATM" and "Gate 2" keep their capitals.
const midSentence = (s: string) => (/^[A-Z][a-z]+\b/.test(s) && !/^(Gate|Block|Tower|Flat|Road|Street)\b/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);

const WHERE = /^(opposite|next to|behind|above|below|near|beside|in front of|across from)\b/i;

/**
 * Roughly what the assistant says when a delivery partner asks the way, in
 * the order a rider needs it: the place, then the landmark, then the way in.
 */
export function directionsText(loc: Location): string {
  const place = [loc.floor_unit, loc.building, loc.address].map((s) => s.trim()).filter(Boolean).join(', ');
  const landmark = loc.landmarks.trim().replace(/[.,]$/, '');
  const gate = loc.gate_instructions.trim().replace(/[.,]$/, '');
  const parts = [
    place ? sentence(place) : loc.geocoded_hint ? sentence(`Near ${loc.geocoded_hint}`) : '',
    landmark ? sentence(WHERE.test(landmark) ? `It's ${landmark.charAt(0).toLowerCase()}${landmark.slice(1)}` : `Look for ${midSentence(landmark)}`) : '',
    gate ? sentence(`To get in, ${midSentence(gate)}`) : '',
    loc.lat != null && loc.lng != null ? 'I can also send you the map pin by SMS.' : '',
  ].filter(Boolean);
  return parts.join(' ');
}

export interface GeocodedAddressLike {
  name?: string | null;
  street?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
}

/** "Road No. 2, Kondapur, Hyderabad 500084" from a reverse-geocode result. */
export function geocodeLine(a: GeocodedAddressLike): string {
  const parts: string[] = [];
  for (const p of [a.street || a.name, a.district, a.city || a.subregion]) {
    const v = (p ?? '').trim();
    if (v && !parts.includes(v)) parts.push(v);
  }
  const line = parts.join(', ');
  return a.postalCode ? `${line}${line ? ' ' : ''}${a.postalCode}` : line;
}
