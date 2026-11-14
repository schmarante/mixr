// "Rising" – Test-Fixture: eigene Funktionen per register()
setcpm(30)

const ratchet = register('ratchet', (pat) => pat.sometimes(ply(2)))
register('fade', (start, end, mult, section, pat) => pat.gain(saw.range(start, end).slow(section).mul(mult)))
register(['wobble', 'wob'], (amt, pat) => pat.lpf(sine.range(400, 400 + amt).fast(2)))

const root = "<c3 a2 f2 g2>"
let accent = 0.9
accent = 1

function octave(pat) {
  return pat.add(note(12))
}

// Drums
$: s("bd*4, [~ hh]*4").bank("RolandTR909").ratchet().fade(0.2, 1, 1, 4)

$hats: s("hh*8").gain(0.5).fade(0.3, 0.6, 1, 2)

$: note(root).s("sawtooth").wobble(1200).fade(0.4, 0.9, accent, 8).room(0.3)

$: note(root).s("supersaw").superimpose(octave).every(2, x => x.fade(0, 1, 1, 1))

$late: n("0 2 4 2").scale("C4:minor").s("triangle").fade(0.5, 1, 1, 2).gain(0.6)
