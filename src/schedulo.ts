declare var global: any;
if (typeof window === 'undefined') {
  global.window = {};
}

import * as Tone from 'tone';
import { Time, Player } from 'tone';
import { Scheduler, ScheduledObject, AudioObject, EventObject, Subdivision,
  ScheduleTime, ScheduleAt, ScheduleNext, ScheduleIn, ScheduleAfter,
  PlaybackMode, LoopMode,  TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut, Parameter } from './types';
import { TonejsScheduledObject, TonejsAudioObject, TonejsEventObject } from './tone-object';
import { add } from './tone-helpers';
import { setupTonePlayers, defaultTimings, LifeCycleTimings } from './life-cycle';

export interface AdditionalOptions {
  timings: LifeCycleTimings;
}

export class Schedulo implements Scheduler {

  private scheduledObjects: EventObject[] = [];
  private currentId = 0;
  private filenameCache = new Map<String, AudioBuffer>();

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

  getCurrentTime(): number {
    return Tone.Transport.seconds;
  }

  async scheduleAudio(
    fileUris: string[],
    startTime: ScheduleTime,
    mode: PlaybackMode,
    options: AdditionalOptions = {timings: defaultTimings}
  ): Promise<AudioObject[]> {
    let time = this.calculateScheduleTime(startTime);
    const objects = await setupTonePlayers({
      fileUris,
      startTime,
      mode,
      time, // TODO, function args for setupTonePlayers are not ideal
      filenameCache: this.filenameCache,
      timings: options.timings
    });
    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  transition(from: AudioObject[], toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<AudioObject[]> {
    let time = this.calculateScheduleTime(startTime);
    let duration = mode instanceof TransitionWithCrossfade ? mode.duration : 0;
    return this.scheduleAudio(toAudioFiles, startTime, playbackMode)
      .then(obj => {
        //fade in
        obj.forEach(o => {
          o.set(Parameter.Amplitude, -Infinity);
          o.ramp(Parameter.Amplitude, 0, duration, time);
        });
        //fade out
        from.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, time));
        return obj;
      })
  }

  scheduleEvent(trigger: () => any, time: ScheduleTime): EventObject {
    let startTime = this.calculateScheduleTime(time);
    return new TonejsEventObject(new Tone.Event(trigger).start(startTime), startTime);
  }

  stopAudio(objects: AudioObject[], time: ScheduleTime, mode: StoppingMode): void {
    let stopTime = this.calculateScheduleTime(time);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    objects.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, stopTime));
  }

  private calculateScheduleTime(time: ScheduleTime): string | number {
    if (time instanceof ScheduleAfter) {
      return calculateEndTime(time.objects);
    } else if (time instanceof ScheduleAt) {
      return time.at;
    } else if (time instanceof ScheduleNext) {
      let subdiv = time.next === Subdivision.Bar ? "1m" : "1n";
      return Tone.Transport.nextSubdivision(subdiv);
    } else if (time instanceof ScheduleIn) {
      return Tone.Transport.nextSubdivision(time.inn);
    } else {
      return Tone.Transport.seconds+0.1;
    }
  }
}

function calculateEndTime(objects: ScheduledObject[]): string | number {
  let endTimes = objects.map(({startTime, duration = 0}) => add(startTime, duration));
  return Math.max(...endTimes);
}