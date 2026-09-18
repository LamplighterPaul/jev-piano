// Pitch, chords and voicing. This file is the instrument, not the musician:
// it knows what a D minor triad *is*, and nothing at all about what should
// come next. Every choice in this program is made by Jev.

export const NOTE_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const

export type Quality = 'maj' | 'min' | 'dom7'

export const QUALITIES: Record<Quality, { intervals: number[]; suffix: string; about: string }> = {
  maj: { intervals: [0, 4, 7], suffix: '', about: 'major triad' },
  min: { intervals: [0, 3, 7], suffix: 'm', about: 'minor triad' },
  dom7: { intervals: [0, 4, 7, 10], suffix: '7', about: 'dominant seventh chord' },
}

export interface Chord { root: number; quality: Quality }

export const chordLabel = (c: Chord) => `${NOTE_NAMES[c.root]}${QUALITIES[c.quality].suffix}`
export const chordPcs = (c: Chord) => QUALITIES[c.quality].intervals.map(i => (c.root + i) % 12)

/** Every chord Jev may choose from: all twelve roots, three qualities each.
 *  Deliberately chromatic. Nothing here restricts it to the key — staying in
 *  key has to be Jev's doing, or it does not count. */
export const CHORD_BANK: Chord[] = NOTE_NAMES.flatMap((_, root) =>
  (['maj', 'min', 'dom7'] as Quality[]).map(quality => ({ root, quality })))

export const CHORD_BY_LABEL: Record<string, Chord> =
  Object.fromEntries(CHORD_BANK.map(c => [chordLabel(c), c]))

/** What Jev is told about each chord: its notes and its quality. No key, no
 *  roman numeral, no hint about which ones belong. It works that out itself. */
export function chordCriteria(): Record<string, string> {
  return Object.fromEntries(CHORD_BANK.map(c => [
    chordLabel(c),
    `${chordPcs(c).map(pc => NOTE_NAMES[pc]).join(' ')} — a ${QUALITIES[c.quality].about} on ${NOTE_NAMES[c.root]}`,
  ]))
}

export const MODES = {
  major: { steps: [0, 2, 4, 5, 7, 9, 11], about: 'major — bright and settled' },
  minor: { steps: [0, 2, 3, 5, 7, 8, 10], about: 'natural minor — dark and plain' },
  harmonic_minor: { steps: [0, 2, 3, 5, 7, 8, 11], about: 'harmonic minor — dark, with a sharpened leading note that pulls hard to the tonic' },
  dorian: { steps: [0, 2, 3, 5, 7, 9, 10], about: 'dorian — minor with a raised sixth, folk and modal' },
  mixolydian: { steps: [0, 2, 4, 5, 7, 9, 10], about: 'mixolydian — major with a flattened seventh, bluesy and open' },
  lydian: { steps: [0, 2, 4, 6, 7, 9, 11], about: 'lydian — major with a raised fourth, floating and dreamlike' },
  phrygian: { steps: [0, 1, 3, 5, 7, 8, 10], about: 'phrygian — minor with a flattened second, severe and Spanish' },
} as const

export type ModeId = keyof typeof MODES

export const modeCriteria = () =>
  Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.about]))

export const tonicCriteria = () =>
  Object.fromEntries(NOTE_NAMES.map(n => [n, `the music treats ${n} as home`]))

export const mod12 = (n: number) => ((n % 12) + 12) % 12

/**
 * Walk a ladder of pitches. `pcs` is the set of pitch classes that count as a
 * rung — the chord for arpeggios, the scale for runs. `n` steps up (or down)
 * from the first rung at or above `anchor`. This is how a figure written as
 * "third rung, fourth rung, second rung" becomes real notes under whichever
 * chord Jev picked, in whichever key.
 */
export function ladder(pcs: number[], anchor: number, n: number): number {
  const set = new Set(pcs.map(mod12))
  if (!set.size) return anchor
  let m = Math.round(anchor)
  let guard = 0
  while (!set.has(mod12(m)) && guard++ < 24) m++
  const step = n >= 0 ? 1 : -1
  for (let k = 0; k !== n; k += step) {
    guard = 0
    do { m += step } while (!set.has(mod12(m)) && guard++ < 24)
  }
  return Math.max(21, Math.min(108, m))
}

/** The nearest pitch to `near` with the given pitch class. Used to land the
 *  melody on the note Jev chose, and to keep the bass from jumping octaves. */
export function nearestPc(pc: number, near: number): number {
  const base = Math.round(near)
  let best = base
  let bestDist = Infinity
  for (let m = base - 6; m <= base + 6; m++) {
    if (mod12(m) !== mod12(pc)) continue
    const d = Math.abs(m - base)
    if (d < bestDist) { bestDist = d; best = m }
  }
  return Math.max(21, Math.min(108, best))
}

/**
 * Voice a chord near the previous one. Common tones stay put and the rest move
 * as little as they can. A human pianist does this without thinking about it,
 * and it is the single biggest difference between "a chord generator" and
 * "someone playing" — so it lives in code, like the shape of the keys.
 */
export function voice(chord: Chord, previous: number[], low = 45, high = 67): number[] {
  const centre = previous.length ? previous.reduce((a, b) => a + b, 0) / previous.length : (low + high) / 2
  const notes = chordPcs(chord).map(pc => {
    const candidates: number[] = []
    for (let m = low; m <= high; m++) if (mod12(m) === pc) candidates.push(m)
    if (!candidates.length) return nearestPc(pc, centre)
    // Prefer the octave closest to whichever previous note is nearest this pitch class.
    const target = previous.length
      ? previous.reduce((best, p) => (Math.abs(mod12(p) - pc) < Math.abs(mod12(best) - pc) ? p : best), previous[0])
      : centre
    return candidates.reduce((best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best), candidates[0])
  })
  return [...new Set(notes)].sort((a, b) => a - b)
}

export const midiName = (m: number) => `${NOTE_NAMES[mod12(m)]}${Math.floor(m / 12) - 1}`
export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12)
