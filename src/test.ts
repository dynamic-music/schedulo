import { Schedulo } from './schedulo';

let schedulo = new Schedulo();
schedulo.scheduleAudio(["./loops/1.m4a", "./loops/2.m4a"], {}, {});
schedulo.scheduleEvent(() => console.log("EVENT"), {}, {});
schedulo.setLoop(0.5, 2.0);
schedulo.start();
