import { Schedulo, Playback, Start } from './index';

test();

async function test() {
  let schedulo = new Schedulo();
  let id = await schedulo.schedule(["./loops/2.m4a"], Start.At(1), Playback.Oneshot());
  schedulo.schedule(() => console.log("EVENT"), Start.At(1.3), Playback.Oneshot());
  schedulo.schedule(["./loops/1.m4a"], Start.After(id), Playback.Oneshot());
  schedulo.setLoop(0.5, 2.2);
  schedulo.start();
  setTimeout(()=>schedulo.setLoop(1.3,2.5), 5000);
}

async function testLongFileChop() {
  let schedulo = new Schedulo();
  let id = await schedulo.schedule(["./loops/long2.m4a"], Start.At(1), Playback.Oneshot(0, 1));
  for (let i = 1; i < 8; i++) {
    id = await schedulo.schedule(["./loops/long2.m4a"], Start.After(id), Playback.Oneshot(i, 1));
  }
  schedulo.start();
}

/*
|...|...|...|...
  |     |
    |...|
        |...|
*/