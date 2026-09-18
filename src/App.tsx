import { useCallback, useMemo, useState } from 'react'
import { MODES, NOTE_NAMES, chordPcs, mod12 } from '../shared/theory.ts'
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
  const [lit, setLit] = useState<number[]>([])
  const [log, setLog] = useState<Line[]>([])
  const [totals, setTotals] = useState({ calls: 0, ms: 0, tokens: 0, usd: 0 })
  const [status, setStatus] = useState<'idle' | 'thinking' | 'playing' | 'done'>('idle')
  const [error, setError] = useState('')

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
    onKeys(midis) { setLit(midis) },
    onFinish(reason) { setStatus(reason === 'ended' ? 'done' : 'idle'); setBar(null); setLit([]) },
    onError(message) { setError(message); setStatus('idle') },
  }), [add])

  const go = (text: string) => {
    const t = text.trim()
    if (!t) return
    setBrief(t)
    setError(''); setPiece(null); setPhrase(null); setDecisions([]); setPieceDecisions([])
    setBar(null); setLog([]); setLit([]); setTotals({ calls: 0, ms: 0, tokens: 0, usd: 0 })
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

  return (
    <>
      <h1>Jev at the piano</h1>
      <p className="lede">
        Jev is a decision model. It cannot generate text, or code, or a single note —
        it can only answer typed questions with probabilities. So code hands it a piano and
        asks: <strong>which of these thirty-six chords comes next?</strong> Every musical
        choice below is Jev's. Code only tunes the strings and keeps the time.
      </p>

      <div className="ask">
        <input
          type="text"
          value={brief}
          placeholder="describe something for it to play"
          onChange={e => setBrief(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') go(brief) }}
        />
        {busy
          ? <button className="ghost" onClick={() => player.stop()}>Stop</button>
          : <button onClick={() => go(brief)} disabled={!brief.trim()}>Play</button>}
      </div>

      <div className="suggestions">
        {SUGGESTIONS.map(s => <button key={s} onClick={() => go(s)} disabled={busy}>{s}</button>)}
      </div>

      {error && <p className="error">{error}</p>}
      {status === 'thinking' && <p className="lede">Jev is choosing a key…</p>}

      {piece && (
        <div className="panel">
          <h2>The piece</h2>
          <div className="piece">
            <span className="big">{NOTE_NAMES[piece.tonic]} {piece.mode.replace('_', ' ')}</span>
            <span className="meta">{piece.meter}</span>
            <span className="meta">{piece.bpm} bpm</span>
            <span className="meta">
              {MODES[piece.mode].steps.map(s => NOTE_NAMES[(piece.tonic + s) % 12]).join(' ')}
            </span>
          </div>
          <Keys lit={lit} />
        </div>
      )}

      {phrase && (
        <div className="panel">
          <h2>
            Phrase {phrase.n} — {phrase.spec.role}
            {phrase.spec.restate && ', bringing the opening back'}
            {phrase.spec.cadence && ', coming to rest'}
          </h2>
          <div className="bars">
            {phrase.spec.bars.map((b, i) => {
              const globalIndex = phrase.barOffset + i
              const chose = decisions.find(d => d.group === `Bar ${globalIndex + 1}` && d.label === 'Chord')
              const p = chose?.options.find(o => o.key === chose.picked)?.p ?? 0
              return (
                <div key={i} className={`bar${bar?.index === globalIndex ? ' now' : ''}`}>
                  <div className="chord">{b.chordLabel}</div>
                  {chose && (
                    <div className="conf" title={`Jev gave ${b.chordLabel} ${(p * 100).toFixed(1)}% of its weight across all 36 chords`}>
                      <span className="track"><span className="fill" style={{ width: `${Math.max(2, p * 100)}%` }} /></span>
                      <span className="pct">{(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%</span>
                    </div>
                  )}
                  <div className="detail">
                    {b.figure.replace(/^w_/, '').replace(/_/g, ' ')}<br />
                    {b.hand.replace(/^w_/, '').replace(/_/g, ' ')}<br />
                    rests on {NOTE_NAMES[b.landing]}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {current.chord && (
        <div className="panel">
          <h2>Bar {(bar?.index ?? 0) + 1} — every chord Jev was offered</h2>
          <Distribution d={current.chord} inKey={k => scalePcs.has(rootOf(k))} limit={12} />
        </div>
      )}

      {current.landing && bar && (
        <div className="panel">
          <h2>…and which note to come to rest on</h2>
          <Distribution
            d={current.landing}
            inKey={k => chordPcs(bar.spec.chord).includes(pcOf(k)) || scalePcs.has(pcOf(k))}
            limit={12}
          />
        </div>
      )}

      {pieceDecisions.length > 0 && (
        <div className="panel">
          <h2>How it chose the key</h2>
          {pieceDecisions.map(d => (
            <div key={d.id} style={{ marginBottom: 10 }}>
              <div style={{ color: 'var(--dim)', fontSize: 12 }}>{d.label}</div>
              <Distribution d={d} inKey={() => true} limit={5} />
            </div>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="panel">
          <h2>The piece so far</h2>
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
        </div>
      )}

      {totals.calls > 0 && (
        <div className="panel">
          <h2>What that cost</h2>
          <div className="stats">
            <span><b>{totals.calls}</b> calls to Jev</span>
            <span><b>{(totals.ms / 1000).toFixed(1)}s</b> of thinking</span>
            <span><b>{totals.tokens.toLocaleString()}</b> input tokens</span>
            <span><b>${totals.usd.toFixed(5)}</b></span>
          </div>
        </div>
      )}

      {status === 'done' && <p className="lede">Jev decided the piece was finished.</p>}

      <footer>
        Jev is <a href="https://typesafe.ai">TypeSafe AI</a>'s System One model. It returns typed
        decisions with probabilities and cannot generate text, code or notes. The chord bank is all
        twelve roots — major, minor and dominant seventh — with no key filtering anywhere in the
        code, so staying in key is Jev's doing, not the harness's.
        <br />
        An X collaboration between <a href="https://x.com/BaselAshraf81">@BaselAshraf81</a> and{' '}
        <a href="https://x.com/LamplighterPaul">@LamplighterPaul</a>, who think this is possible and
        are trying. <a href="https://github.com/LamplighterPaul/jev-piano">Source</a>, MIT.
        Not affiliated with TypeSafe AI.
      </footer>
    </>
  )
}

const rootOf = (label: string) => Math.max(0, NOTE_NAMES.indexOf(label.replace(/[m7]/g, '') as (typeof NOTE_NAMES)[number]))
const pcOf = (label: string) => Math.max(0, NOTE_NAMES.indexOf(label as (typeof NOTE_NAMES)[number]))

function Distribution({ d, inKey, limit }: { d: Decision; inKey: (key: string) => boolean; limit: number }) {
  const shown = d.options.slice(0, limit)
  const max = Math.max(0.0001, ...shown.map(o => o.p))
  return (
    <div className="dist">
      {shown.map(o => {
        const out = !inKey(o.key)
        return (
          <Row key={o.key} name={o.key} p={o.p} width={o.p / max} out={out} picked={o.key === d.picked} />
        )
      })}
    </div>
  )
}

function Row({ name, p, width, out, picked }: { name: string; p: number; width: number; out: boolean; picked: boolean }) {
  return (
    <>
      <span className={`name${out ? ' out' : ''}`} style={picked ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>{name}</span>
      <span className="track"><span className={`fill${out ? ' out' : ''}`} style={{ width: `${Math.max(1, width * 100)}%` }} /></span>
      <span className="pct">{(p * 100).toFixed(p >= 0.1 ? 0 : 1)}%</span>
    </>
  )
}

/** A1 to C7 — the range the left and right hands actually reach. Keys are held
 *  down for as long as the note sounds. */
function Keys({ lit }: { lit: number[] }) {
  const low = 33
  const high = 96
  const whites: number[] = []
  for (let m = low; m <= high; m++) if (![1, 3, 6, 8, 10].includes(mod12(m))) whites.push(m)
  const w = 100 / whites.length
  const on = new Set(lit)
  return (
    <div className="keys">
      {whites.map((m, i) => (
        <div key={m} className={`w${on.has(m) ? ' on' : ''}`} style={{ left: `${i * w}%`, width: `${w}%` }} />
      ))}
      {whites.map((m, i) => {
        const black = m + 1
        if (black > high || ![1, 3, 6, 8, 10].includes(mod12(black))) return null
        return (
          <div key={black} className={`b${on.has(black) ? ' on' : ''}`}
            style={{ left: `${(i + 1) * w - w * 0.3}%`, width: `${w * 0.6}%` }} />
        )
      })}
    </div>
  )
}
