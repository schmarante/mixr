setcpm(30)

$beat: stack(
  s("bd ~ ~ bd ~ ~ bd ~").s("tr808_bd").gain(1), // Kick
  s("~ cp").bank("RolandTR808").gain(0.7),
  s("hh*8").gain(0.5).lpf(5000).late(0.005),
  /* s("oh*2") */
).hpf(60)._punchcard()
