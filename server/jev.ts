// The only place that talks to Jev. One POST, many questions, probabilities back.

import type { Answer, Answers, Questions } from '../shared/harness.ts'

export interface Run { answers: Answers; model: string; ms: number; questions: number; inputTokens: number }

/** One key, or several in TYPESAFE_API_KEYS to spread the calls over. */
const KEYS = (process.env.TYPESAFE_API_KEYS ?? process.env.TYPESAFE_API_KEY ?? '')
  .split(',').map(k => k.trim()).filter(Boolean)
const MODEL = process.env.TYPESAFE_MODEL ?? 'jev-latest'
const ENDPOINT = process.env.TYPESAFE_ENDPOINT ?? 'https://api.typesafe.ai/v1/systemone'

let turn = 0

export const live = () => KEYS.length > 0
export const keyCount = () => KEYS.length

export async function ask(state: unknown, questions: Questions): Promise<Run> {
  return KEYS.length ? jev(state, questions) : mock(questions)
}

async function jev(state: unknown, questions: Questions): Promise<Run> {
  const started = performance.now()
  for (let attempt = 0; ; attempt++) {
    // Round robin, and a rate limited key steps aside for the next one.
    const key = KEYS[(turn++ + attempt) % KEYS.length]
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, model: MODEL, questions }),
      signal: AbortSignal.timeout(20_000),
    })
    if ((res.status === 429 || res.status === 529) && attempt < KEYS.length + 1) {
      await new Promise(r => setTimeout(r, attempt < KEYS.length ? 0 : 400 * 2 ** attempt))
      continue
    }
    if (!res.ok) throw new Error(`Jev returned ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const body = await res.json() as { model: string; answers: Answers; usage?: { input_tokens?: number } }
    return {
      answers: body.answers, model: body.model, ms: Math.round(performance.now() - started),
      questions: Object.keys(questions).length, inputTokens: body.usage?.input_tokens ?? 0,
    }
  }
}

// Offline stand-in so the audio and the interface can be worked on without a
// key. It picks at random within the options it is given. It is not musical
// and the interface says so.
function mock(questions: Questions): Run {
  const answers: Answers = {}
  for (const [id, q] of Object.entries(questions)) {
    let a: Answer
    if (q.type === 'noul') a = { type: 'noul', noul: Math.random() }
    else if (q.type === 'choice') {
      const keys = Object.keys(q.criteria)
      const raw = keys.map(() => Math.random() ** 3)
      const sum = raw.reduce((x, y) => x + y, 0)
      const probabilities = Object.fromEntries(keys.map((k, i) => [k, raw[i] / sum]))
      const choice = keys[raw.indexOf(Math.max(...raw))]
      a = { type: 'choice', choice, probabilities, confidence: probabilities[choice] }
    } else {
      const n = q.criteria.length
      const raw = q.criteria.map(() => Math.random())
      const sum = raw.reduce((x, y) => x + y, 0)
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), raw[i] / sum]))
      a = { type: 'score', score: raw.indexOf(Math.max(...raw)), confidence: 1 / n, probabilities }
    }
    answers[id] = a
  }
  return { answers, model: 'mock', ms: 0, questions: Object.keys(questions).length, inputTokens: 0 }
}
