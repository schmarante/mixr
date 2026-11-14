setcpm(32)

$: s("bd*4, ~ sd").fast(2).every(4, rev).sometimesBy(0.3, x => x.speed(2)).jux(rev).ply(2).degradeBy(0.2).crush(8).distort(1.5).pan(0.3)

$: n("0 ~ 3 ~ 5 ~ 3 ~").scale("E2:minor:pentatonic").s("supersaw").slow(2).rarely(ply(2)).hpf(200).hpq(3).release(0.4)
