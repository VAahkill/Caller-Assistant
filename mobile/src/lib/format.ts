// Display helpers for times, durations and phone numbers.

/** Seconds since the epoch, as the server sends them. */
export type EpochSeconds = number;

export function timeAgo(ts: EpochSeconds, now: number = Date.now()): string {
  const s = Math.max(0, now / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "10:42" in the phone's 12/24 h style. */
export function clockTime(ts: EpochSeconds): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** 75 -> "1:15". */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function isToday(ts: EpochSeconds, now: Date = new Date()): boolean {
  const d = new Date(ts * 1000);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

/** "+91 98765 00001" for Indian mobiles, otherwise the number as stored. */
export function prettyNumber(n: string): string {
  const m = /^\+91(\d{5})(\d{5})$/.exec(n);
  return m ? `+91 ${m[1]} ${m[2]}` : n;
}

/** Pulls a phone number out of pasted text (Maps, WhatsApp, a website). */
export function phoneFromText(text: string): string {
  const m = text.match(/\+?\d[\d\s().-]{7,}\d/);
  return m ? m[0].replace(/[^\d+]/g, '') : '';
}

export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** "+91 98480-12345" -> "+919848012345"; keeps a leading + and the digits. */
export function cleanNumber(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  return trimmed.startsWith('+') ? `+${digits}` : trimmed.startsWith('00') ? `+${digits.slice(2)}` : digits;
}
