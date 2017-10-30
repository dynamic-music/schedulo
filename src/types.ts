export type SchedulerId = number;
export type Time = number | string;
export enum TimeType { Beat, Bar }

//start time

export abstract class StartTime { private _:StartTime; } //avoid confusion with any
export class StartImmediately extends StartTime {}
export class StartAt extends StartTime {
  constructor(public at: Time) { super(); }
}
export class StartNext extends StartTime {
  constructor(public next: TimeType) { super(); }
}
export class StartIn extends StartTime {
  constructor(public inn: Time) { super(); }
}
export class StartAfter extends StartTime {
  constructor(public id: SchedulerId) { super(); }
}
export module Start {
  export const Immediately = new StartImmediately();
  export function At(time: Time): StartAt {
    return new StartAt(time);
  }
  export function Next(time: TimeType): StartNext {
    return new StartNext(time);
  }
  export function In(time: Time): StartIn {
    return new StartIn(time);
  }
  export function After(id: SchedulerId): StartAfter {
    return new StartAfter(id);
  }
}

//playback mode

export class PlaybackMode {
  private _:PlaybackMode; //avoid confusion with any
  constructor(public offset?: Time, public duration?: Time) {}
}
export class OneshotMode extends PlaybackMode {}
export class LoopMode extends PlaybackMode {
  constructor(public times?: number, offset?: Time, duration?: Time) {
    super(offset, duration);
  }
}
export module Playback {
  export function Oneshot(offset?: Time, duration?: Time): OneshotMode {
    return new OneshotMode(offset, duration);
  }
  export function Loop(times?: number, offset?: Time, duration?: Time): LoopMode {
    return new LoopMode(times, offset, duration);
  }
}

//transition mode

export interface TransitionMode {}
export interface TransitionImmediately extends TransitionMode {}
export interface Crossfade extends TransitionMode {
  duration: Time
}

//stopping mode

export class StoppingMode {
  private _:StoppingMode; //avoid confusion with any
}
export class StopImmediately extends StoppingMode {}
export class StopWithFadeOut extends StoppingMode {
  constructor(public duration: Time) { super(); }
}
export module Stop {
  export const Immediately = new StopImmediately();
  export function FadeOut(duration: Time): StopWithFadeOut {
    return new StopWithFadeOut(duration);
  }
}

//scheduled object

export interface ScheduledObject {
  startTime: Time,
  duration?: Time
}
export interface AudioObject extends ScheduledObject {
  setAmplitude: (value: number) => void,
  setReverb: (amount: number) => void
}

//scheduler

export interface Scheduler {

  setTempo(bpm: number): void;
  setMeter(numerator: number, denominator: number): void;

  scheduleAudio(audioFiles: string[], startTime: StartTime, mode: PlaybackMode): Promise<SchedulerId>;
  scheduleEvent(trigger: () => any, startTime: StartTime): Promise<SchedulerId>;

  transitionTo(audioFiles: string[], startTime: StartTime, transitionMode: TransitionMode, playbackMode: PlaybackMode): SchedulerId;

  //replaceAudio(audioFiles: string[], id: SchedulerId, startTime: StartTime, mode: PlaybackMode): SchedulerId;

  stop(id: SchedulerId, time: StartTime, mode: StoppingMode): void;
  stopAll(time: StartTime, mode: StoppingMode): void;

}