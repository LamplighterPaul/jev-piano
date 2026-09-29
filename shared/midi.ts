// A recording as a Standard MIDI File, so a piece can go into anything that
// reads one. Format 1: a conductor track with the tempo, metre, key and the
// brief as its name, then one track per hand.

import { notesOf, type Recording } from './recording.ts'
import { MODES } from './theory.ts'

const PPQ = 480

export function toMidi(rec: Recording): Uint8Array<ArrayBuffer> {
  const { piece } = rec
  const notes = notesOf(rec)

  const conductor: Event[] = [
    { tick: 0, bytes: meta(0x03, new TextEncoder().encode(piece.brief)) },
    { tick: 0, bytes: meta(0x51, [...be(Math.round(60_000_000 / piece.bpm), 3)]) },
    // The denominator is a power of two: 2 means a quarter note gets the beat.
    { tick: 0, bytes: meta(0x58, [piece.beats, 2, 24, 8]) },
    { tick: 0, bytes: meta(0x59, keySignature(piece.tonic, piece.mode)) },
  ]

  const hand = (which: 'right' | 'left', channel: number): Event[] => {
    const events: Event[] = [
      { tick: 0, bytes: meta(0x03, new TextEncoder().encode(which === 'right' ? 'Right hand' : 'Left hand')) },
      { tick: 0, bytes: [0xc0 | channel, 0] }, // acoustic grand
    ]
    for (const n of notes) {
      if (n.hand !== which) continue
      const on = Math.round(n.at * PPQ)
      // Held for the same share of its length the player holds it for.
      const off = on + Math.max(1, Math.round(n.beats * 0.92 * PPQ))
      const velocity = Math.max(1, Math.min(127, Math.round(n.velocity * 127)))
      events.push({ tick: on, bytes: [0x90 | channel, n.midi, velocity] })
      events.push({ tick: off, bytes: [0x80 | channel, n.midi, 0] })
    }
    return events
  }

  const tracks = [conductor, hand('right', 0), hand('left', 1)].map(track)
  const header = [...ascii('MThd'), ...be(6, 4), ...be(1, 2), ...be(tracks.length, 2), ...be(PPQ, 2)]
  const out = new Uint8Array(new ArrayBuffer(header.length + tracks.reduce((n, t) => n + t.length, 0)))
  out.set(header, 0)
  let at = header.length
  for (const t of tracks) { out.set(t, at); at += t.length }
  return out
}

interface Event { tick: number; bytes: number[] }

function track(events: Event[]): number[] {
  // A note that ends on the tick another begins has to let go first, or a
  // repeated key is released straight after it is struck.
  const ordered = events
    .map((e, i) => ({ ...e, i, off: (e.bytes[0] & 0xf0) === 0x80 ? 0 : 1 }))
    .toSorted((a, b) => a.tick - b.tick || a.off - b.off || a.i - b.i)
  const body: number[] = []
  let last = 0
  for (const e of ordered) {
    body.push(...vlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  body.push(0, 0xff, 0x2f, 0) // end of track
  return [...ascii('MTrk'), ...be(body.length, 4), ...body]
}

const meta = (type: number, data: ArrayLike<number>) => [0xff, type, ...vlq(data.length), ...Array.from(data)]
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const be = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * (bytes - 1 - i))) & 0xff)

function vlq(n: number): number[] {
  const out = [n & 0x7f]
  while ((n >>>= 7) > 0) out.unshift((n & 0x7f) | 0x80)
  return out
}

/** Sharps or flats, read off the major scale that shares this one's notes.
 *  A mode is a major scale started somewhere else, so dorian on D is written
 *  with C major's signature. Harmonic minor is not, and takes the natural
 *  minor's, the way it is written on paper. */
function keySignature(tonic: number, mode: keyof typeof MODES): number[] {
  const scale = mode === 'harmonic_minor' ? MODES.minor.steps : MODES[mode].steps
  const pcs = new Set(scale.map(s => (tonic + s) % 12))
  const major = Array.from({ length: 12 }, (_, k) => k)
    .find(k => MODES.major.steps.every(s => pcs.has((k + s) % 12))) ?? 0
  // Around the circle of fifths, written with flats past six o'clock, the same
  // way the note names in this program are spelled.
  const fifths = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5][major]
  const minor = mode === 'minor' || mode === 'harmonic_minor'
  return [fifths & 0xff, minor ? 1 : 0]
}
