import { Schedulo, Playback, Start, Stop, Transition, TimeType } from './index';

testTransition();

async function testTransition() {
  let schedulo = new Schedulo();
  schedulo.start();
  let id = await schedulo.scheduleAudio(["./loops/long1.m4a"], Start.At(1), Playback.Oneshot());
  schedulo.transition(id, ["./loops/long2.m4a"], Start.At(4), Transition.CrossFade(8), Playback.Oneshot());
}

async function testStopping() {
  let schedulo = new Schedulo();
  schedulo.start();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Start.Immediately, Playback.Oneshot());
  schedulo.stop(id, Start.At(0.5), Stop.Immediately);
  id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Start.At(0.8), Playback.Oneshot());
  schedulo.stop(id, Start.At(0.8), Stop.FadeOut(4));
}

async function testSubdiv() {
  let schedulo = new Schedulo();
  schedulo.setTempo(170);
  schedulo.start();
  setTimeout(async()=> {
    await schedulo.scheduleAudio(["./loops/2.m4a"], Start.Next(TimeType.Bar), Playback.Oneshot());
    await schedulo.scheduleAudio(["./loops/1.m4a"], Start.In("1:2"), Playback.Oneshot());
    await schedulo.scheduleAudio(["./loops/2.m4a"], Start.In("1:4"), Playback.Oneshot());
  }, 100)
}

async function test() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/2.m4a"], Start.At(1), Playback.Oneshot());
  schedulo.scheduleEvent(() => console.log("EVENT"), Start.At(1.3));
  schedulo.scheduleAudio(["./loops/1.m4a"], Start.After(id), Playback.Oneshot());
  schedulo.setLoop(0.5, 2.2);
  schedulo.start();
  setTimeout(()=>schedulo.setLoop(1.3,2.5), 5000);
}

async function testLongFileChop() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Start.At(1), Playback.Oneshot(0, 1));
  for (let i = 1; i < 8; i++) {
    id = await schedulo.scheduleAudio(["./loops/long2.m4a"], Start.After(id), Playback.Oneshot(i, 1));
  }
  schedulo.start();
}

/*
|...|...|...|...
  |     |
    |...|
        |...|
*/