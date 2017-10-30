import * as Tone from 'tone';
import { Time as ToneTime } from 'tone';
import { Scheduler, SchedulerId, ScheduledObject, Time, TimeType,
  StartTime, StartAt, StartNext, StartIn, StartAfter,
  PlaybackMode, LoopMode,  TransitionMode,
  StoppingMode, StopWithFadeOut } from './types';

class TonejsScheduledObject implements ScheduledObject {
  constructor(public tonejsObjects: any[], public startTime: Time, public duration: Time) {}
}

interface ScheduloPlayerOptions {
  url: string,
  startTime: Time,
  loop: boolean,
  offset?: Time,
  duration?: Time,
  onload?: () => any,
  playbackRate?: number
}

export class Schedulo {

  private scheduledObjects: TonejsScheduledObject[] = [];
  private currentId = 0;

  setLoop(start: number, stop: number): void {
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = stop;
  }

  setTempo(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
  }

  setMeter(numerator: number, denominator: number): void {
    Tone.Transport.timeSignature = [numerator, denominator];
  }

  start(): void {
    Tone.Transport.start("+0.1");
  }

  async scheduleAudio(fileUris: string[], startTime: StartTime, mode: PlaybackMode): Promise<SchedulerId> {
    let time = this.calculateStartTime(startTime);
    let loop = mode instanceof LoopMode ? true : false;
    let players = await Promise.all(fileUris.map(f =>
      this.createTonePlayer({
        url: f,
        startTime: time,
        offset: mode.offset,
        duration: mode.duration,
        loop: loop
      })
    ));
    let duration = mode.duration ? mode.duration : Math.max(...players.map(p => p.buffer.duration));
    return this.addScheduledObject(new TonejsScheduledObject(players, time, duration));
  }

  /*transitionTo(audioFiles: string[], time: StartTime, transitionMode: TransitionMode, playbackMode: PlaybackMode): SchedulerId {

  }*/

  scheduleEvent(trigger: () => any, startTime: StartTime): SchedulerId {
    let time = this.calculateStartTime(startTime);
    return this.addScheduledObject(new Tone.Event(trigger).start(time));
  }

  stop(id: SchedulerId, startTime: StartTime, mode: StoppingMode): void {
    let time = this.calculateStartTime(startTime);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    let objects = this.scheduledObjects[id].tonejsObjects;
    objects.forEach(o => o.volume.linearRampTo(-Infinity, duration, time));
  }

  private addScheduledObject(object: TonejsScheduledObject): SchedulerId {
    this.scheduledObjects[this.currentId] = object;
    return this.currentId++;
  }

  private createTonePlayer(options: ScheduloPlayerOptions): Promise<any> {
    return new Promise(resolve => {
      options.onload = resolve;
      new Tone.Player(options).toMaster().sync()
        .start(options.startTime, options.offset, options.duration);
    }
    );
  }

  private calculateStartTime(startTime: StartTime): Time {
    if (startTime instanceof StartAfter) {
      return this.calculateEndTime(startTime.id);
    } else if (startTime instanceof StartAt) {
      return startTime.at;
    } else if (startTime instanceof StartNext) {
      let subdiv = startTime.next === TimeType.Bar ? "1m" : "1n";
      return Tone.Transport.nextSubdivision(subdiv);
    } else if (startTime instanceof StartIn) {
      return Tone.Transport.nextSubdivision(startTime.inn);
    } else {
      return Tone.Transport.seconds+0.1;
    }
  }

  private calculateEndTime(id: SchedulerId): Time {
    const {startTime, duration = 0} = this.scheduledObjects[id];
    return new ToneTime(startTime).add(new ToneTime(duration)).toSeconds();
  }

}