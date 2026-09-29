import { useCallback, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react'
import { MODES, NOTE_NAMES, chordPcs, mod12 } from '../shared/theory.ts'
import { DYNAMIC_LEVELS, DYNAMIC_VELOCITY, REGISTER_LEVELS } from '../shared/catalog.ts'
import type { BarSpec, Decision, Piece, PhraseSpec, Stats } from '../shared/harness.ts'
import { Player, type Played } from './audio/player.ts'

const SUGGESTIONS = [
  'a slow, sad waltz',
  'a bright music box tune',
  'rain on a window at 3am',
  'something triumphant',
  'a lullaby in an empty house',
  'nervous, and speeding up',
]

interface Line { n: number; role: string; chords: string; tags: string }

export function App() {
  const [brief, setBrief] = useState('')
  const [piece, setPiece] = useState<Piece | null>(null)
  const [pieceDecisions, setPieceDecisions] = useState<Decision[]>([])
  const [phrase, setPhrase] = useState<{ spec: PhraseSpec; barOffset: number; n: number } | null>(null)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [bar, setBar] = useState<{ index: number; spec: BarSpec } | null>(null)
  const [sounding, setSounding] = useState<number[]>([])
  const [log, setLog] = useState<Line[]>([])
  const [totals, setTotals] = useState({ calls: 0, ms: 0, tokens: 0, usd: 0 })
  const [status, setStatus] = useState<'idle' | 'thinking' | 'playing' | 'done'>('idle')
  const [error, setError] = useState('')
  const [refusal, setRefusal] = useState('')

  const keyboard = useRef<KeyboardHandle>(null)
  const lastSpoken = useRef(0)

  const add = useCallback((s: Stats) => setTotals(t => ({
    calls: t.calls + 1, ms: t.ms + s.ms, tokens: t.tokens + s.inputTokens, usd: t.usd + s.usd,
  })), [])

  const player = useMemo(() => new Player({
    onPiece(p, d, s) { setPiece(p); setPieceDecisions(d); add(s); setStatus('playing') },
    onPhrase(p: Played) {
      setPhrase({ spec: p.phrase, barOffset: p.barOffset, n: p.index + 1 })
      setDecisions(p.decisions)
      add(p.stats)
      setLog(l => [...l, {
        n: p.index + 1,
        role: p.phrase.role,
        chords: p.phrase.bars.map(b => b.chordLabel).join(' '),
        tags: [p.phrase.restate && 'opening returns', p.phrase.cadence && 'comes to rest', p.phrase.end && 'finishes'].filter(Boolean).join(' · '),
      }])
    },
    onBar(index, spec) { setBar({ index, spec }) },
    onKeys(midis) {
      // The keyboard is the one thing that changes many times a second, so it
      // is driven straight through the DOM. Routing it through React state
      // re-rendered all eighty-eight keys on every note.
      keyboard.current?.setLit(midis)
      // The spoken equivalent only needs to be current, not instant.
      const now = performance.now()
      if (now - lastSpoken.current > 500) { lastSpoken.current = now; setSounding(midis) }
    },
    onFinish(reason) {
      // The bars, the distributions and the log stay up: a piece that has
      // finished is still worth reading. Only the keyboard goes dark.
      setStatus(reason === 'ended' ? 'done' : 'idle')
      keyboard.current?.setLit([])
      setSounding([])
    },
    onError(message) { setError(message); setStatus('idle') },
    onRefuse(message) { setRefusal(message); setStatus('idle') },
  }), [add])

  const go = (text: string) => {
    const t = text.trim()
    if (!t) return
    // Stop first, so the stopped piece reports itself finished before this
    // one says it is thinking, and not after.
    player.stop()
    setBrief(t)
    setError(''); setRefusal(''); setPiece(null); setPhrase(null); setDecisions([]); setPieceDecisions([])
    setBar(null); setLog([]); setSounding([]); setTotals({ calls: 0, ms: 0, tokens: 0, usd: 0 })
    setStatus('thinking')
    void player.start(t, Math.floor(Math.random() * 1e9) + 1)
  }

  const scalePcs = useMemo(
    () => new Set(piece ? MODES[piece.mode].steps.map(s => (piece.tonic + s) % 12) : []),
    [piece])

  // The decisions for whichever bar is sounding right now.
  const current = useMemo(() => {
    if (!bar) return { chord: undefined as Decision | undefined, landing: undefined as Decision | undefined }
    const group = `Bar ${bar.index + 1}`
    return {
      chord: decisions.find(d => d.group === group && d.label === 'Chord'),
      landing: decisions.find(d => d.group === group && d.label === 'Resting note'),
    }
  }, [bar, decisions])

  const busy = status === 'thinking' || status === 'playing'

  const spokenNotes = useMemo(() => {
    if (!sounding.length) return 'No notes sounding'
    return `Now sounding: ${sounding.map(m => `${NOTE_NAMES[mod12(m)]}${Math.floor(m / 12) - 1}`).join(', ')}`
  }, [sounding])

  return (
    <>
      <h1>Jev at the piano</h1>
      <p className="lede">
        Jev can't generate notes. It only answers multiple-choice questions. Every option it
        was offered stays visible here, dim — the one it struck is the one you hear.
      </p>

      <div className="controls">
        <label className="field">
          <span className="field-label">What should it play?</span>
          <input
            type="text"
            value={brief}
            placeholder="describe a mood, or pick one below"
            onChange={e => setBrief(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') go(brief) }}
          />
        </label>
        {busy
          ? <button className="stop" onClick={() => player.stop()}>Stop</button>
          : <button className="go" onClick={() => go(brief)} disabled={!brief.trim()}>Play</button>}
      </div>

      <div className="presets">
        {SUGGESTIONS.map(s => <button key={s} onClick={() => go(s)} disabled={busy}>{s}</button>)}
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {refusal && <p className="refusal" role="status">{refusal}</p>}

      <div className="stage">
        <div className="readout">
          {piece
            ? <span className="home">{NOTE_NAMES[piece.tonic]} {piece.mode.replace('_', ' ')}</span>
            : <span className="home unset">no key struck yet</span>}
          {piece && <span className="meta">{piece.meter} · {piece.bpm} bpm</span>}
          <span className={`pulse${status === 'playing' ? ' live' : ''}`}>
            {status === 'idle' && !piece && 'waiting'}
            {status === 'thinking' && 'choosing a key…'}
            {status === 'playing' && 'playing'}
            {status === 'done' && 'finished'}
          </span>
        </div>

        <Keyboard ref={keyboard} />
        <p className="keyboard-status" role="status" aria-live="polite">{spokenNotes}</p>
      </div>

      {phrase && (
        <div className="bars">
          {phrase.spec.bars.map((b, i) => {
            const globalIndex = phrase.barOffset + i
            const chose = decisions.find(d => d.group === `Bar ${globalIndex + 1}` && d.label === 'Chord')
            const weight = chose?.options.find(o => o.key === chose.picked)?.p
            return (
              <div key={i} className={`bar${busy && bar?.index === globalIndex ? ' now' : ''}`}>
                <div className="chord">
                  {b.chordLabel}
                  {weight !== undefined && (
                    <span
                      className="weight"
                      title={`Jev gave ${b.chordLabel} ${(weight * 100).toFixed(1)}% of its weight across all 36 chords`}
                    >
                      {(weight * 100).toFixed(weight >= 0.1 ? 0 : 1)}%
                    </span>
                  )}
                </div>
                <div className="detail">
                  {b.figure.replace(/^w_/, '').replace(/_/g, ' ')}<br />
                  {b.hand.replace(/^w_/, '').replace(/_/g, ' ')}<br />
                  rests on {NOTE_NAMES[b.landing]}<br />
                  {short(DYNAMIC_LEVELS, DYNAMIC_VELOCITY.indexOf(b.dynamic))}, sits {short(REGISTER_LEVELS, b.register)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {current.chord && (
        <>
          <p className="field-label spaced">every chord it could have struck, bar {(bar?.index ?? 0) + 1}</p>
          <GhostField d={current.chord} inKey={k => scalePcs.has(rootOf(k))} limit={16} />
        </>
      )}

      {(current.landing || pieceDecisions.length > 0 || log.length > 0 || totals.calls > 0) && piece && (
        <details className="section">
          <summary>the rest of what it weighed</summary>
          <div className="section-body">
            {current.landing && bar && (
              <>
                <p className="field-label">where it could have rested this bar</p>
                <GhostField
                  d={current.landing}
                  inKey={k => chordPcs(bar.spec.chord).includes(pcOf(k)) || scalePcs.has(pcOf(k))}
                  limit={12}
                />
              </>
            )}

            {pieceDecisions.length > 0 && (
              <>
                <p className="field-label spaced">how it picked the key</p>
                {pieceDecisions.map(d => (
                  <div key={d.id} style={{ marginBottom: 12 }}>
                    <div style={{ color: 'var(--ghost)', fontSize: 12, marginBottom: 4 }}>{d.label}</div>
                    <GhostField d={d} inKey={() => true} limit={6} />
                  </div>
                ))}
              </>
            )}

            {log.length > 0 && (
              <>
                <p className="field-label spaced">every phrase so far</p>
                <div className="log">
                  {log.map(l => (
                    <div key={l.n}>
                      <span className="n">{l.n}</span>
                      <span className="role">{l.role}</span>
                      <span className="chords">{l.chords}</span>
                      <span className="tag">{l.tags}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {totals.calls > 0 && (
              <>
                <p className="field-label spaced">cost so far</p>
                <div className="stats">
                  <span><b>{totals.calls}</b> calls to Jev</span>
                  <span><b>{(totals.ms / 1000).toFixed(1)}s</b> thinking</span>
                  <span><b>{totals.tokens.toLocaleString()}</b> tokens</span>
                  <span><b>${totals.usd.toFixed(5)}</b></span>
                </div>
              </>
            )}
          </div>
        </details>
      )}

      <footer>
        Jev is <a href="https://typesafe.ai">TypeSafe AI</a>'s System One model. It answers typed
        questions with probabilities and can't generate text, code, or notes. Nothing in this app
        filters the chord bank to the key — staying in tune is Jev's doing.
        <br />
        Built by <a href="https://x.com/BaselAshraf81">@BaselAshraf81</a> and{' '}
        <a href="https://x.com/LamplighterPaul">@LamplighterPaul</a>.{' '}
        <a href="https://github.com/LamplighterPaul/jev-piano">Source</a>, MIT. Not affiliated with TypeSafe AI.
      </footer>
    </>
  )
}

/** "soft: quiet and inward" is just "soft" on a bar. */
const short = (levels: string[], i: number) => levels[i]?.split(':')[0] ?? ''

const rootOf = (label: string) => Math.max(0, NOTE_NAMES.indexOf(label.replace(/[m7]/g, '') as (typeof NOTE_NAMES)[number]))
const pcOf = (label: string) => Math.max(0, NOTE_NAMES.indexOf(label as (typeof NOTE_NAMES)[number]))

/** Every option Jev was offered, present at once as a dim ghost label. The one
 *  it struck glows; options outside the key sit further into the dark rather
 *  than vanishing, because refusing to filter the chord bank is the whole point. */
function GhostField({ d, inKey, limit }: { d: Decision; inKey: (key: string) => boolean; limit: number }) {
  const shown = d.options.slice(0, limit)
  return (
    <div className="ghost-field">
      {shown.map(o => {
        const struck = o.key === d.picked
        const out = !inKey(o.key)
        const near = !struck && !out && o.p >= 0.03
        return (
          <span key={o.key} className={`opt${struck ? ' struck' : ''}${near ? ' near' : ''}${out ? ' out' : ''}`}>
            {o.key}<span className="p">{(o.p * 100).toFixed(o.p >= 0.1 ? 0 : 1)}%</span>
          </span>
        )
      })}
    </div>
  )
}

export interface KeyboardHandle { setLit(midis: number[]): void }

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(mod12(m))

/** A1 to C7. Geometry is fixed, so it is worked out once at module load. */
const KEY_SHAPES = (() => {
  const low = 33
  const high = 96
  const whites: number[] = []
  for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m)
  const w = 100 / whites.length
  const shapes: { midi: number; black: boolean; left: number; width: number }[] = []
  // Whites first, blacks after, so the blacks paint on top of them.
  whites.forEach((m, i) => shapes.push({ midi: m, black: false, left: i * w, width: w }))
  whites.forEach((m, i) => {
    const b = m + 1
    if (b <= high && isBlack(b)) shapes.push({ midi: b, black: true, left: (i + 1) * w - w * 0.3, width: w * 0.6 })
  })
  return shapes
})()

/** Eighty-eight ghost tubes, all present, all dim. A key that is sounding is
 *  struck to a hard glow. This renders once and is then updated through the DOM
 *  rather than through React, because it changes many times a second. */
function Keyboard({ ref }: { ref?: Ref<KeyboardHandle> }) {
  const els = useRef(new Map<number, HTMLDivElement>())
  const on = useRef<number[]>([])

  useImperativeHandle(ref, () => ({
    setLit(midis: number[]) {
      for (const m of on.current) if (!midis.includes(m)) els.current.get(m)?.classList.remove('on')
      for (const m of midis) if (!on.current.includes(m)) els.current.get(m)?.classList.add('on')
      on.current = midis
    },
  }), [])

  return (
    <div className="keyboard" aria-hidden="true">
      {KEY_SHAPES.map(k => (
        <div
          key={k.midi}
          ref={el => { if (el) els.current.set(k.midi, el); else els.current.delete(k.midi) }}
          className={`key ${k.black ? 'b' : 'w'}`}
          style={{ left: `${k.left}%`, width: `${k.width}%` }}
        />
      ))}
    </div>
  )
}
