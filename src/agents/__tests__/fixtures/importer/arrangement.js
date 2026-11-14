// "Night Shift" – Test-Fixture: Song-Ablauf mit arrange (eigenes Stück)
setcps(0.5)

let kick = s("bd*4").bank("RolandTR909").gain(0.9)
let hat = s("hh*8").gain("0.4 0.25")
let clap = s("~ cp").room(0.3)
let bassLine = note("<c2 c2 ab1 bb1>").s("sawtooth").lpf(300).gain(0.6)
let keys = chord("<Cm7 Ab^7>").voicing().s("gm_epiano1").gain(0.4).room(0.5)
let lead = n("0 2 4 7 4 2").scale("C4:minor").s("triangle").delay(0.3).delaysync(0.125)
let unused = s("rim*2")
const air = s("pink").lpf(500).gain(0.05)
const swing = 0.1

arrange(
  // INTRO - just the beat
  [2, stack(kick, air)],
  // BUILD
  [2, stack(kick, hat.lpf(2000), bassLine)],
  [4, stack(kick, hat, clap, bassLine, keys)],
  // BREAKDOWN - hands in the air
  [2, stack(hat.gain(0.15), keys.slow(2), lead)],
  [2, stack(kick.mask("1 1 1 0"), hat, clap, bassLine, lead.gain(0.5).late(swing))],
  [1, silence],
  // OUTRO
  [2, keys.room(0.9).gain(0.2)],
)
