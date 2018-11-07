/// <reference path="../Tone.d.ts" />
declare var global: any;
if (typeof window === 'undefined') {
  global.window = {};
}

import { Scheduler, ScheduloObject, AudioObject, EventObject,
  ScheduleTime, PlaybackMode, TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut, Parameter } from './types';
import { ScheduloEngine } from './engine/engine';
import { OwnEngine } from './engine/own-engine';
import { ToneEngine } from './engine/tone-engine';
import { defaultAudioTimings } from './life-cycle';
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

export enum Engines {
  OwnEngine,
  ToneEngine
}

export class Schedulo implements Scheduler {

  private scheduledObjects: ScheduloObject[] = [];
  private engine: ScheduloEngine;

  constructor(timings = defaultAudioTimings, fadeLength = 0.01, useTone = false) {
    const engineClass = useTone ? ToneEngine : OwnEngine;
    this.engine = new engineClass(fadeLength, timings);
    this.engine.start();
  }

  getAudioBank(): AudioBank {
    return this.engine.getAudioBank();
  }

  scheduleAudio(fileUris: string[], startTime: ScheduleTime, mode: PlaybackMode): AudioObject[] {
    const objects = fileUris.map(f => this.engine.createAudioObject(f, startTime));
    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  scheduleEvent(triggerFunction: () => any, startTime: ScheduleTime): EventObject {
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