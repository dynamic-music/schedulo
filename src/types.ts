export type SchedulerId = number;
export type StrOrNumTime = number | string;
export enum Subdivision { Beat, Bar }

//start StrOrNumTime

export abstract class ScheduleTime { private _:ScheduleTime; } //avoid confusion with any
export class ScheduleImmediately extends ScheduleTime {}
export class ScheduleAt extends ScheduleTime {
  constructor(public at: StrOrNumTime) { super(); }
}
export class ScheduleNext extends ScheduleTime {
  constructor(public next: Subdivision) { super(); }
}
export class ScheduleIn extends ScheduleTime {
  constructor(public inn: StrOrNumTime) { super(); }
}
export class ScheduleAfter extends ScheduleTime {
  constructor(public id: SchedulerId) { super(); }
}
export module Time {
  export const Immediately = new ScheduleImmediately();
  export function At(time: StrOrNumTime): ScheduleAt {
    return new ScheduleAt(time);
  }
  export function Next(time: Subdivision): ScheduleNext {
    return new ScheduleNext(time);
  }
  export function In(time: StrOrNumTime): ScheduleIn {
    return new ScheduleIn(time);
  }
  export function After(id: SchedulerId): ScheduleAfter {
    return new ScheduleAfter(id);
  }
}

//playback mode

export class PlaybackMode {
  private _:PlaybackMode; //avoid confusion with any
  constructor(public offset?: StrOrNumTime, public duration?: StrOrNumTime) {}
}
export class OneshotMode extends PlaybackMode {}
export class LoopMode extends PlaybackMode {
  constructor(public StrOrNumTimes?: number, offset?: StrOrNumTime, duration?: StrOrNumTime) {
    super(offset, duration);
  }
}
export module Playback {
  export function Oneshot(offset?: StrOrNumTime, duration?: StrOrNumTime): OneshotMode {
    return new OneshotMode(offset, duration);
  }
  export function Loop(times?: number, offset?: StrOrNumTime, duration?: StrOrNumTime): LoopMode {
    return new LoopMode(times, offset, duration);
  }
}

//transition mode

export class TransitionMode {
  private _:TransitionMode; //avoid confusion with any
}
export class TransitionImmediately extends TransitionMode {}
export class TransitionWithCrossfade extends TransitionMode {
  constructor(public duration: StrOrNumTime) { super(); }
}
export module Transition {
  export const Immediately = new TransitionImmediately();
  export function CrossFade(duration: StrOrNumTime): TransitionWithCrossfade {
    return new TransitionWithCrossfade(duration);
  }
}

//stopping mode

export class StoppingMode {
  private _:StoppingMode; //avoid confusion with any
}
export class StopImmediately extends StoppingMode {}
export class StopWithFadeOut extends StoppingMode {
  constructor(public duration: StrOrNumTime) { super(); }
}
export module Stop {
  export const Immediately = new StopImmediately();
  export function FadeOut(duration: StrOrNumTime): StopWithFadeOut {
    return new StopWithFadeOut(duration);
  }
}

//scheduled object

export interface ScheduledObject {
  startTime: StrOrNumTime,
  duration?: StrOrNumTime
}
export interface AudioObject extends ScheduledObject {
  setAmplitude: (value: number) => void,
  setReverb: (amount: number) => void
}

//scheduler

export interface Scheduler {

  setTempo(bpm: number): void;
  setMeter(numerator: number, denominator: number): void;

  scheduleAudio(audioFiles: string[], startTime: ScheduleTime, mode: PlaybackMode): Promise<SchedulerId>;
  scheduleEvent(trigger: () => any, startTime: ScheduleTime): SchedulerId;

  transition(fromId: SchedulerId, toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<SchedulerId>;

  //replaceAudio(audioFiles: string[], id: SchedulerId, startTime: ScheduleTime, mode: PlaybackMode): SchedulerId;

  stop(id: SchedulerId, StrOrNumTime: ScheduleTime, mode: StoppingMode): void;

}