// A piano, built out of oscillators. One oscillator per note carries the whole
// harmonic spectrum as a PeriodicWave, and a closing lowpass takes the upper
// partials away first, the way a real string loses its brightness before it
// loses its pitch. Nothing here is a musical decision: it is the instrument,
// the same way a real piano is already a piano before anyone sits down at it.
//
// This used to be six separate sine oscillators per note, each with its own
// gain envelope: fourteen nodes a note. It sounded much the same and cost six
// times as much, which a fast piece cannot afford.

import { midiHz } from '../../shared/theory.ts'

/** Relative strength of each harmonic, fundamental first. */
const PARTIAL_GAIN = [1, 0.4, 0.22, 0.12, 0.07, 0.035]

/** Low strings ring for a long time; the top of the keyboard barely rings. */
const decayFor = (midi: number) => 14 * Math.pow(0.5, (midi - 24) / 26) + 0.35

/** Notes allowed to sound at once. Three nodes each, so this is a real ceiling. */
const MAX_VOICES = 32

/** Set localStorage.jevPianoDebug = "1" to log live node counts. A number that
 *  climbs means a leak; one that sits flat while a piece plays means the graph
 *  is being returned properly. */
const DEBUG = typeof window !== 'undefined' && window.localStorage?.getItem('jevPianoDebug') === '1'

function room(ctx: AudioContext, seconds = 1.6): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) {
      const t = i / n
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (1 - Math.exp(-i / 400))
    }
  }
  return buffer
}

export class Piano {
  readonly ctx: AudioContext
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly out: GainNode
  private noise: AudioBuffer | null = null
  /** The harmonic spectrum, built once and shared by every note. */
  private wave: PeriodicWave | null = null
  /** End times of notes already scheduled, so the polyphony limit counts notes
   *  that overlap in the music rather than notes handed over at the same moment. */
  private ringing: number[] = []

  private liveNodes = 0
  private notesPlayed = 0
  private notesDropped = 0
  private lastLog = 0

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.34

    // A chord is several notes at once, so the bus has to survive more than
    // one note's worth of signal. Gentle compression for glue, then a hard
    // limiter as an actual ceiling: a soft-knee compressor on its own distorts
    // when it is fed far past its threshold, which is the crackle.
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -24
    comp.ratio.value = 4
    comp.attack.value = 0.003
    comp.release.value = 0.15

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.001
    limiter.release.value = 0.1

    const verb = ctx.createConvolver()
    verb.buffer = room(ctx)

    this.dry = ctx.createGain()
    this.dry.gain.value = 0.82
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.24

    this.dry.connect(comp)
    this.wet.connect(verb).connect(comp)
    comp.connect(limiter).connect(this.out).connect(ctx.destination)
  }

  set volume(v: number) { this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05) }

  /** How many notes are sounding, and how much graph is alive. */
  get stats() {
    return { nodes: this.liveNodes, played: this.notesPlayed, dropped: this.notesDropped, voices: this.ringing.length }
  }

  private track(delta: number) {
    if (!DEBUG) return
    this.liveNodes += delta
    const now = this.ctx.currentTime
    if (now - this.lastLog > 1) {
      this.lastLog = now
      const s = this.stats
      console.log(`[piano] nodes=${s.nodes} voices=${s.voices} played=${s.played} dropped=${s.dropped}`)
    }
  }

  private spectrum(): PeriodicWave {
    if (this.wave) return this.wave
    const real = new Float32Array(PARTIAL_GAIN.length + 1)
    const imag = new Float32Array(PARTIAL_GAIN.length + 1)
    PARTIAL_GAIN.forEach((g, i) => { imag[i + 1] = g })
    // Normalised, so peak amplitude is 1 whatever the harmonic mix.
    this.wave = this.ctx.createPeriodicWave(real, imag)
    return this.wave
  }

  private hammer(at: number, midi: number, velocity: number) {
    const ctx = this.ctx
    if (!this.noise) {
      const n = Math.floor(ctx.sampleRate * 0.06)
      const buffer = ctx.createBuffer(1, n, ctx.sampleRate)
      const data = buffer.getChannelData(0)
      for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 5)
      this.noise = buffer
    }
    const src = ctx.createBufferSource()
    src.buffer = this.noise
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = Math.min(6000, midiHz(midi) * 3.2)
    bp.Q.value = 0.8
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.05 * velocity * velocity, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.055)
    src.connect(bp).connect(g)
    g.connect(this.dry)
    g.connect(this.wet)
    src.start(at)
    src.stop(at + 0.07)
    this.track(3)
    // Every node has to leave the graph once it has stopped, or a long piece
    // drags thousands of dead nodes behind it for the render thread to walk.
    src.addEventListener('ended', () => {
      src.disconnect(); bp.disconnect(); g.disconnect(); this.track(-3)
    }, { once: true })
  }

  /** Strike one note. `at` and `hold` are in AudioContext seconds. Returns
   *  false when the polyphony ceiling turned the note away, so the caller can
   *  keep the drawn keyboard honest about what is actually sounding. */
  play(midi: number, at: number, hold: number, velocity: number): boolean {
    const ctx = this.ctx
    // A late scheduler tick can hand over a time that has just passed. Web
    // Audio would start it immediately anyway, but the envelopes need a
    // present-or-future anchor to ramp from.
    const t = Math.max(at, ctx.currentTime)
    const v = Math.max(0.03, Math.min(1, velocity))
    const f = midiHz(midi)
    const ring = Math.min(decayFor(midi), hold + 0.45)
    const end = t + ring + 0.08

    this.ringing = this.ringing.filter(e => e > t)
    if (this.ringing.length >= MAX_VOICES) { this.notesDropped++; return false }
    this.ringing.push(end)
    this.notesPlayed++

    const osc = ctx.createOscillator()
    osc.setPeriodicWave(this.spectrum())
    osc.frequency.value = f
    // Real strings are never in perfect unison with each other.
    osc.detune.value = (Math.random() * 2 - 1) * 2.5

    // Harder playing is brighter, and the brightness goes before the pitch does.
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.Q.value = 0.5
    const open = Math.min(11000, f * 5 + 700 + 6500 * v * v)
    const shut = Math.max(320, f * 1.7)
    tone.frequency.setValueAtTime(open, t)
    tone.frequency.exponentialRampToValueAtTime(shut, t + Math.min(ring, 1.1))

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.82 * v), t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.05, ring))

    osc.connect(tone).connect(g)
    g.connect(this.dry)
    g.connect(this.wet)
    osc.start(t)
    osc.stop(end)
    this.track(3)
    osc.addEventListener('ended', () => {
      osc.disconnect(); tone.disconnect(); g.disconnect(); this.track(-3)
    }, { once: true })

    this.hammer(t, midi, v)
    return true
  }
}
