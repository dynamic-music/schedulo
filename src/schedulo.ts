/// <reference path="../Tone.d.ts" />
declare var global: any;
if (typeof window === 'undefined') {
  global.window = {};
}

import { Scheduler, ScheduloObject, AudioObject, EventObject,
  ScheduleTime, PlaybackMode, TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut, Parameter, Fetcher } from './types';
import { ScheduloEngine } from './engine/engine';
//import { OwnEngine } from './engine/own-engine';
//import { ToneEngine } from './engine/tone-engine';
import { defaultAudioTimings, DynamicBufferLifeCycle } from './life-cycle';
import { AudioBank } from './audio-bank';

/*export type BufferLoadingScheme = 'preload' | 'dynamic';
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
};*/

export interface Effects {
  reverb: AudioNode;
  delay: AudioNode;
}

export class Schedulo implements Scheduler {

  private scheduledObjects: ScheduloObject[] = [];
  private engine: ScheduloEngine;
  private ready: Promise<any>;

  constructor(timings = defaultAudioTimings, fadeLength = 0.01, fetcher?: Fetcher, useTone = false) {
    this.ready = this.initEngine(timings, fadeLength, useTone, fetcher);
  }
  
  private async initEngine(timings: DynamicBufferLifeCycle, fadeLength: number, useTone: boolean, fetcher?: Fetcher) {
    this.engine = useTone ?
      new (await import('./engine/tone-engine')).ToneEngine(fadeLength, timings)
      : new (await import('./engine/own-engine')).OwnEngine(fadeLength, timings, fetcher);
    this.engine.start();
  }
  
  async isReady() {
    return this.ready;
  }

  pause(): void {
    this.engine.pause();
  }

  getAudioBank(): AudioBank {
    return this.engine.getAudioBank();
  }
  
  private resumeContextIfNeeded() {
    if (this.engine.getAudioContext().state === 'suspended')
      this.engine.getAudioContext().resume();
  }

  scheduleAudio(fileUris: string[], startTime: ScheduleTime, mode: PlaybackMode): AudioObject[] {
    this.resumeContextIfNeeded();
    const objects = fileUris.map(f => this.engine.createAudioObject(f, startTime));
    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  scheduleEvent(triggerFunction: () => any, startTime: ScheduleTime): EventObject {
    this.resumeContextIfNeeded();
    return this.engine.createEventObject(triggerFunction, startTime);
  }

  transition(from: AudioObject[], toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): AudioObject[] {
    const time = this.calcAbsoluteSchedTime(startTime);
    const duration = mode instanceof TransitionWithCrossfade ? mode.duration : 0;
    const obj = this.scheduleAudio(toAudioFiles, startTime, playbackMode)
    //fade in
    obj.forEach(o => {
      o.set(Parameter.Amplitude, -Infinity);
      o.ramp(Parameter.Amplitude, 0, duration, time);
    });
    //fade out
    from.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, time));
    return obj;
  }

  stopAudio(objects: AudioObject[], time: ScheduleTime, mode: StoppingMode): void {
    let stopTime = this.calcAbsoluteSchedTime(time);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    objects.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, stopTime));
  }

  private calcAbsoluteSchedTime(time: ScheduleTime): number {
    let absTime = this.engine.calculateScheduleTime(time);
    return absTime.ref + absTime.onset;
  }

}