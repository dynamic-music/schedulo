export enum Subdivision { Beat, Bar }

//schedule time

export abstract class ScheduleTime { private _:ScheduleTime; } //avoid confusion with any
export class ScheduleImmediately extends ScheduleTime {}
export class ScheduleAt extends ScheduleTime {
  constructor(public at: string | number) { super(); }
}
export class ScheduleNext extends ScheduleTime {
  constructor(public next: Subdivision) { super(); }
}
export class ScheduleIn extends ScheduleTime {
  constructor(public inn: string | number) { super(); }
}
export class ScheduleAfter extends ScheduleTime {
  constructor(public objects: ScheduledObject[]) { super(); }
}
export module Time {
  export const Immediately = new ScheduleImmediately();
  export function At(time: string | number): ScheduleAt {
    return new ScheduleAt(time);
  }
  export function Next(time: Subdivision): ScheduleNext {
    return new ScheduleNext(time);
  }
  export function In(time: string | number): ScheduleIn {
    return new ScheduleIn(time);
  }
  export function After(objects: ScheduledObject[]): ScheduleAfter {
    return new ScheduleAfter(objects);
  }
}

//playback mode

export class PlaybackMode {
  private _:PlaybackMode; //avoid confusion with any
  constructor(public offset?: string | number, public duration?: string | number) {}
}
export class OneshotMode extends PlaybackMode {}
export class LoopMode extends PlaybackMode {
  constructor(public times?: number, offset?: string | number, duration?: string | number) {
    super(offset, duration);
  }
}
export module Playback {
  export function Oneshot(offset?: string | number, duration?: string | number): OneshotMode {
    return new OneshotMode(offset, duration);
  }
  export function Loop(times?: number, offset?: string | number, duration?: string | number): LoopMode {
    return new LoopMode(times, offset, duration);
  }
}

//transition mode

export class TransitionMode {
  private _:TransitionMode; //avoid confusion with any
}
export class TransitionImmediately extends TransitionMode {}
export class TransitionWithCrossfade extends TransitionMode {
  constructor(public duration: string | number) { super(); }
}
export module Transition {
  export const Immediately = new TransitionImmediately();
  export function CrossFade(duration: string | number): TransitionWithCrossfade {
    return new TransitionWithCrossfade(duration);
  }
}

//stopping mode

export class StoppingMode {
  private _:StoppingMode; //avoid confusion with any
}
export class StopImmediately extends StoppingMode {}
export class StopWithFadeOut extends StoppingMode {
  constructor(public duration: string | number) { super(); }
}
export module Stop {
  export const Immediately = new StopImmediately();
  export function FadeOut(duration: string | number): StopWithFadeOut {
    return new StopWithFadeOut(duration);
  }
}

//scheduled object

export enum Parameter {
  Amplitude,
  Reverb,
  Loop
}
export interface ScheduledObject {
  startTime: string | number,
  duration?: string | number
  //etc
}
export interface AudioObject extends ScheduledObject {
  set(param: Parameter, value: number): void,
  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void,
  stop(time: ScheduleTime, mode: StoppingMode): void
  //etc
}
export interface EventObject extends ScheduledObject {}

//scheduler

export interface Scheduler {

  setTempo(bpm: number): void;
  setMeter(numerator: number, denominator: number): void;

  scheduleAudio(audioFiles: string[], startTime: ScheduleTime, mode: PlaybackMode): Promise<AudioObject[]>;
  scheduleEvent(trigger: () => any, startTime: ScheduleTime): EventObject;

  transition(from: AudioObject[], toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<AudioObject[]>;

  stopAudio(audioObjects: AudioObject[], time: ScheduleTime, mode: StoppingMode): void;

  //replaceAudio(audioFiles: string[], id: SchedulerId, startTime: ScheduleTime, mode: PlaybackMode): SchedulerId;

}