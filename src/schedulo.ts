/// <reference path="../Tone.d.ts" />
declare var global: any;
if (typeof window === 'undefined') {
  global.window = {};
}

import * as Tone from 'tone';
import { Time, Player, Event as ToneEvent } from 'tone';
import { Scheduler, ScheduledObject, AudioObject, EventObject, Subdivision,
  ScheduleTime, ScheduleAt, ScheduleNext, ScheduleIn, ScheduleAfter,
  ScheduleRelativeTo, PlaybackMode, LoopMode,
  TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut, Parameter } from './types';
import { TonejsScheduledObject, TonejsAudioObject, TonejsEventObject } from './tone-object';
import { add, createPlayerFactoryAfterLoadingBuffer } from './tone-helpers';
import {
  //setupTonePlayers,
  defaultAudioTimings,
  LifeCycleTimings,
  //ManagedAudioEvent,
  //lazilySetupTonePlayers,
  DynamicBufferLifeCycle
} from './life-cycle';
import { AudioBank } from './audio-bank';

export type BufferLoadingScheme = 'preload' | 'dynamic';
export interface LoadingConfig<
  Tag extends BufferLoadingScheme,
  Timings extends LifeCycleTimings
> {
  timings: Timings;
  bufferScheme: Tag;
}

export interface PreloadConfig extends LoadingConfig<
  'preload',
  LifeCycleTimings
> {};
export interface DynamicConfig extends LoadingConfig<
  'dynamic',
  DynamicBufferLifeCycle
> {};

export type AdditionalOptions = DynamicConfig;

export const defaultOptions: AdditionalOptions = {
  timings: defaultAudioTimings,
  bufferScheme: 'dynamic'
};

export interface Effects {
  reverb: AudioNode;
  delay: AudioNode;
}

export class Schedulo implements Scheduler {

  private scheduledObjects: EventObject[] = [];
  private audioBank: AudioBank;
  private reverb: AudioNode;
  private delay: AudioNode;

  constructor(private timings = defaultAudioTimings) {
    const bufferWindow = timings.loadBuffer.countIn+timings.loadBuffer.countOut;
    this.audioBank = new AudioBank(bufferWindow);
    //this.reverb = new Tone.Freeverb().toMaster();
    //this.delay = new Tone.FeedbackDelay().toMaster();
    this.reverb = new Tone.Volume(0);
    this.delay = new Tone.Volume(0);
  }

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
    mode: PlaybackMode
  ): Promise<AudioObject[]> {
    let time = this.calculateScheduleTime(startTime);

    const reverb = this.reverb;
    const delay = this.delay;
    /*const args = {
      fileUris,
      startTime,
      mode,
      time, // TODO, function args for setupTonePlayers are not ideal
      effects: {
        reverb,
        delay,
      }
    };

    /*const createPlayers = () => {
      // annoyingly TypeScript can't deduce options.timings without
      // explictily writing out something like this...
      if (options.bufferScheme === 'dynamic') {
        return lazilySetupTonePlayers({
          ...args,
          timings: options.timings
        });
      } else {
        return setupTonePlayers({
          ...args,
          timings
        });
      }
    };

    const objects = await createPlayers();*/
    const objects = fileUris.map(f =>
      new TonejsAudioObject(f, this.audioBank, this.timings, reverb, delay,
        time, this.toSecs(mode.offset), this.toSecs(mode.duration)));
    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  private toSecs(time: string | number | undefined) {
    if (time !== undefined) {
      return new Tone.Time(time).toSeconds();
    }
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

  private calculateScheduleTime(time: ScheduleTime): number {
    if (time instanceof ScheduleAfter) {
      // TODO this isn't going to work for objects with an indeterminate duration.
      // This is only really complicated by the fact that we want to be able to
      // loop audio continuiously, i.e. n repeats is not known ahead of time.
      // Looping will eventually stop based on some external event, and so
      // at some unknown point in the future, it eventually ends.
      // Unfortunately, unless it is possible to obtain the explicit eventual
      // stop time prior to it occuring, there is going to be a delay in scheduling
      // the next event. Either way, we can't know any time upfront...
      // so this needs rethinking
      return new Tone.Time(calculateEndTime(time.objects)).toSeconds();
    } else if (time instanceof ScheduleRelativeTo) {
      return new Tone.Time(add(time.object.startTime, time.delta)).toSeconds();
    }else if (time instanceof ScheduleAt) {
      return new Tone.Time(time.at).toSeconds();
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

//TODO GET RID OF THIS, NEEDS TO BE DYNAMIC, WITH DEPENDENCIES
function calculateEndTime(objects: ScheduledObject[]): string | number {
  let endTimes = objects.map(({startTime, duration = 0}) => add(startTime, duration));
  return Math.max(...endTimes);
}