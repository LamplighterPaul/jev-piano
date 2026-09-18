// The catalog is everything Jev may choose from. Nothing here is a tune: each
// figure is a shape in rungs and beats, meaningless until a chord and a key
// are chosen for it. Jev supplies all of those.

export interface Cell {
  /** beats from the start of the bar */
  t: number
  /** length in beats */
  d: number
  /** rung of the chord ladder (0 = the lowest chord tone in range) */
  c?: number
  /** rung of the scale ladder, for stepwise motion */
  s?: number
  /** the whole voiced chord at once */
  chord?: boolean
  /** velocity multiplier, for notes that lean or fade */
  v?: number
}

export interface Figure { id: string; about: string; beats: number; notes: Cell[] }

/** Right hand. Written for a four-beat bar and a three-beat bar separately,
 *  because a waltz is not a 4/4 phrase with a beat removed. */
export const FIGURES: Figure[] = [
  { id: 'hold', about: 'one long note, held for the whole bar', beats: 4, notes: [{ t: 0, d: 4, c: 2 }] },
  { id: 'two_halves', about: 'two long notes, one rising to the other', beats: 4, notes: [{ t: 0, d: 2, c: 0 }, { t: 2, d: 2, c: 2 }] },
  { id: 'rise', about: 'a steady climb up through the chord, one note a beat', beats: 4, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 1, c: 1 }, { t: 2, d: 1, c: 2 }, { t: 3, d: 1, c: 3 }] },
  { id: 'fall', about: 'a steady descent down through the chord, one note a beat', beats: 4, notes: [{ t: 0, d: 1, c: 3 }, { t: 1, d: 1, c: 2 }, { t: 2, d: 1, c: 1 }, { t: 3, d: 1, c: 0 }] },
  { id: 'arch', about: 'up and back down again within the bar, a gentle arch', beats: 4, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 1, c: 1 }, { t: 2, d: 1, c: 2 }, { t: 3, d: 1, c: 1 }] },
  { id: 'turn', about: 'a small ornament circling one note, then settling', beats: 4, notes: [{ t: 0, d: 1, s: 2 }, { t: 1, d: 0.5, s: 3 }, { t: 1.5, d: 0.5, s: 1 }, { t: 2, d: 2, s: 2 }] },
  { id: 'run_up', about: 'a quick scale run upward in even eighth notes', beats: 4, notes: Array.from({ length: 8 }, (_, i) => ({ t: i * 0.5, d: 0.5, s: i })) },
  { id: 'run_down', about: 'a quick scale run downward in even eighth notes', beats: 4, notes: Array.from({ length: 8 }, (_, i) => ({ t: i * 0.5, d: 0.5, s: 7 - i })) },
  { id: 'pulse', about: 'the same note repeated on every beat, insistent', beats: 4, notes: [0, 1, 2, 3].map(t => ({ t, d: 0.9, c: 1 })) },
  { id: 'leap', about: 'a wide jump upward, then a slow fall back', beats: 4, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 1, c: 4 }, { t: 2, d: 2, c: 2 }] },
  { id: 'syncopation', about: 'notes pushed off the beat, restless', beats: 4, notes: [{ t: 0.5, d: 1, c: 1 }, { t: 1.5, d: 1, c: 2 }, { t: 3, d: 1, c: 0 }] },
  { id: 'question', about: 'rises and stops on an unsettled note, leaving the phrase open', beats: 4, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 1, c: 1 }, { t: 2, d: 2, s: 5 }] },
  { id: 'answer', about: 'steps down and comes to rest, closing the phrase', beats: 4, notes: [{ t: 0, d: 1, s: 4 }, { t: 1, d: 1, s: 3 }, { t: 2, d: 2, c: 0 }] },
  { id: 'silence', about: 'the right hand says nothing this bar and lets the harmony breathe', beats: 4, notes: [] },

  { id: 'w_hold', about: 'one long note, held across all three beats', beats: 3, notes: [{ t: 0, d: 3, c: 2 }] },
  { id: 'w_rise', about: 'a climb up through the chord, one note a beat', beats: 3, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 1, c: 1 }, { t: 2, d: 1, c: 2 }] },
  { id: 'w_fall', about: 'a descent down through the chord, one note a beat', beats: 3, notes: [{ t: 0, d: 1, c: 2 }, { t: 1, d: 1, c: 1 }, { t: 2, d: 1, c: 0 }] },
  { id: 'w_turn', about: 'a small ornament circling one note, then settling', beats: 3, notes: [{ t: 0, d: 1, s: 2 }, { t: 1, d: 0.5, s: 3 }, { t: 1.5, d: 0.5, s: 1 }, { t: 2, d: 1, s: 2 }] },
  { id: 'w_lean', about: 'a long first beat that leans, then two lighter notes', beats: 3, notes: [{ t: 0, d: 1.5, c: 2, v: 1.15 }, { t: 1.5, d: 0.75, c: 1, v: 0.8 }, { t: 2.25, d: 0.75, c: 0, v: 0.8 }] },
  { id: 'w_leap', about: 'a wide jump upward, then held', beats: 3, notes: [{ t: 0, d: 1, c: 0 }, { t: 1, d: 2, c: 3 }] },
  { id: 'w_run', about: 'a quick scale run in even eighth notes', beats: 3, notes: Array.from({ length: 6 }, (_, i) => ({ t: i * 0.5, d: 0.5, s: i })) },
  { id: 'w_silence', about: 'the right hand says nothing this bar and lets the harmony breathe', beats: 3, notes: [] },
]

