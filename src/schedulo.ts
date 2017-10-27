import * as Tone from 'tone';

import { Scheduler, SchedulerId, SchedulingTime, PlaybackMode, Loop,
  ScheduledObject, StartAt } from './types';

export class TonejsScheduledObject implements ScheduledObject {
  constructor(private tonejsObject: any, public startTime: number, public duration: number) {}
}

export class Schedulo {

  private scheduledObjects: ScheduledObject[] = [];
  private currentId = 0;

  setLoop(start: number, stop: number) {
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = stop;
  }

  start() {
    Tone.Transport.start("+0.1");
  }

  async scheduleAudio(fileUris: string[], time: SchedulingTime, mode: PlaybackMode): Promise<SchedulerId> {
    let startTime = (time as StartAt).time ? (time as StartAt).time : 0;
    let loop = (mode as Loop).times ? true : false;
    let players = await Promise.all(fileUris.map(f => this.createTonePlayer(f, loop, startTime)));
    let maxDuration = Math.max(...players.map(p => p.buffer.duration));
    return this.addScheduledObject(new TonejsScheduledObject(players, startTime, maxDuration));
  }

  scheduleAudioAfter(id: SchedulerId, fileUris: string[], mode: PlaybackMode): Promise<SchedulerId> {
    const {startTime, duration = 0} = this.scheduledObjects[id];
    let endTime = this.scheduledObjects[id].startTime+duration;
    return this.scheduleAudio(fileUris, {time: endTime}, mode);
  }

  scheduleEvent(trigger: () => any, time: SchedulingTime, mode: PlaybackMode): SchedulerId {
    let startTime = (time as StartAt).time ? (time as StartAt).time : 0;
    return this.addScheduledObject(
      new Tone.Event(trigger).start(startTime));
  }

  private createTonePlayer(fileUri: string, loop: boolean, startTime: number): Promise<any> {
    return new Promise(resolve =>
      new Tone.Player({
        url: fileUri,
        loop: loop,
        onload: resolve
      }).toMaster().sync().start(startTime)
    );
  }

  private addScheduledObject(object: ScheduledObject): SchedulerId {
    this.scheduledObjects[this.currentId] = object;
    return this.currentId++;
  }

}