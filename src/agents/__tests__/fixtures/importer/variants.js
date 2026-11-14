setcpm(30)

// periodisch trotz Alternation → Raster
$alt: s("<bd sd>*4, hh(3,8)")

// wechselt je Takt → bleibt Mini-Notation
$fill: s("bd [~ bd] ~ <sd cp>")

// Alternation in der Melodie
$: n("<0 3> 2 4 [5 7]").scale("C4:major").s("square")

// Noten statt Skalenstufen → Code-Quelle, Effekte als Bausteine
$: note("c3 eb3 g3 bb3").s("sawtooth")
  .off(1/8, x => x.add(note(12)))
  .lpf(sine.range(400, 2000).slow(8))
  .vowel("<a e>")
  .late(0.25)
  .room(0.3)
