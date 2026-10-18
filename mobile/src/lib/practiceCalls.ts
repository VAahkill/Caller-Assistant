// Practice calls (/ws/simulate) are stored and published like real calls. The
// app keeps them apart: no notifications, nothing under Live now or Needs you,
// not counted on Today, and in Inbox only under the Practice filter.

/** The number a practice call pretends to come from. */
export const PRACTICE_NUMBER = '+919800000000';

export function isPracticeNumber(number: string | null | undefined): boolean {
  return !!number && number.replace(/[^\d+]/g, '') === PRACTICE_NUMBER;
}

/** A server may mark them itself (practice or simulated); until then the number tells. */
export function isPracticeCall(call: { number?: string; practice?: boolean } | null | undefined): boolean {
  return !!call && (call.practice === true || isPracticeNumber(call.number));
}
