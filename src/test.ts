import {
  Schedulo,
  Playback,
  Time,
  Stop,
  Transition,
  Subdivision,
  Parameter
} from './index';
//import { ManagedAudioEvent } from './life-cycle';

//testScheduleAtSameTime();
testEvents()

async function testEvents() {
  let schedulo = new Schedulo();
  await schedulo.scheduleEvent(() => console.log("YO"), Time.At(1));
  await schedulo.scheduleEvent(() => console.log("YA"), Time.At(1.5));
}

async function newTest() {
  let schedulo = new Schedulo();
  let objects = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.At(1), Playback.Oneshot());
  objects[0].set(Parameter.Duration, 1)
  objects[0].set(Parameter.Delay, 1)
  //schedulo.transition(id, ["./loops/long2.m4a"], Time.At(4), Transition.CrossFade(8), Playback.Oneshot());
}

async function testTransition() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/long1.m4a"], Time.At(1), Playback.Oneshot());
  schedulo.transition(id, ["./loops/long2.m4a"], Time.At(4), Transition.CrossFade(8), Playback.Oneshot());
}

async function testStopping() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.Asap, Playback.Oneshot());
  schedulo.stopAudio(id, Time.At(0.5), Stop.Asap);
  id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.At(0.8), Playback.Oneshot());
  schedulo.stopAudio(id, Time.At(0.8), Stop.FadeOut(4));
}

async function testSubdiv() {
  let schedulo = new Schedulo();
  schedulo.setTempo(170);
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
  setTimeout(()=>schedulo.setLoop(1.3,2.5), 5000);
}

async function testLongFileChop() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.At(1), Playback.Oneshot(0, 1));
  for (let i = 1; i < 8; i++) {
    id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Time.After(id), Playback.Oneshot(i, 1));
  }
}

async function testLoopPoints() {
  const schedulo = new Schedulo();
  const id = await schedulo.scheduleAudio(
    ["./loops/long2.m4a"],
    Time.At(1),
    Playback.Loop(10, 5, 2)
  );
}

async function testLoopMultipleMaxPeriod(startTime: number = 1) {
  const schedulo = new Schedulo();
  const scheduled = await schedulo.scheduleAudio(
    ["./loops/1.wav", "./loops/short.wav"],
    Time.At(startTime),
    Playback.Loop(2, 0, 20)
  );
  return {schedulo, scheduled};
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
}

async function testChangeAmplitude() {
  const schedulo = new Schedulo();
  const loop = await schedulo.scheduleAudio(
    ['./loops/1.m4a'],
    Time.At(10),
    Playback.Oneshot()
  );
  await schedulo.scheduleEvent(() => {
    console.warn('change volume');
    loop.forEach(obj => obj.set(Parameter.Amplitude, 0.5));
  }, Time.At(12));
}

async function testLifeCycleLoadAfterDispose() {
  const schedulo = new Schedulo();
  const loop = await schedulo.scheduleAudio(
    ['./loops/1.m4a'],
    Time.At(5),
    Playback.Oneshot()
  );
  const again = await schedulo.scheduleAudio(
    ['./loops/1.m4a'],
    Time.After(loop),
    Playback.Oneshot()
  );
  again[0].set(Parameter.Amplitude, 0.5);
  await schedulo.scheduleEvent(() => {
    console.warn('change volume');
    loop.forEach(obj => obj.set(Parameter.Amplitude, 0.5));
  }, Time.At(12));
}

async function testLifeCycleChangeOffsetBeforeScheduledTime() {
  const schedulo = new Schedulo();
  const loop = await schedulo.scheduleAudio(
    ['./loops/1.wav'],
    Time.At(5),
    Playback.Oneshot()
  );
  await schedulo.scheduleEvent(() => {
    console.warn('change start time');
    loop.forEach(obj => obj.set(Parameter.StartTime, 10));
  }, Time.At(4.5));
}

async function testLifeCycleChangeOffsetLoopedExample() {
  const {schedulo, scheduled} = await testLoopMultipleMaxPeriod(5);
  await schedulo.scheduleEvent(() => {
    console.warn('change start time');
    scheduled.forEach(obj => obj.set(Parameter.StartTime, 10));
  }, Time.At(4.5));
}

async function testStateEmitter() {
  const {schedulo, scheduled} = await testLoopMultipleMaxPeriod(5);
  scheduled.forEach(obj => obj.on('playing', (time) => {
    console.warn('playing: ', time);
  }));
  scheduled.forEach(obj => obj.on('stopped', (time) => {
    console.warn('stopped: ', time);
  }));
  await schedulo.scheduleEvent(() => {
    console.warn('change start time');
    scheduled.forEach(obj => obj.set(Parameter.StartTime, 10));
  }, Time.At(4.5));
}

async function testLazyScheduling() {
  const schedulo = new Schedulo();
  const one = await schedulo.scheduleAudio(
    ['./loops/1.wav'],
    Time.At(6.0),
    Playback.Oneshot()
  );
  const two = await schedulo.scheduleAudio(
    ['./loops/short.wav'],
    Time.At(10.0),
    Playback.Oneshot()
  );
}

async function testScheduleAtSameTime() {
  const schedulo = new Schedulo();
  const [first] = await schedulo.scheduleAudio(
    ['./loops/1.wav'],
    Time.At(5),
    Playback.Oneshot()
  );
  console.warn('scheduled', first);
  first.on('scheduled', async () => {
    console.warn('emitted', first);
    const [second] = await schedulo.scheduleAudio(
      ['./loops/short.wav'],
      Time.At(5.0),
      Playback.Oneshot()
    );
    console.warn('scheduled', second);
    second.on('scheduled', () => {
      console.warn('emitted', second);
    });
    second.on('playing', () => { console.warn('playing'); });
  });
}

/*
|...|...|...|...
  |     |
    |...|
        |...|
*/