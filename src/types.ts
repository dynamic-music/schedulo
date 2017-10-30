import { Observable } from 'rxjs';

export type SchedulerId = number;
export type Time = number | string;
export enum TimeType { Beat, Bar }


//TODO MAKE SCHEDULER OBJECT!!!!
//audio or event or buffers


export abstract class StartTime { private _:StartTime; } //avoid confusion with any
export class StartImmediately extends StartTime {}
export class StartAt extends StartTime {
  constructor(public at: Time) { super(); }
}
export class StartNext extends StartTime {
  constructor(public next: TimeType) { super(); }
}
export class StartAfter extends StartTime {
  constructor(public id: SchedulerId) { super(); }
}
export module Start {
  export var Immediately = new StartImmediately();
  export function At(time: Time): StartAt {
    return new StartAt(time);
  }
  export function Next(time: TimeType): StartNext {
    return new StartNext(time);
  }
  export function After(id: SchedulerId): StartAfter {
    return new StartAfter(id);
  }
}

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

export interface TransitionMode {}
export interface TransitionImmediately extends TransitionMode {}
export interface Crossfade extends TransitionMode {
  duration: Time
}

export interface StoppingMode {}
export interface Immediate extends StoppingMode {}
export interface Fade extends StoppingMode {
  duration: Time
}

export interface ScheduledObject {
  startTime: Time,
  duration?: Time
}
export interface AudioObject extends ScheduledObject {
  setAmplitude: (value: number) => void,
  setReverb: (amount: number) => void
}

export interface Scheduler {

  setTempo(bpm: number): void;
  setMeter(numerator: number, denominator: number): void;

  schedule(audioFilesOrEvent: string[] | (() => any), startTime: StartTime, mode: PlaybackMode): Promise<SchedulerId>;

  transitionTo(audioFiles: string[], time: StartTime, transitionMode: TransitionMode, playbackMode: PlaybackMode): SchedulerId;

  replaceAudio(audioFiles: string[], id: SchedulerId, time: StartTime, mode: PlaybackMode): SchedulerId;

  stop(id: SchedulerId, time: StartTime, mode: StoppingMode): void;
  stopAll(time: StartTime, mode: StoppingMode): void;

  //watch(id: SchedulerId): Observable<?>; //TODO change

  getCurrentTime(): number;
  getCurrentBeat(): number;
  getCurrentBar(): number;

}