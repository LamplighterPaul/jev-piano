// A piano, built out of oscillators. Six partials with a little inharmonicity,
// higher ones decaying faster, a hammer thud at the front and a short room
// around the whole thing. Nothing here is a musical decision: it is the
// instrument, the same way a real piano is already a piano before anyone sits
// down at it.

import { midiHz } from '../../shared/theory.ts'

const PARTIALS = [1, 2, 3, 4, 5, 6]
const PARTIAL_GAIN = [1, 0.4, 0.22, 0.12, 0.07, 0.035]
const INHARMONICITY = 0.00042

/** Low strings ring for a long time; the top of the keyboard barely rings. */
const decayFor = (midi: number) => 14 * Math.pow(0.5, (midi - 24) / 26) + 0.35

function room(ctx: AudioContext, seconds = 1.9): AudioBuffer {
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
  private voices = 0

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.gain.value = 0.32

    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 3
    comp.attack.value = 0.004
    comp.release.value = 0.2

    const verb = ctx.createConvolver()
    verb.buffer = room(ctx)

    this.dry = ctx.createGain()
    this.dry.gain.value = 0.82
    this.wet = ctx.createGain()
    this.wet.gain.value = 0.26

    this.dry.connect(comp)
    this.wet.connect(verb).connect(comp)
    comp.connect(this.out).connect(ctx.destination)
  }

  set volume(v: number) { this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05) }

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
    g.gain.setValueAtTime(0.055 * velocity * velocity, at)
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.055)
    src.connect(bp).connect(g)
    g.connect(this.dry)
    g.connect(this.wet)
    src.start(at)
    src.stop(at + 0.07)
  }

  /** Strike one note. `at` and `hold` are in AudioContext seconds. */
  play(midi: number, at: number, hold: number, velocity: number) {
    if (this.voices > 72) return
    const ctx = this.ctx
    const f = midiHz(midi)
    const v = Math.max(0.03, Math.min(1, velocity))
    const decay = decayFor(midi)
    // A note is damped when it is released, but never abruptly.
    const ring = Math.min(decay, hold + 0.45)
    const end = at + ring + 0.1

    const body = ctx.createGain()
    body.gain.value = 1
    body.connect(this.dry)
    body.connect(this.wet)

    // Harder playing is brighter, not just louder.
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = 900 + 7200 * v * v
    tone.Q.value = 0.4
    tone.connect(body)

    PARTIALS.forEach((n, i) => {
      if (f * n > ctx.sampleRate / 2.2) return
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      // Real strings are stiff, so their overtones sit slightly sharp.
      osc.frequency.value = f * n * Math.sqrt(1 + INHARMONICITY * n * n)
      osc.detune.value = (i % 2 ? 1 : -1) * 1.4

      const g = ctx.createGain()
      const peak = PARTIAL_GAIN[i] * v * (i === 0 ? 1 : 0.55 + 0.45 * v)
      const partialDecay = ring / (1 + 0.62 * i)
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.004)
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.05, partialDecay))

      osc.connect(g).connect(tone)
      osc.start(at)
      osc.stop(end)
      this.voices++
      osc.onended = () => { this.voices-- }
    })

    // The damper coming down at the end of the note.
    body.gain.setValueAtTime(1, at + Math.max(0.02, hold))
    body.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.05, hold) + 0.4)

    this.hammer(at, midi, v)
  }
}
