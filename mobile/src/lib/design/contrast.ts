// WCAG 2.x contrast math, used by tests to keep the palette readable.

export type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
  throw new Error(`Unsupported colour: ${input}`);
}

/** Composites a possibly translucent colour over an opaque background. */
export function over(fg: string, bg: string): RGBA {
  const [r, g, b, a] = parseColor(fg);
  const [R, G, B] = parseColor(bg);
  return [r * a + R * (1 - a), g * a + G * (1 - a), b * a + B * (1 - a), 1];
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance([r, g, b]: RGBA): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio of text colour `fg` drawn on background `bg` (both may be translucent over `base`). */
export function contrast(fg: string, bg: string, base = '#000000'): number {
  const b = over(bg, base);
  const bgHex = `rgb(${b[0]}, ${b[1]}, ${b[2]})`;
  const f = over(fg, bgHex);
  const l1 = luminance(f);
  const l2 = luminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
