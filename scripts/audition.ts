// Play a piece to the terminal instead of to a speaker. The fastest way to
// hear whether Jev is making musical sense:
//   ./scripts/with-key.sh node scripts/audition.ts "a sad waltz"

import { MODES, NOTE_NAMES, chordLabel, chordPcs } from '../shared/theory.ts'
import {
  BARS_PER_PHRASE, USD_PER_TOKEN, assembleHarmony, assembleMelody, assemblePiece,
  buildHarmonyQuestions, buildMelodyQuestions, buildPieceQuestions, phraseState, type Context,
} from '../shared/harness.ts'
import { ask, live } from '../server/jev.ts'

const brief = process.argv.slice(2).join(' ') || 'a slow, sad waltz'
const phrases = Number(process.env.PHRASES ?? 4)
const seed = Number(process.env.SEED ?? 1)

if (!live()) {
  console.error('No TYPESAFE_API_KEY, so this would only print random noise.\nRun it as: ./scripts/with-key.sh node scripts/audition.ts "a sad waltz"')
  process.exit(1)
}

const meter = (p: number, w = 22) => '█'.repeat(Math.round(p * w)).padEnd(w, '·')

const setup = await ask({ brief }, buildPieceQuestions())
const { piece, decisions: pieceDecisions, refuse } = assemblePiece(brief, setup.answers)
if (refuse) { console.log(`\n  ${refuse}\n`); process.exit(0) }

console.log(`\n  "${brief}"   seed ${seed}`)
console.log(`  ${NOTE_NAMES[piece.tonic]} ${piece.mode.replace('_', ' ')} · ${piece.meter} · ${piece.bpm} bpm`)
console.log(`  scale: ${MODES[piece.mode].steps.map(s => NOTE_NAMES[(piece.tonic + s) % 12]).join(' ')}`)
for (const d of pieceDecisions) {
  console.log(`    ${d.label.padEnd(16)} ${String(d.picked).padEnd(14)} ${d.options.slice(0, 4).map(o => `${o.key} ${(o.p * 100).toFixed(0)}%`).join('  ')}`)
}

const scalePcs = new Set(MODES[piece.mode].steps.map(s => (piece.tonic + s) % 12))
const ctx: Context = { index: 0, progression: [], barsPlayed: 0, seed }
let tokens = setup.inputTokens
let ms = setup.ms
let inKey = 0
let total = 0
const figuresUsed = new Set<string>()
const handsUsed = new Set<string>()
const landings = new Set<number>()

for (let i = 0; i < phrases; i++) {
  const first = await ask(phraseState(piece, ctx), buildHarmonyQuestions(ctx))
  const { harmony, decisions: hd } = assembleHarmony(ctx, first.answers)
  const chords = harmony.chords.map(chordLabel)
  const second = await ask(phraseState(piece, ctx, chords), buildMelodyQuestions(piece, ctx, harmony))
  const { phrase } = assembleMelody(piece, ctx, harmony, second.answers)
  tokens += first.inputTokens + second.inputTokens
  ms += first.ms + second.ms

  const tags = [phrase.role, phrase.cadence && 'coming to rest', phrase.restate && 'opening idea returns'].filter(Boolean).join(', ')
  console.log(`\n  Phrase ${i + 1} — ${tags}   [${first.questions + second.questions} questions, ${first.ms + second.ms} ms]`)
  for (const b of phrase.bars) {
    const ok = scalePcs.has(b.chord.root)
    total++
    if (ok) inKey++
    figuresUsed.add(b.figure); handsUsed.add(b.hand); landings.add(b.landing)
    console.log(`    ${b.chordLabel.padEnd(5)}${ok ? ' ' : '*'} ${b.figure.padEnd(13)} ${b.hand.padEnd(13)} rest on ${NOTE_NAMES[b.landing].padEnd(3)}${scalePcs.has(b.landing) || chordPcs(b.chord).includes(b.landing) ? " " : "*"} ${['low', 'middle', 'high', 'very high'][b.register]}`)
  }
  if (i === 0) {
    const d = hd.find(x => x.id === 'bar1.chord')
    if (d) {
      console.log(`\n    bar 1 — where Jev put its weight across all ${d.options.length} chords it was offered:`)
      for (const o of d.options.slice(0, 6)) {
        const root = NOTE_NAMES.indexOf(o.key.replace(/[m7]/g, '') as (typeof NOTE_NAMES)[number])
        console.log(`      ${o.key.padEnd(5)}${scalePcs.has(root) ? ' ' : '*'} ${meter(o.p)} ${(o.p * 100).toFixed(1)}%`)
      }
    }
  }

  ctx.progression.push(...chords)
  ctx.barsPlayed += BARS_PER_PHRASE
  ctx.index++
  if (!ctx.motif) ctx.motif = phrase.bars[0].figure
  ctx.role = phrase.next
  if (phrase.end) { console.log('\n  Jev decided the piece was finished.'); break }
}

console.log(`\n  ${inKey}/${total} chords rooted in the key (* marks one that is not)`)
console.log(`  variety: ${figuresUsed.size} melodic shapes, ${handsUsed.size} left-hand patterns, ${landings.size} resting notes`)
console.log(`  ${ms} ms, ${tokens} input tokens, $${(tokens * USD_PER_TOKEN).toFixed(5)}\n`)
