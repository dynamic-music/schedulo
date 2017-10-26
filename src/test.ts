import * as Tone from 'tone';

const kick = new Tone.Player({
  url: "./loops/amen.wav",
  loop: true,
  loopStart: 1.0,
  loopEnd: 3.0,
}).toMaster().sync().start(1.0);

var snare = new Tone.Player({
  url : "./loops/bass.m4a",
  loop : true
}).toMaster().sync().start(1.0, 2.0, 3.0);

Tone.Transport.loop = true;
Tone.Transport.loopStart = 6.0;
Tone.Transport.loopEnd = 7.5;

Tone.Transport.start("+0.1");
