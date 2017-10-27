import { Observable } from 'rxjs';

export type SchedulerId = number;

export interface Time {
  time: number;
}
export interface Beat {
  beat: number;
}
export interface Bar {
  bar: number;
}

export interface SchedulingTime {}
export interface StartImmediately extends SchedulingTime {}
export interface StartAt extends SchedulingTime {
  time: Time | Beat | Bar
}
export interface StartNext extends SchedulingTime {
  next: Beat | Bar
}

export interface PlaybackMode {}
export interface Oneshot extends PlaybackMode {}
export interface Loop extends PlaybackMode {
  times?: number
}

export interface TransitionMode {}
export interface TransitionImmediately extends TransitionMode {}
export interface Crossfade extends TransitionMode {
  duration: Time | Beat | Bar
}

export interface StoppingMode {}
export interface Immediate extends StoppingMode {}
export interface Fade extends StoppingMode {
  duration: Time | Beat | Bar
}

export interface ScheduledObject {}
export interface AudioObject {
  setAmplitude: (value: number) => void,
  setReverb: (amount: number) => void
}

export interface Scheduler {

  setTempo(bpm: number): void;
  setMeter(numerator: number, denominator: number): void;

  scheduleAudio(fileUris: string[], time: SchedulingTime, mode: PlaybackMode): SchedulerId;
  scheduleAudioAfter(id: SchedulerId, fileUris: string[], mode: PlaybackMode): SchedulerId;
  scheduleEvent(trigger: () => any, time: SchedulingTime, mode: PlaybackMode): SchedulerId;
  scheduleEventAfter(id: SchedulerId, trigger: () => any, mode: PlaybackMode): SchedulerId;

  transitionToAudio(fileUris: string[], time: SchedulingTime, transitionMode: TransitionMode, playbackMode: PlaybackMode): SchedulerId;

  replaceAudio(id: SchedulerId, time: SchedulingTime, mode: PlaybackMode): SchedulerId;

  stop(id: SchedulerId, time: SchedulingTime, mode: StoppingMode): void;
  stopAll(time: SchedulingTime, mode: StoppingMode): void;

  //watch(id: SchedulerId): Observable<?>; //TODO change

  getCurrentTime(): number;
  getCurrentBeat(): number;
  getCurrentBar(): number;

}