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
  StoppingMode, StopWithFadeOut, Parameter, RefTimeWithOnset } from './types';
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

  constructor(private timings = defaultAudioTimings, private fadeLength = 0.01) {
    const bufferWindow = timings.loadBuffer.countIn+timings.loadBuffer.countOut;
    this.audioBank = new AudioBank(bufferWindow);
    this.reverb = new Tone.Freeverb().toMaster();
    this.delay = new Tone.FeedbackDelay(0.5, 0.6).toMaster();
    //this.reverb = new Tone.Volume(0);
    //this.delay = new Tone.Volume(0);
  }

  getAudioBank(): AudioBank {
    return this.audioBank;
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

  pause(): void {
    Tone.Transport.pause("+0.1");
  }

  stop(): void {
    Tone.Transport.stop("+0.1");
  }

  /*getCurrentTime(): number {
    return Tone.Transport.seconds;
  }*/

  async scheduleAudio(
    fileUris: string[],
    startTime: ScheduleTime,
    mode: PlaybackMode
  ): Promise<AudioObject[]> {
    let times = this.calculateScheduleTime(startTime);

    const objects = fileUris.map(f =>
      new TonejsAudioObject(f, this.audioBank, this.timings, this.fadeLength, this.reverb, this.delay, times));
    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  private toSecs(time: string | number | undefined) {
    if (time !== undefined) {
      return new Tone.Time(time).toSeconds();
    }
  }

  transition(from: AudioObject[], toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<AudioObject[]> {
    let time = this.calcAbsoluteSchedTime(startTime);
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
    let startTime = this.calcAbsoluteSchedTime(time);
    return new TonejsEventObject(new Tone.Event(trigger).start(startTime));
  }

  stopAudio(objects: AudioObject[], time: ScheduleTime, mode: StoppingMode): void {
    let stopTime = this.calcAbsoluteSchedTime(time);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    objects.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, stopTime));
  }

  private calcAbsoluteSchedTime(time: ScheduleTime): number {
    let absTime = this.calculateScheduleTime(time);
    return absTime.ref + absTime.onset;
  }

  //pair of ref and time
  private calculateScheduleTime(time: ScheduleTime): RefTimeWithOnset {
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
      return {ref: new Tone.Time(calculateEndTime(time.objects)).toSeconds()-this.fadeLength};
    } else if (time instanceof ScheduleRelativeTo) {
      //const diff = new Tone.Time(add(time.object.getStartTime(), time.delta)).toSeconds();
      //console.log("CALC", this.timings.connectToGraph.countIn)
      let delta = new Tone.Time(time.delta).toSeconds();
      return {ref: time.object.getScheduleTime(), onset: delta};
    } else if (time instanceof ScheduleAt) {
      //adjust to changing count in!!
      return {ref: new Tone.Time(time.at).toSeconds()};
    } else if (time instanceof ScheduleNext) {
      let subdiv = time.next === Subdivision.Bar ? "1m" : "1n";
      return {ref: Tone.Transport.nextSubdivision(subdiv)};
    } else if (time instanceof ScheduleIn) {
      return {ref: Tone.Transport.nextSubdivision(time.inn)};
    } else { //instanceof Asap!!
      return {ref: Tone.Transport.seconds};
    }
  }
}

//TODO GET RID OF THIS, NEEDS TO BE DYNAMIC, WITH DEPENDENCIES
function calculateEndTime(objects: ScheduledObject[]): string | number {
  let endTimes = objects.map(o => o.getScheduleTime()+o.getDuration());
  return Math.max(...endTimes);
}