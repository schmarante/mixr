const tempo = 128
setcpm(tempo / 4)

const groove = s("bd ~ sd ~").bank("emu808")
const chords = "<C Am F G>"

$: groove.lpf(3000)

$: chord(chords).voicing().s("piano")

$: stack(
  note("c3 e3").gain(0.5),
  note("g3"),
).s("triangle")

// Lautstärken im Code (ohne Spur-gain) → velocity
$: note("c4 e4 g4 b4").s("triangle").sometimesBy(0.5, x => x.gain(0.3))

// Spur-gain vor verschachteltem gain
$: note("<c2 g1>").s("sine").gain(0.5).firstOf(2, x => x.gain(1))

// wechselnde Lautstärke
$: s("hh*8").gain("0.3 0.6")
