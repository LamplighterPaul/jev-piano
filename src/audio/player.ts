// Keeps the music ahead of the speaker. A phrase is about ten seconds long and
// a call to Jev takes about one, so the next phrase is always fetched, decided
// and scheduled well before the current one runs out.
//
// Deciding a phrase early and *building its audio nodes* early are two
// different things. Notes land in a queue as soon as Jev decides them, and a
// short-horizon scheduler turns each one into oscillators only just before it
// sounds. Creating a whole phrase's nodes up front left hundreds of oscillators
// sitting in the graph for seconds before they were audible, which pinned the
// render thread and eventually stopped the sound altogether.

import { renderPhrase, type Note, type RenderState } from '../../shared/render.ts'
import type { BarSpec, Context, Decision, Piece, PhraseSpec, Stats } from '../../shared/harness.ts'
import { Piano } from './piano.ts'

export interface Played { phrase: PhraseSpec; decisions: Decision[]; stats: Stats; index: number; barOffset: number }

export interface Hooks {
  onPiece(piece: Piece, decisions: Decision[], stats: Stats): void
  onPhrase(p: Played): void
  onBar(globalBar: number, bar: BarSpec, phrase: PhraseSpec): void
  /** Every key currently sounding, so the drawn keyboard matches the ear. */
  onKeys(midi: number[]): void
  onFinish(reason: 'ended' | 'stopped'): void
  onError(message: string): void
}

/** Wake this long before the current phrase runs out to fetch the next one. */
const LOOKAHEAD = 4
/** How much music has real audio nodes built for it at any moment. */
const SCHEDULE_AHEAD = 0.5
/** How often the scheduler looks at the queue. */
const TICK_MS = 60

interface Pending { at: number; until: number; midi: number; hold: number; velocity: number }

export class Player {
  private ctx: AudioContext | null = null
  private piano: Piano | null = null
  private timers = new Set<number>()
  private stopped = true
  /** Bumped on every start, so a run that is already in flight can tell that it
   *  has been superseded. `stopped` alone cannot: the new run clears it, and the
   *  old loop then reads it as permission to carry on scheduling. */
  private generation = 0
  private nextStart = 0
  private render: RenderState = { lastVoicing: [] }
  private down = new Map<number, number>()
  /** Notes Jev has decided but that are not yet close enough to build. */
  private queue: Pending[] = []
  private ticker: number | null = null
  private keyFrame: number | null = null

  private readonly hooks: Hooks

  constructor(hooks: Hooks) { this.hooks = hooks }

  get running() { return !this.stopped }

  async start(brief: string, seed: number) {
    this.stop('stopped')
    const run = ++this.generation
    const current = () => !this.stopped && run === this.generation
    this.stopped = false
    this.render = { lastVoicing: [] }
    this.down.clear()
    this.queue = []

    const ctx = this.ctx ?? new AudioContext()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    this.piano = new Piano(ctx)

    let piece: Piece
    try {
      const res = await post<{ piece: Piece; decisions: Decision[]; stats: Stats; refuse?: string; error?: string }>('/api/piece', { brief, seed })
      if (res.error) return this.fail(res.error)
      if (res.refuse) return this.fail(res.refuse)
      if (!current()) return
      piece = res.piece
      this.hooks.onPiece(piece, res.decisions, res.stats)
    } catch (e) {
      return this.fail(e instanceof Error ? e.message : 'Could not reach Jev.')
    }

    const beat = 60 / piece.bpm
    const ctxNow = () => this.ctx?.currentTime ?? 0
    this.nextStart = ctxNow() + 0.35

    const context: Context = { index: 0, progression: [], barsPlayed: 0, seed }

    while (current()) {
      let played: Played
      try {
        const res = await post<{ phrase: PhraseSpec; decisions: Decision[]; stats: Stats; error?: string }>('/api/phrase', { piece, context })
        if (res.error) return this.fail(res.error)
        played = { ...res, index: context.index, barOffset: context.barsPlayed }
      } catch (e) {
        return this.fail(e instanceof Error ? e.message : 'Could not reach Jev.')
      }
      if (!current()) return

      const { phrase } = played
      // If a slow call ate the buffer, pick up from now rather than in the past.
      this.nextStart = Math.max(this.nextStart, ctxNow() + 0.15)
      const start = this.nextStart
      // A phrase is fetched seconds before it is heard. Show it when it sounds,
      // not when it arrives, or the screen runs ahead of the music.
      this.after(start, () => this.hooks.onPhrase(played))
      this.enqueue(renderPhrase(piece, phrase, this.render), start, beat, piece.beats, context.barsPlayed, phrase)

      const length = phrase.bars.length * piece.beats * beat
      this.nextStart = start + length

      context.progression = [...context.progression, ...phrase.bars.map(b => b.chordLabel)].slice(-12)
      context.barsPlayed += phrase.bars.length
      context.index += 1
      context.motif ??= phrase.bars[0].figure
      context.role = phrase.next

      if (phrase.end) {
        this.after(this.nextStart + 1.6, () => {
          if (run !== this.generation) return
          this.stopped = true
          this.hooks.onFinish('ended')
        })
        return
      }
      await this.sleepUntil(this.nextStart - LOOKAHEAD)
    }
  }

