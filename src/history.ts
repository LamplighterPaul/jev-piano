// Pieces heard on this browser, newest first. Only ever a convenience: storage
// can be full, blocked or wiped, and the page plays the same without it.

import { compact, type Recording } from '../shared/recording.ts'

const KEY = 'jevPiano.history'
const KEEP = 20

export function loadHistory(): Recording[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as Recording[]
    return Array.isArray(list) ? list.filter(r => r?.v === 1 && r.piece && Array.isArray(r.phrases)) : []
  } catch {
    return []
  }
}

/** Keep a piece, dropping the oldest ones while storage says it is full. */
export function remember(rec: Recording): Recording[] {
  const list = [compact(rec), ...loadHistory().filter(r => r.when !== rec.when)].slice(0, KEEP)
  return write(list)
}

export function forget(when: number): Recording[] {
  return write(loadHistory().filter(r => r.when !== when))
}

function write(list: Recording[]): Recording[] {
  for (let keep = list.length; keep >= 0; keep--) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, keep)))
      return list.slice(0, keep)
    } catch {
      // Full, or not allowed at all. Try again with one fewer.
    }
  }
  // Could not store anything: this visit still remembers the list.
  return list
}
