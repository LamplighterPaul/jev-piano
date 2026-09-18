# Jev at the piano

**Experimental.** Jev cannot generate text, or code, or a single note. It answers typed questions
with probabilities and nothing else. So this hands it a piano and asks it questions.

Describe a mood — *a slow, sad waltz* — and it plays, continuously, deciding as it goes.

```sh
npm ci && npm run build
TYPESAFE_API_KEY=... npm start        # http://localhost:8787
```

## Why "it cannot play piano" was the wrong test

The obvious experiment is to feed Jev the notes so far and ask for the next one. That cannot work,
and not for any musical reason: [Jev](https://typesafe.ai) is a System One model whose entire API is
`{state, questions} -> probabilities`. Three question types — yes/no, pick one of these, score on
this scale. It has no way to emit a note, the same way it has no way to emit a word.

Ask it the question it *can* answer and it turns out to know a great deal:

```
  "a slow, sad waltz"
  C minor · 3/4 · 70 bpm

  bar 1 — where Jev put its weight across all 36 chords it was offered:
    Cm     ██████████████████████ 100.0%
    Gbm  * ······················   0.0%
    B    * ······················   0.0%
```

The chord bank is every one of the twelve roots as a major triad, a minor triad and a dominant
seventh. **Nothing in this repository filters it to the key.** Each chord is described to Jev only
by its own notes — `G B D F — a dominant seventh chord on G` — with no roman numeral, no scale
degree and no hint about which ones belong. Staying in key is Jev's doing or it does not happen.

Over a typical piece it picks in-key chords sixteen times out of sixteen, resolves V7 to i, and
lands the melody on chord tones.

## Who decides what

**Jev decides** the home note, the scale, the metre, the tempo, the chord in every bar, the shape
the melody makes, what the left hand plays, how loud it is, how high it sits, which note each bar
comes to rest on, what job each phrase does, whether to bring the opening idea back, whether to
come to rest — and when the piece is finished.

**Code is the instrument.** Equal temperament, which octave a note falls in, voicing each chord
close to the last one, the clock, the decay of a string. A piano is already a piano before anyone
sits down at it, and a pianist does not re-derive A440 each time they play.

The one limit code holds that Jev does not: a piece stops after sixteen phrases whatever Jev thinks.

## How a phrase gets made

Two calls, about 600 ms together, for roughly ten seconds of music.

1. **Harmony and form.** Four chord questions — one per bar, each asked differently, because the bar
   that opens a phrase is not doing the job of the bar that closes it — plus whether to come to rest,
   whether to restate the opening, whether the piece is over, and what job the *next* phrase should
   do. Jev plans one phrase ahead; without that the harmony has no idea what it is for and the music
   settles onto the tonic and stays there.
2. **Melody and texture.** Twenty questions asked against the harmony just chosen, so each bar's
   question names its own chord and the chord it moves to: *"It is a G7 chord, moving next to Cm.
   Which note should the melody come to rest on?"*

Jev answers every question in isolation and has no memory, so the whole state goes with each call
and coherence has to be built rather than assumed. Two things do it. Each bar is asked its own
question. And for matters of taste, code takes a **sample from Jev's distribution rather than its
argmax** — the same thing temperature sampling does for a generative model. Where Jev is certain the
sample is its top answer anyway; where it spreads its weight, the spread is what varies. The music
never leaves Jev's own probabilities.

## The catalog

Melodic figures are shapes, not tunes: *climb through the chord, one note a beat*, written in rungs
of a ladder that means nothing until a chord and a key are chosen for it. Same for the left hand —
a waltz oom-pah-pah, an Alberti bass, bare octaves, silence. Jev picks which, every bar.

- `shared/theory.ts` — pitch, the chord bank, voice leading
- `shared/catalog.ts` — figures, left-hand patterns, dynamic and register levels
- `shared/harness.ts` — the questions, and how answers become a phrase
- `shared/render.ts` — a phrase becomes notes
- `src/audio/piano.ts` — six partials, a little inharmonicity, a hammer and a small room

## Hearing it without a browser

```sh
./scripts/with-key.sh node scripts/audition.ts "a bright music box tune"
```

Prints the piece as it is decided, with the full distribution for the opening chord and a count of
how many chords landed in the key.

## Cost

About 30,000 input tokens and $0.0013 for a sixteen-bar piece, at 300–900 ms a phrase against ten
seconds of music. The buffer is never close to running out.

## Limits

- The ceiling is the catalog. Jev cannot invent a figure, a chord quality or a metre that is not in it.
- It never hears anything. Every judgement is made from text.
- Questions are answered in isolation, so long-range shape comes from planning a phrase ahead and
  from what the state carries, not from the model reasoning across its own answers.

## Licence

MIT.
