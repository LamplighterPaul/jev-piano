import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import {
  MAX_BRIEF, USD_PER_TOKEN, assembleHarmony, assembleMelody, assemblePiece,
  buildHarmonyQuestions, buildMelodyQuestions, buildPieceQuestions, phraseState,
  type Context, type Piece, type Stats,
} from '../shared/harness.ts'
import { chordLabel } from '../shared/theory.ts'
import { ask, live } from './jev.ts'

const app = new Hono()
const PORT = Number(process.env.PORT ?? 8787)
const DAILY_USD_CAP = Number(process.env.DAILY_USD_CAP ?? 2)
const PER_MINUTE = Number(process.env.PER_MINUTE ?? 40)

let day = new Date().toISOString().slice(0, 10)
let spent = 0
let calls = 0

function budget() {
  const today = new Date().toISOString().slice(0, 10)
  if (today !== day) { day = today; spent = 0; calls = 0 }
  if (spent >= DAILY_USD_CAP) throw new Error('The daily budget for this demo is spent. It resets at midnight UTC.')
}

const statsOf = (run: { model: string; ms: number; questions: number; inputTokens: number }): Stats => {
  const usd = run.inputTokens * USD_PER_TOKEN
  spent += usd
  calls++
  return { model: run.model, ms: run.ms, questions: run.questions, inputTokens: run.inputTokens, usd }
}

const fail = (e: unknown) => ({ error: e instanceof Error ? e.message : 'Something went wrong' })

// A public endpoint that spends money needs a lid on it. Counted per minute per
// address, in memory; no address is stored beyond the current minute.
const seen = new Map<string, { minute: number; n: number }>()

function withinRate(c: { req: { header(name: string): string | undefined } }): boolean {
  const ip = (c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local').split(',')[0].trim()
  const minute = Math.floor(Date.now() / 60_000)
  const at = seen.get(ip)
  if (!at || at.minute !== minute) {
    if (seen.size > 5000) seen.clear()
    seen.set(ip, { minute, n: 1 })
    return true
  }
  at.n += 1
  return at.n <= PER_MINUTE
}

app.get('/up', c => c.text('ok'))
app.get('/api/health', c => c.json({ ok: true, jev: live(), calls, spent: Number(spent.toFixed(5)) }))

app.post('/api/piece', async c => {
  try {
    if (!withinRate(c)) return c.json({ error: 'Too many requests in a minute. Give it a moment.' }, 429)
    budget()
    const { brief, seed } = await c.req.json<{ brief?: string; seed?: number }>()
    const text = (brief ?? '').trim().slice(0, MAX_BRIEF)
    if (!text) return c.json({ error: 'Describe something for Jev to play.' }, 400)
    const run = await ask({ brief: text }, buildPieceQuestions())
    const { piece, decisions, refuse } = assemblePiece(text, run.answers, Number(seed) || 0)
    return c.json({ piece, decisions, refuse, stats: statsOf(run) })
  } catch (e) { return c.json(fail(e), 500) }
})

app.post('/api/phrase', async c => {
  try {
    if (!withinRate(c)) return c.json({ error: 'Too many requests in a minute. Give it a moment.' }, 429)
    budget()
    const { piece, context } = await c.req.json<{ piece: Piece; context: Context }>()
    if (!piece?.brief) return c.json({ error: 'No piece in progress.' }, 400)
    const ctx: Context = {
      index: Math.max(0, context?.index ?? 0),
      progression: Array.isArray(context?.progression) ? context.progression.slice(-12) : [],
      motif: context?.motif,
      barsPlayed: Math.max(0, context?.barsPlayed ?? 0),
    }
    // Pass one: the harmony and the shape of the phrase.
    const first = await ask(phraseState(piece, ctx), buildHarmonyQuestions(ctx))
    const { harmony, decisions: harmonyDecisions } = assembleHarmony(ctx, first.answers)
    // Pass two: the melody and the texture, against the harmony Jev just chose.
    const chords = harmony.chords.map(chordLabel)
    const second = await ask(phraseState(piece, ctx, chords), buildMelodyQuestions(piece, ctx, harmony))
    const { phrase, decisions } = assembleMelody(piece, ctx, harmony, second.answers)
    return c.json({
      phrase,
      decisions: [...harmonyDecisions, ...decisions],
      stats: statsOf({
        model: second.model,
        ms: first.ms + second.ms,
        questions: first.questions + second.questions,
        inputTokens: first.inputTokens + second.inputTokens,
      }),
    })
  } catch (e) { return c.json(fail(e), 500) }
})

app.use('/*', serveStatic({ root: './dist' }))
app.get('/*', serveStatic({ path: './dist/index.html' }))

serve({ fetch: app.fetch, port: PORT }, i =>
  console.log(`jev-piano on http://localhost:${i.port}  ${live() ? 'Jev is live' : 'no key: using the random mock'}`))
