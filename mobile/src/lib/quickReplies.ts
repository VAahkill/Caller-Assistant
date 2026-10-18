// One-tap replies the owner can have the assistant say on a live call, by what
// the call is about. Written in English; the server translates them into the
// caller's language like anything else the owner types.

const BY_CATEGORY: Record<string, string[]> = {
  delivery: [
    'Please leave it with security at the gate',
    "I'm coming down in 2 minutes",
    'Please call me when you reach the gate',
    'Leave it at the door, thank you',
  ],
  contact: ["I'll call you back in 10 minutes", "I'm in a meeting, I'll call you soon", 'Please send it on WhatsApp'],
  business: ['Please send the details on WhatsApp', "I'll call you back later today", 'Please hold on a minute'],
  spam: ['Not interested, thank you', 'Please remove my number from your list'],
};

const DEFAULT = ['Please hold on a minute', "I'll call you back later today", 'Please send the details on WhatsApp'];

export function liveQuickReplies(category: string): string[] {
  return BY_CATEGORY[category] ?? DEFAULT;
}
