// Render one phrase without a speaker and check the notes are sane.
import { renderPhrase } from '../shared/render.ts'
import { midiName, chordPcs, mod12 } from '../shared/theory.ts'
import type { Piece, PhraseSpec } from '../shared/harness.ts'

const piece: Piece = { brief: 'test', tonic: 0, mode: 'major', meter: '3/4', beats: 3, bpm: 112 }
const phrase: PhraseSpec = {
  role: 'statement', next: 'answer', cadence: true, restate: false, end: false, endP: 0.1,
  bars: [
    { chord: { root: 0, quality: 'maj' }, chordLabel: 'C', figure: 'w_rise', hand: 'w_oompah', dynamic: 0.54, register: 3, landing: 0 },
    { chord: { root: 0, quality: 'maj' }, chordLabel: 'C', figure: 'w_rise', hand: 'w_oompah', dynamic: 0.54, register: 3, landing: 7 },
    { chord: { root: 7, quality: 'maj' }, chordLabel: 'G', figure: 'w_fall', hand: 'w_oompah', dynamic: 0.54, register: 3, landing: 7 },
    { chord: { root: 0, quality: 'maj' }, chordLabel: 'C', figure: 'w_hold', hand: 'w_oompah', dynamic: 0.54, register: 3, landing: 0 },
  ],
}
const notes = renderPhrase(piece, phrase, { lastVoicing: [] })
let bad = 0
for (const n of notes) {
  const pcs = chordPcs(phrase.bars[n.bar].chord)
  const consonant = pcs.includes(mod12(n.midi))
  const inRange = n.midi >= 21 && n.midi <= 108
  if (!inRange) { bad++; console.log('OUT OF RANGE', n) }
  console.log(`  bar ${n.bar} ${String(n.at).padStart(5)}b  ${n.hand === 'left' ? 'L' : 'R'} ${midiName(n.midi).padEnd(4)} ${n.beats}b v${n.velocity.toFixed(2)}${consonant ? '' : '  (non-chord tone)'}`)
}
const left = notes.filter(n => n.hand === 'left')
const right = notes.filter(n => n.hand === 'right')
console.log(`\n  ${notes.length} notes: ${left.length} left hand, ${right.length} right`)
console.log(`  left hand range  ${midiName(Math.min(...left.map(n => n.midi)))} to ${midiName(Math.max(...left.map(n => n.midi)))}`)
console.log(`  right hand range ${midiName(Math.min(...right.map(n => n.midi)))} to ${midiName(Math.max(...right.map(n => n.midi)))}`)
console.log(`  hands cross: ${Math.max(...left.map(n => n.midi)) > Math.min(...right.map(n => n.midi)) ? 'yes' : 'no'}`)
console.log(`  ${bad} notes out of range`)
