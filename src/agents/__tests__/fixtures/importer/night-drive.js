// "Night Drive" – Test-Fixture für den Importer (eigenes Stück)

setcps(124/60/4)

samples('github:someone/some-samples')

// Kick & Snare
$: s("bd*4, [~ sd]*2, [~ hh]*4").bank("RolandTR909").room(0.2)

$lead: n("0 2 4 7 4 2 0 ~")
  .scale("A3:minor")
  .s("sawtooth")
  .lpf(1200).lpq(4) // dunkler
  .delay(0.3)
  .gain(0.6)
  ._pianoroll()

// Pads
$: chord("<Am7 Dm7 G7 C^7>").dict('ireal').voicing().s("gm_epiano1").struct("x*4")
  .room(0.5).size(4)
  .gain(0.5)

_$: s("jvbass*2").speed(1)

$bass: note("<a1 f1 c2 g1>").s("gm_synth_bass_1")
  .attack(0.01).release(0.2)
  .lpf(sine.range(300, 2000).slow(8))
  .gain(slider(0.7, 0, 1))
