import { Schedulo } from './schedulo';

test();

async function test() {
  let schedulo = new Schedulo();
  let id = await schedulo.scheduleAudio(["./loops/2.m4a"], {time: 1.0}, {});
  schedulo.scheduleEvent(() => console.log("EVENT"), {time: 1.3}, {});
  schedulo.scheduleAudioAfter(id, ["./loops/1.m4a"], {});
  schedulo.setLoop(0.5, 2.2);
  schedulo.start();
  setTimeout(()=>schedulo.setLoop(1.3,2.5), 5000);
}
/*
|...|...|...|...
  |     |
    |...|
        |...|
*/