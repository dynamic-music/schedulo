import {
  Schedulo,
  Playback,
  Time,
  Stop,
  Transition,
  Subdivision,
  Parameter
} from './index';

testChangeAmplitude();

async function testTransition() {
  let schedulo = new Schedulo();
  schedulo.start();
  let id = await schedulo.scheduleAudio(["./loops/long1.m4a"], Time.At(1), Playback.Oneshot());
  schedulo.transition(id, ["./loops/long2.m4a"], Time.At(4), Transition.CrossFade(8), Playback.Oneshot());
}

async function testStopping() {
  let schedulo = new Schedulo();
  schedulo.start();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.Immediately, Playback.Oneshot());
  schedulo.stopAudio(id, Time.At(0.5), Stop.Immediately);
  id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.At(0.8), Playback.Oneshot());
  schedulo.stopAudio(id, Time.At(0.8), Stop.FadeOut(4));
}

async function testSubdiv() {
  let schedulo = new Schedulo();
  schedulo.setTempo(170);
  schedulo.start();
  setTimeout(async()=> {
    await schedulo.scheduleAudio(["./loops/2.m4a"], Time.Next(Subdivision.Bar), Playback.Oneshot());
    await schedulo.scheduleAudio(["./loops/1.m4a"], Time.In("1:2"), Playback.Oneshot());
    await schedulo.scheduleAudio(["./loops/2.m4a"], Time.In("1:4"), Playback.Oneshot());
  }, 100)
}

async function test() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/2.m4a"], Time.At(1), Playback.Oneshot());
  schedulo.scheduleEvent(() => console.log("EVENT"), Time.At(1.3));
  schedulo.scheduleAudio(["./loops/1.m4a"], Time.After(id), Playback.Oneshot());
  schedulo.setLoop(0.5, 2.2);
  schedulo.start();
  setTimeout(()=>schedulo.setLoop(1.3,2.5), 5000);
}

async function testLongFileChop() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.At(1), Playback.Oneshot(0, 1));
  for (let i = 1; i < 8; i++) {
    id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.After(id), Playback.Oneshot(i, 1));
  }
  schedulo.start();
}

async function testLoopPoints() {
  const schedulo = new Schedulo();
  const id = await schedulo.scheduleAudio(
    ["./loops/long2.m4a"],
    Time.At(1),
    Playback.Loop(10, 5, 2)
  );
  schedulo.start();
}

async function testLoopMultipleMaxPeriod() {
  const schedulo = new Schedulo();
  const id = await schedulo.scheduleAudio(
    ["./loops/1.m4a", "./loops/short.wav"],
    Time.At(1),
    Playback.Loop(2, 0, 20)
  );
  schedulo.start();
}

async function testScheduleAfter() {
  const schedulo = new Schedulo();
  const one = await schedulo.scheduleAudio(
    ['./loops/short.wav'],
    Time.At(1),
    Playback.Loop(2)
  );
  const two = await schedulo.scheduleAudio(
    ['./loops/1.m4a'],
    Time.After(one),
    Playback.Oneshot()
  );
  await schedulo.scheduleAudio(
    ['./loops/short.wav'],
    Time.After(two),
    Playback.Oneshot()
  );
  schedulo.start();
}

async function testChangeAmplitude() {
  const schedulo = new Schedulo();
  const loop = await schedulo.scheduleAudio(
    ['./loops/1.m4a'],
    Time.Immediately,
    Playback.Oneshot()
  );
  schedulo.start();
  await schedulo.scheduleEvent(() => {
    console.warn('change volume');
    loop.forEach(obj => obj.set(Parameter.Amplitude, 0.5));
  }, Time.At(2.0));
}

/*
|...|...|...|...
  |     |
    |...|
        |...|
*/