export interface Hand { id: string; about: string; beats: number; notes: Cell[] }

/** Left hand. `chord` means the whole voiced chord; `c` picks one rung of it. */
export const HANDS: Hand[] = [
  { id: 'sustained', about: 'the chord struck once and held, still underneath', beats: 4, notes: [{ t: 0, d: 4, chord: true }] },
  { id: 'halves', about: 'the chord struck twice, on the first and third beats', beats: 4, notes: [{ t: 0, d: 2, chord: true }, { t: 2, d: 2, chord: true }] },
  { id: 'quarters', about: 'the chord struck on every beat, steady and plain', beats: 4, notes: [0, 1, 2, 3].map(t => ({ t, d: 0.9, chord: true })) },
  { id: 'alberti', about: 'the classical broken pattern: low, high, middle, high, running underneath', beats: 4, notes: [0, 1, 2, 1, 0, 1, 2, 1].map((c, i) => ({ t: i * 0.5, d: 0.5, c })) },
  { id: 'arpeggio', about: 'the chord spread upward in even notes, flowing', beats: 4, notes: [0, 1, 2, 3, 4, 3, 2, 1].map((c, i) => ({ t: i * 0.5, d: 0.5, c })) },
  { id: 'octaves', about: 'bare root octaves on the strong beats, heavy', beats: 4, notes: [{ t: 0, d: 1, c: 0 }, { t: 0, d: 1, c: 3 }, { t: 2, d: 1, c: 0 }, { t: 2, d: 1, c: 3 }] },
  { id: 'stride', about: 'a low bass note answered by the chord above it, back and forth', beats: 4, notes: [{ t: 0, d: 0.9, c: 0 }, { t: 1, d: 0.9, chord: true, v: 0.7 }, { t: 2, d: 0.9, c: 1 }, { t: 3, d: 0.9, chord: true, v: 0.7 }] },
  { id: 'pedal', about: 'one low root note held alone, no chord at all', beats: 4, notes: [{ t: 0, d: 4, c: 0 }] },
  { id: 'nothing', about: 'the left hand rests and the melody is left bare', beats: 4, notes: [] },

  { id: 'w_oompah', about: 'the waltz pattern: a low bass note, then the chord twice above it', beats: 3, notes: [{ t: 0, d: 0.9, c: 0 }, { t: 1, d: 0.9, chord: true, v: 0.65 }, { t: 2, d: 0.9, chord: true, v: 0.6 }] },
  { id: 'w_sustained', about: 'the chord struck once and held for the whole bar', beats: 3, notes: [{ t: 0, d: 3, chord: true }] },
  { id: 'w_arpeggio', about: 'the chord spread upward, one note a beat', beats: 3, notes: [0, 1, 2].map(c => ({ t: c, d: 1, c }))},
  { id: 'w_pedal', about: 'one low root note held alone', beats: 3, notes: [{ t: 0, d: 3, c: 0 }] },
  { id: 'w_nothing', about: 'the left hand rests and the melody is left bare', beats: 3, notes: [] },
]

export const METERS = { '4/4': 4, '3/4': 3 } as const
export type MeterId = keyof typeof METERS

export const meterCriteria = () => ({
  '4/4': 'four beats in a bar — the ordinary pulse of most songs, marches and ballads',
  '3/4': 'three beats in a bar — a waltz, a lilt, anything that swings in threes',
})

export const TEMPO_LEVELS = [
  'very slow: a still, held air, around 54 beats a minute',
  'slow: unhurried, around 70 beats a minute',
  'walking: an easy steady pace, around 90 beats a minute',
  'flowing: moving along, around 112 beats a minute',
  'brisk: lively, around 138 beats a minute',
  'fast: driving and quick, around 168 beats a minute',
]
export const TEMPO_BPM = [54, 70, 90, 112, 138, 168]

export const DYNAMIC_LEVELS = [
  'very soft: barely touched',
  'soft: quiet and inward',
  'medium: an ordinary singing weight',
  'loud: full and projecting',
  'very loud: the fullest the instrument gives',
]
export const DYNAMIC_VELOCITY = [0.22, 0.36, 0.54, 0.74, 0.95]

export const REGISTER_LEVELS = [
  'low: dark, down near the bass',
  'middle: the natural singing range of the instrument',
  'high: bright and exposed',
  'very high: glassy and thin, like a music box',
]
export const REGISTER_BASE = [55, 62, 69, 76]

export const PHRASE_FUNCTIONS = {
  statement: 'sets out the idea plainly, as an opening',
  answer: 'replies to what came before and balances it',
  build: 'raises the tension and pushes forward',
  resolution: 'settles the tension and comes to rest',
  contrast: 'turns away to something different for a while',
} as const

export const figuresFor = (beats: number) => FIGURES.filter(f => f.beats === beats)
export const handsFor = (beats: number) => HANDS.filter(h => h.beats === beats)
export const criteriaOf = (items: { id: string; about: string }[]) =>
  Object.fromEntries(items.map(i => [i.id, i.about]))
