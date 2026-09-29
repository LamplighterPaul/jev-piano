import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import {
  BARS_PER_PHRASE, MAX_BRIEF, MAX_PHRASES, USD_PER_TOKEN, assembleHarmony, assembleMelody, assemblePiece,
  buildHarmonyQuestions, buildMelodyQuestions, buildPieceQuestions, phraseState,
  type Context, type Piece, type Stats,
} from '../shared/harness.ts'
import { FIGURES, METERS, PHRASE_FUNCTIONS, TEMPO_BPM } from '../shared/catalog.ts'
import { CHORD_BY_LABEL, MODES, chordLabel } from '../shared/theory.ts'
import { ask, keyCount, live } from './jev.ts'

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

// The piece travels through the browser between calls, and its brief goes to
// Jev as part of every phrase. Only /api/piece asks whether a brief is safe to
// play, so the piece comes back signed and a phrase is only made for a piece
// this server settled. Without PIECE_SECRET a key is made up at start, which
// is fine for one process: a restart only ends the pieces already playing.
const SECRET = process.env.PIECE_SECRET || randomBytes(32).toString('hex')

const canonical = (p: Piece) => JSON.stringify([p.brief, p.tonic, p.mode, p.meter, p.beats, p.bpm])
const sign = (p: Piece) => createHmac('sha256', SECRET).update(canonical(p)).digest('base64url')

function signed(p: unknown, sig: unknown): Piece | undefined {
  if (!p || typeof p !== 'object' || typeof sig !== 'string') return undefined
  const q = p as Piece
  // Checked against the catalog as well as the signature, so a piece that is
  // somehow malformed fails as a 400 here rather than as a 500 further in.
  if (typeof q.brief !== 'string' || !q.brief || q.brief.length > MAX_BRIEF) return undefined
  if (!Number.isInteger(q.tonic) || q.tonic < 0 || q.tonic > 11) return undefined
  if (!(q.mode in MODES) || !(q.meter in METERS) || q.beats !== METERS[q.meter]) return undefined
  if (!TEMPO_BPM.includes(q.bpm)) return undefined
  const piece: Piece = { brief: q.brief, tonic: q.tonic, mode: q.mode, meter: q.meter, beats: q.beats, bpm: q.bpm }
  const want = Buffer.from(sign(piece))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got) ? piece : undefined
}

const count = (n: unknown, max: number) => Math.min(max, Math.max(0, Math.trunc(Number(n) || 0)))

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
app.get('/api/health', c => c.json({ ok: true, jev: live(), keys: keyCount(), calls, spent: Number(spent.toFixed(5)) }))

app.post('/api/piece', async c => {
  try {
    if (!withinRate(c)) return c.json({ error: 'Too many requests in a minute. Give it a moment.' }, 429)
    budget()
    const { brief, seed } = await c.req.json<{ brief?: string; seed?: number }>()
    const text = (brief ?? '').trim().slice(0, MAX_BRIEF)
    if (!text) return c.json({ error: 'Describe something for Jev to play.' }, 400)
    const run = await ask({ brief: text }, buildPieceQuestions())
    const { piece, decisions, refuse } = assemblePiece(text, run.answers, Number(seed) || 0)
    return c.json({ piece, sig: refuse ? undefined : sign(piece), decisions, refuse, stats: statsOf(run) })
  } catch (e) { return c.json(fail(e), 500) }
})

app.post('/api/phrase', async c => {
  try {
    if (!withinRate(c)) return c.json({ error: 'Too many requests in a minute. Give it a moment.' }, 429)
    budget()
    const body = await c.req.json<{ piece: Piece; sig: string; context: Context }>()
    const piece = signed(body.piece, body.sig)
    if (!piece) return c.json({ error: 'That piece is no longer in progress. Press play to start again.' }, 400)
    const context = body.context
    // Everything here reaches Jev as the text of a prompt, and the client can
    // say anything, so each field is checked against the catalog it came from.
    const ctx: Context = {
      index: count(context?.index, MAX_PHRASES),
      progression: Array.isArray(context?.progression)
        ? context.progression.filter(label => typeof label === 'string' && label in CHORD_BY_LABEL).slice(-12)
        : [],
      motif: FIGURES.some(f => f.id === context?.motif) ? context.motif : undefined,
      barsPlayed: count(context?.barsPlayed, MAX_PHRASES * BARS_PER_PHRASE),
      // Without the seed, sampled() falls back to Jev's argmax for every
      // chord, figure, hand, landing note, dynamic and register, so a piece
      // never varies once the key is chosen.
      seed: count(context?.seed, Number.MAX_SAFE_INTEGER),
      // Without the role, every phrase is told it is the opening, so nothing
      // plans ahead and the harmony settles onto the tonic and stays there.
      role: typeof context?.role === 'string' && context.role in PHRASE_FUNCTIONS
        ? context.role
        : undefined,
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
