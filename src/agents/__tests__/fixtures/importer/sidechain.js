// "Pump" – Test-Fixture: Sidechain per duck/orbit (eigenes Stück)
setcpm(31)

// Kick drückt orbit 2 weg
$kick: s("bd*4").bank("RolandTR909").duck(2).duckdepth(0.8).duckattack(0.15).theme("bluescreen")

$pad: chord("<Cm7 Fm7>").voicing().s("supersaw").o(2).room(0.4).lpf(2000)

$: note("c2 ~ c2 eb2 ~ g1 ~ bb1").s("sawtooth").orbit(2).lpf(600)

$hats: stack(
  s("hh*8").gain(0.4).o(3),
  s("~ oh").gain(0.6).o(3).room(0.2),
)._scope()