  /** Decided notes go in the queue; the ticker builds them when they are due. */
  private enqueue(notes: Note[], start: number, beat: number, beatsPerBar: number, barOffset: number, phrase: PhraseSpec) {
    for (const n of notes) {
      this.queue.push({
        at: start + n.at * beat,
        until: start + (n.at + n.beats) * beat,
        midi: n.midi,
        hold: Math.max(0.05, n.beats * beat * 0.92),
        velocity: n.velocity,
      })
    }
    this.queue.sort((a, b) => a.at - b.at)

    phrase.bars.forEach((bar, b) => {
      this.after(start + b * beatsPerBar * beat, () => this.hooks.onBar(barOffset + b, bar, phrase))
    })

    this.runTicker()
  }

  private runTicker() {
    if (this.ticker !== null) return
    const tick = () => {
      this.ticker = null
      const ctx = this.ctx
      const piano = this.piano
      if (this.stopped || !ctx || !piano) return

      const horizon = ctx.currentTime + SCHEDULE_AHEAD
      while (this.queue.length > 0 && this.queue[0].at <= horizon) {
        const n = this.queue.shift()!
        // A key lights up only if the note really sounded, so a note dropped by
        // the polyphony ceiling cannot show as a silent press on the keyboard.
        if (piano.play(n.midi, n.at, n.hold, n.velocity)) {
          this.after(n.at, () => this.press(n.midi, 1))
          this.after(n.until, () => this.press(n.midi, -1))
        }
      }

      if (this.queue.length > 0 || !this.stopped) {
        this.ticker = window.setTimeout(tick, TICK_MS)
      }
    }
    this.ticker = window.setTimeout(tick, 0)
  }

  /** Reference counted, because the same key can be struck by both hands. */
  private press(midi: number, delta: number) {
    const n = (this.down.get(midi) ?? 0) + delta
    if (n > 0) this.down.set(midi, n)
    else this.down.delete(midi)
    // A chord is several presses in the same instant. Telling React about each
    // one separately re-renders the whole keyboard once per note; coalescing to
    // one frame turns a dense passage from dozens of renders into one.
    if (this.keyFrame !== null) return
    this.keyFrame = requestAnimationFrame(() => {
      this.keyFrame = null
      // Sorted, so the same set of notes is always the same array and a
      // consumer can compare cheaply instead of rebuilding a Set.
      this.hooks.onKeys([...this.down.keys()].toSorted((a, b) => a - b))
    })
  }

  /** Every timer forgets itself once it has fired. A long piece schedules two
   *  per note, and a list that only grew held every one of them for the run. */
  private after(audioTime: number, fn: () => void) {
    const ctx = this.ctx
    if (!ctx) return
    const ms = Math.max(0, (audioTime - ctx.currentTime) * 1000)
    const id = window.setTimeout(() => { this.timers.delete(id); fn() }, ms)
    this.timers.add(id)
  }

  private sleepUntil(audioTime: number) {
    const ctx = this.ctx
    const ms = ctx ? Math.max(0, (audioTime - ctx.currentTime) * 1000) : 0
    return new Promise<void>(resolve => {
      const id = window.setTimeout(() => { this.timers.delete(id); resolve() }, ms)
      this.timers.add(id)
    })
  }

  /** A failed run has to let go of the clock and the instrument too, or its
   *  timers keep firing into a piece that is no longer playing. */
  private fail(message: string) {
    this.stopped = true
    this.release()
    this.hooks.onError(message)
  }

  private release() {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
    if (this.ticker !== null) { clearTimeout(this.ticker); this.ticker = null }
    if (this.keyFrame !== null) { cancelAnimationFrame(this.keyFrame); this.keyFrame = null }
    this.queue = []
    if (this.down.size) { this.down.clear(); this.hooks.onKeys([]) }
    if (this.ctx) { void this.ctx.close(); this.ctx = null; this.piano = null }
  }

  stop(reason: 'ended' | 'stopped' = 'stopped') {
    const was = !this.stopped
    this.stopped = true
    this.release()
    if (was) this.hooks.onFinish(reason)
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return await res.json() as T
}
