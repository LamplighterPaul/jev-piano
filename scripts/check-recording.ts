// Check that a recording survives the two ways it leaves the page: as a MIDI
// file, and as a link. No key and no speaker needed.
//   node scripts/check-recording.ts

import { toMidi } from '../shared/midi.ts'
import { fromLink, notesOf, toLink, type Recording } from '../shared/recording.ts'
import { renderPhrase } from '../shared/render.ts'
import type { PhraseSpec } from '../shared/harness.ts'

const stats = { model: 'test', ms: 0, questions: 1, inputTokens: 0, usd: 0 }
const bar = (root: number, quality: 'maj' | 'min' | 'dom7', label: string, landing: number) =>
  ({ chord: { root, quality }, chordLabel: label, figure: 'w_rise', hand: 'w_oompah', dynamic: 0.54, register: 2, landing })
const phrase = (end: boolean): PhraseSpec => ({
  role: 'statement', next: 'answer', cadence: true, restate: false, end, endP: end ? 0.9 : 0.1,
  bars: [bar(0, 'min', 'Cm', 0), bar(5, 'min', 'Fm', 5), bar(7, 'dom7', 'G7', 11), bar(0, 'min', 'Cm', 0)],
})
const rec: Recording = {
  v: 1, when: 1, seed: 7, stats, decisions: [],
  piece: { brief: 'a slow, sad waltz', tonic: 0, mode: 'minor', meter: '3/4', beats: 3, bpm: 70 },
  phrases: [{ phrase: phrase(false), decisions: [], stats }, { phrase: phrase(true), decisions: [], stats }],
}

let failed = 0
const check = (what: string, ok: boolean) => { if (!ok) failed++; console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`) }

// --- MIDI: read back what was written
const notes = notesOf(rec)
const midi = toMidi(rec)
const text = (at: number, n: number) => String.fromCharCode(...midi.slice(at, at + n))
check('starts with an MThd header', text(0, 4) === 'MThd')
const tracks = (midi[10] << 8) | midi[11]
check('has a conductor track and one per hand', tracks === 3)

let at = 14
let ons = 0
let tempo = 0
let sig = ''
for (let t = 0; t < tracks; t++) {
  check(`track ${t} is an MTrk`, text(at, 4) === 'MTrk')
  const length = (midi[at + 4] << 24) | (midi[at + 5] << 16) | (midi[at + 6] << 8) | midi[at + 7]
  let i = at + 8
  const end = i + length
  const vlq = () => { let n = 0; let b; do { b = midi[i++]; n = (n << 7) | (b & 0x7f) } while (b & 0x80); return n }
  while (i < end) {
    vlq()
    const status = midi[i++]
    if (status === 0xff) {
      const type = midi[i++]
      const n = vlq()
      if (type === 0x51) tempo = (midi[i] << 16) | (midi[i + 1] << 8) | midi[i + 2]
      if (type === 0x58) sig = `${midi[i]}/${2 ** midi[i + 1]}`
      i += n
    } else if ((status & 0xf0) === 0xc0) i += 1
    else { if ((status & 0xf0) === 0x90) ons++; i += 2 }
  }
  check(`track ${t} ends exactly where its length says`, i === end)
  at = end
}
check(`one note-on for each of the ${notes.length} notes (${ons})`, ons === notes.length)
check(`tempo is 70 bpm (${Math.round(60_000_000 / tempo)})`, Math.round(60_000_000 / tempo) === 70)
check(`metre is 3/4 (${sig})`, sig === '3/4')

// --- the last chord rings past the end of the piece
const last = renderPhrase(rec.piece, phrase(true), { lastVoicing: [] })
const through = Math.max(...last.map(n => n.at + n.beats))
check(`an ending phrase rings a bar past its last beat (${through} beats of 12)`, through >= 15)

// --- a link: same notes back, and rubbish refused
const link = await toLink(rec)
const back = await fromLink(link)
check(`a link is short (${link.length} characters)`, link.length < 600)
check('a link replays the same notes', JSON.stringify(back && notesOf(back)) === JSON.stringify(notes))
check('a link that is not one is refused', (await fromLink('not-a-link')) === undefined)
const tampered = JSON.parse(JSON.stringify(rec)) as Recording
tampered.phrases[0].phrase.bars[0].figure = 'hold' // a 4/4 figure in a waltz
check('a figure from the wrong metre is refused', (await fromLink(await toLink(tampered))) === undefined)

console.log(failed ? `\n  ${failed} failed` : '\n  all good')
process.exit(failed ? 1 : 0)
