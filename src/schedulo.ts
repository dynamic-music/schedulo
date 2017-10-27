import * as Tone from 'tone';

import { Scheduler, SchedulerId, SchedulingTime, PlaybackMode, Loop } from './types';

export class Schedulo {

  private scheduledObjects: {}[] = [];
  private currentId = 0;

  setLoop(start: number, stop: number) {
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0.5;
    Tone.Transport.loopEnd = 2.0;
  }

  start() {
    Tone.Transport.start("+0.1");
  }

  scheduleAudio(fileUris: string[], time: SchedulingTime, mode: PlaybackMode): SchedulerId {
    let loop = (mode as Loop).times ? true : false;
    return this.addScheduledObject(fileUris.map(f =>
      new Tone.Player({ url: f, loop: loop }).toMaster().sync().start(1.0)));
  }

  scheduleEvent(trigger: () => any, time: SchedulingTime, mode: PlaybackMode): SchedulerId {
    return this.addScheduledObject(
      new Tone.Event(trigger).start(1.0));
  }

  private addScheduledObject(object: {}): SchedulerId {
    this.scheduledObjects[this.currentId] = object;
    return this.currentId++;
  }

}