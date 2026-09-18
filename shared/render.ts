// Turning a phrase of decisions into notes. Everything here is mechanical:
// which octave a rung falls in, how a chord is voiced against the last one,
// how long a note rings. A pianist does all of this without deciding it.

import { FIGURES, HANDS, REGISTER_BASE, type Cell } from './catalog.ts'
import { MODES, chordPcs, ladder, nearestPc, voice } from './theory.ts'
import type { BarSpec, Piece, PhraseSpec } from './harness.ts'

export interface Note {
  /** beats from the start of the phrase */
  at: number
  /** length in beats */
  beats: number
  midi: number
  velocity: number
  hand: 'left' | 'right'
  bar: number
}

const byId = <T extends { id: string }>(xs: T[], id: string) => xs.find(x => x.id === id)

/** Left-hand voicings walk; they do not leap an octave between bars. */
export interface RenderState { lastVoicing: number[] }

export function renderPhrase(piece: Piece, phrase: PhraseSpec, state: RenderState): Note[] {
  const notes: Note[] = []
  const scalePcs = MODES[piece.mode].steps.map(s => (piece.tonic + s) % 12)

  phrase.bars.forEach((bar: BarSpec, b: number) => {
    const barStart = b * piece.beats
    const isLast = b === phrase.bars.length - 1
    const chord = chordPcs(bar.chord)

    // --- left hand
    const voicing = voice(bar.chord, state.lastVoicing)
    state.lastVoicing = voicing
    const bass = nearestPc(bar.chord.root, 40)
    const hand = byId(HANDS, bar.hand) ?? HANDS[0]
    for (const cell of hand.notes) {
      const v = bar.dynamic * 0.78 * (cell.v ?? 1)
      if (cell.chord) {
        for (const m of voicing) notes.push({ at: barStart + cell.t, beats: cell.d, midi: m, velocity: v * 0.85, hand: 'left', bar: b })
      } else {
        notes.push({ at: barStart + cell.t, beats: cell.d, midi: ladder(chord, bass, cell.c ?? 0), velocity: v, hand: 'left', bar: b })
      }
    }

    // --- right hand
    const figure = byId(FIGURES, bar.figure) ?? FIGURES[0]
    const base = REGISTER_BASE[bar.register] ?? REGISTER_BASE[1]
    const cells: Cell[] = figure.notes
    cells.forEach((cell, i) => {
      const chosen = cell.c !== undefined
        ? ladder(chord, base, cell.c)
        : ladder(scalePcs, base, cell.s ?? 0)
      // The last note of the bar goes to the note Jev chose to rest on.
      const midi = i === cells.length - 1 ? nearestPc(bar.landing, chosen) : chosen
      const last = i === cells.length - 1
      notes.push({
        at: barStart + cell.t,
        // A phrase that comes to rest holds its final note across the bar line.
        beats: last && isLast && phrase.cadence ? cell.d + piece.beats * 0.5 : cell.d,
        midi,
        velocity: Math.min(1, bar.dynamic * (cell.v ?? 1)),
        hand: 'right',
        bar: b,
      })
    })
  })

  return notes.sort((a, b) => a.at - b.at)
}

export const phraseBeats = (piece: Piece, phrase: PhraseSpec) => phrase.bars.length * piece.beats
