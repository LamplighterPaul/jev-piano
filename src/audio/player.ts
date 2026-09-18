// Keeps the music ahead of the speaker. A phrase is about ten seconds long and
// a call to Jev takes about one, so the next phrase is always fetched, decided
// and scheduled well before the current one runs out.

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

export class Player {
  private ctx: AudioContext | null = null
  private piano: Piano | null = null
  private timers: number[] = []
  private stopped = true
  private nextStart = 0
  private render: RenderState = { lastVoicing: [] }
  private down = new Map<number, number>()

  private readonly hooks: Hooks

  constructor(hooks: Hooks) { this.hooks = hooks }

  get running() { return !this.stopped }

  async start(brief: string, seed: number) {
    this.stop('stopped')
    this.stopped = false
    this.render = { lastVoicing: [] }
    this.down.clear()

    const ctx = this.ctx ?? new AudioContext()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()
    this.piano = new Piano(ctx)

    let piece: Piece
    try {
      const res = await post<{ piece: Piece; decisions: Decision[]; stats: Stats; refuse?: string; error?: string }>('/api/piece', { brief, seed })
      if (res.error) return this.fail(res.error)
      if (res.refuse) return this.fail(res.refuse)
      piece = res.piece
      this.hooks.onPiece(piece, res.decisions, res.stats)
    } catch (e) {
      return this.fail(e instanceof Error ? e.message : 'Could not reach Jev.')
    }

    const beat = 60 / piece.bpm
    const ctxNow = () => this.ctx?.currentTime ?? 0
    this.nextStart = ctxNow() + 0.35

    const context: Context = { index: 0, progression: [], barsPlayed: 0, seed }

    while (!this.stopped) {
      let played: Played
      try {
        const res = await post<{ phrase: PhraseSpec; decisions: Decision[]; stats: Stats; error?: string }>('/api/phrase', { piece, context })
        if (res.error) return this.fail(res.error)
        played = { ...res, index: context.index, barOffset: context.barsPlayed }
      } catch (e) {
        return this.fail(e instanceof Error ? e.message : 'Could not reach Jev.')
      }
      if (this.stopped) return

      const { phrase } = played
      // If a slow call ate the buffer, pick up from now rather than in the past.
      this.nextStart = Math.max(this.nextStart, ctxNow() + 0.15)
      const start = this.nextStart
      // A phrase is fetched seconds before it is heard. Show it when it sounds,
      // not when it arrives, or the screen runs ahead of the music.
      this.after(start, () => this.hooks.onPhrase(played))
      this.schedule(renderPhrase(piece, phrase, this.render), start, beat, piece.beats, context.barsPlayed, phrase)

      const length = phrase.bars.length * piece.beats * beat
      this.nextStart = start + length

      context.progression = [...context.progression, ...phrase.bars.map(b => b.chordLabel)].slice(-12)
      context.barsPlayed += phrase.bars.length
      context.index += 1
      context.motif ??= phrase.bars[0].figure
      context.role = phrase.next

      if (phrase.end) {
        this.after(this.nextStart + 1.6, () => { this.stopped = true; this.hooks.onFinish('ended') })
        return
      }
      await this.sleepUntil(this.nextStart - LOOKAHEAD)
    }
  }

  private schedule(notes: Note[], start: number, beat: number, beatsPerBar: number, barOffset: number, phrase: PhraseSpec) {
    const piano = this.piano
    if (!piano) return

    for (const n of notes) {
      piano.play(n.midi, start + n.at * beat, Math.max(0.05, n.beats * beat * 0.92), n.velocity)
    }

    // A key is drawn down for exactly as long as it is held, so the keyboard
    // shows what is sounding rather than a fixed flash per onset.
    for (const n of notes) {
      this.after(start + n.at * beat, () => this.press(n.midi, 1))
      this.after(start + (n.at + n.beats) * beat, () => this.press(n.midi, -1))
    }

    phrase.bars.forEach((bar, b) => {
      this.after(start + b * beatsPerBar * beat, () => this.hooks.onBar(barOffset + b, bar, phrase))
    })
  }

  /** Reference counted, because the same key can be struck by both hands. */
  private press(midi: number, delta: number) {
    const n = (this.down.get(midi) ?? 0) + delta
    if (n > 0) this.down.set(midi, n)
    else this.down.delete(midi)
    this.hooks.onKeys([...this.down.keys()])
  }

  private after(audioTime: number, fn: () => void) {
    const ctx = this.ctx
    if (!ctx) return
    const ms = Math.max(0, (audioTime - ctx.currentTime) * 1000)
    this.timers.push(window.setTimeout(fn, ms))
  }

  private sleepUntil(audioTime: number) {
    const ctx = this.ctx
    const ms = ctx ? Math.max(0, (audioTime - ctx.currentTime) * 1000) : 0
    return new Promise<void>(resolve => { this.timers.push(window.setTimeout(resolve, ms)) })
  }

  private fail(message: string) {
    this.stopped = true
    this.hooks.onError(message)
  }

  stop(reason: 'ended' | 'stopped' = 'stopped') {
    const was = !this.stopped
    this.stopped = true
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
    if (this.down.size) { this.down.clear(); this.hooks.onKeys([]) }
    if (this.ctx) { void this.ctx.close(); this.ctx = null; this.piano = null }
    if (was) this.hooks.onFinish(reason)
  }
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return await res.json() as T
}
