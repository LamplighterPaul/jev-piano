// A piece, kept. Everything Jev decided is already in the phrase specs, and
// turning those into notes is mechanical, so a recording holds decisions and
// not audio: replaying it plays the same notes without asking Jev anything.

import { renderPhrase, type Note } from './render.ts'
import {
  BARS_PER_PHRASE, MAX_BRIEF, MAX_PHRASES,
  type Decision, type Piece, type PhraseSpec, type Stats,
} from './harness.ts'
import {
  DYNAMIC_VELOCITY, FIGURES, HANDS, METERS, PHRASE_FUNCTIONS, REGISTER_LEVELS, TEMPO_BPM,
  type MeterId,
} from './catalog.ts'
import { CHORD_BY_LABEL, MODES, type ModeId } from './theory.ts'

export interface Take { phrase: PhraseSpec; decisions: Decision[]; stats: Stats }

export interface Recording {
  v: 1
  /** When it was played, which is also how history tells two pieces apart. */
  when: number
  seed: number
  piece: Piece
  decisions: Decision[]
  stats: Stats
  phrases: Take[]
}

/** The phrases as they should be played back. A piece that was stopped
 *  part way never reached a phrase that ended it, so its last one does. */
export const takesOf = (rec: Recording): Take[] => rec.phrases.map((t, i) =>
  i === rec.phrases.length - 1 && !t.phrase.end ? { ...t, phrase: { ...t.phrase, end: true } } : t)

/** Every note of the piece, in beats from its first bar. */
export function notesOf(rec: Recording): Note[] {
  const state = { lastVoicing: [] as number[] }
  const out: Note[] = []
  let offset = 0
  for (const { phrase } of takesOf(rec)) {
    for (const n of renderPhrase(rec.piece, phrase, state)) out.push({ ...n, at: n.at + offset })
    offset += phrase.bars.length * rec.piece.beats
  }
  return out
}

export const barsOf = (rec: Recording) => rec.phrases.reduce((n, t) => n + t.phrase.bars.length, 0)
export const secondsOf = (rec: Recording) => (barsOf(rec) * rec.piece.beats * 60) / rec.piece.bpm

/** What history keeps. The interface never shows more than sixteen options
 *  for a decision, and the long tail of a 36-chord field is all zeros. */
export function compact(rec: Recording): Recording {
  return { ...rec, decisions: slim(rec.decisions), phrases: rec.phrases.map(t => ({ ...t, decisions: slim(t.decisions) })) }
}

const slim = (ds: Decision[]) => ds.map(d => ({
  ...d, options: d.options.slice(0, 16).map(o => ({ key: o.key, p: Math.round(o.p * 1e4) / 1e4 })),
}))

// --- sharing, in a link ---------------------------------------------------
//
// A link carries the music and not the reasoning: the piece, and for every bar
// the chord, the shape, the hand, the weight, the height and the resting note.
// That is a few hundred bytes compressed, where the distributions would be tens
// of kilobytes. Someone opening the link hears exactly the same piece.

type SharedBar = [chord: string, figure: string, hand: string, dynamic: number, register: number, landing: number]
type SharedPhrase = [role: string, next: string, flags: number, bars: SharedBar[]]
interface Shared { v: 1; b: string; k: [tonic: number, mode: string, meter: string, bpm: number]; p: SharedPhrase[] }

const CADENCE = 1
const RESTATE = 2
const END = 4

export async function toLink(rec: Recording): Promise<string> {
  const { piece } = rec
  const shared: Shared = {
    v: 1,
    b: piece.brief,
    k: [piece.tonic, piece.mode, piece.meter, piece.bpm],
    p: rec.phrases.map(({ phrase: p }) => [
      p.role, p.next,
      (p.cadence ? CADENCE : 0) | (p.restate ? RESTATE : 0) | (p.end ? END : 0),
      p.bars.map(b => [b.chordLabel, b.figure, b.hand, DYNAMIC_VELOCITY.indexOf(b.dynamic), b.register, b.landing]),
    ]),
  }
  return base64url(await squeeze(new TextEncoder().encode(JSON.stringify(shared)), 'compress'))
}

/** A link is anybody's text, so every field is checked against the catalog
 *  and anything that does not fit is refused outright rather than repaired. */
export async function fromLink(text: string): Promise<Recording | undefined> {
  try {
    const raw = JSON.parse(new TextDecoder().decode(await squeeze(unbase64url(text), 'decompress'))) as Shared
    if (raw?.v !== 1 || typeof raw.b !== 'string' || !raw.b.trim() || raw.b.length > MAX_BRIEF) return undefined
    const [tonic, mode, meter, bpm] = raw.k ?? []
    if (!Number.isInteger(tonic) || tonic < 0 || tonic > 11) return undefined
    if (!(mode in MODES) || !(meter in METERS) || !TEMPO_BPM.includes(bpm)) return undefined
    const beats = METERS[meter as MeterId]
    const piece: Piece = { brief: raw.b, tonic, mode: mode as ModeId, meter: meter as MeterId, beats, bpm }

    if (!Array.isArray(raw.p) || !raw.p.length || raw.p.length > MAX_PHRASES) return undefined
    const fits = (id: unknown, list: { id: string; beats: number }[]) => list.some(x => x.id === id && x.beats === beats)

    const phrases: Take[] = []
    for (const p of raw.p) {
      if (!Array.isArray(p) || p.length !== 4) return undefined
      const [role, next, flags, bars] = p
      if (!(role in PHRASE_FUNCTIONS) || !(next in PHRASE_FUNCTIONS) || !Number.isInteger(flags)) return undefined
      if (!Array.isArray(bars) || !bars.length || bars.length > BARS_PER_PHRASE) return undefined
      const specs = []
      for (const b of bars) {
        if (!Array.isArray(b) || b.length !== 6) return undefined
        const [label, figure, hand, dynamic, register, landing] = b
        const chord = CHORD_BY_LABEL[label]
        const d = index(dynamic, DYNAMIC_VELOCITY.length)
        const r = index(register, REGISTER_LEVELS.length)
        const l = index(landing, 12)
        if (!chord || !fits(figure, FIGURES) || !fits(hand, HANDS) || d === undefined || r === undefined || l === undefined) return undefined
        specs.push({ chord, chordLabel: label, figure, hand, dynamic: DYNAMIC_VELOCITY[d], register: r, landing: l })
      }
      const end = (flags & END) !== 0
      phrases.push({
        phrase: { bars: specs, role, next, cadence: (flags & CADENCE) !== 0, restate: (flags & RESTATE) !== 0, end, endP: end ? 1 : 0 },
        decisions: [],
        stats: NO_STATS,
      })
    }
    return { v: 1, when: 0, seed: 0, piece, decisions: [], stats: NO_STATS, phrases }
  } catch {
    return undefined
  }
}

const index = (n: unknown, length: number) =>
  (Number.isInteger(n) && (n as number) >= 0 && (n as number) < length ? n as number : undefined)

const NO_STATS: Stats = { model: 'shared', ms: 0, questions: 0, inputTokens: 0, usd: 0 }

async function squeeze(bytes: Uint8Array<ArrayBuffer>, way: 'compress' | 'decompress'): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(
    way === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function base64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unbase64url(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
