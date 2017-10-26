import { Observable } from 'rxjs';

export type SchedulerId = number;

export interface SchedulerEvent {}
export interface AudioEvent extends SchedulerEvent {
	fileUris: string[]
}
export interface TriggerEvent extends SchedulerEvent {
  trigger: Function
}

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
  time: Beat | Bar
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

export interface Scheduler {

  start(event: SchedulerEvent, time: SchedulingTime, mode: PlaybackMode): SchedulerId;
  startAfter(id: SchedulerId, event: SchedulerEvent, mode: PlaybackMode): SchedulerId;

  transitionTo(event: SchedulerEvent, time: SchedulingTime, transitionMode: TransitionMode, playbackMode: PlaybackMode): SchedulerId;

  replace(id: SchedulerId, time: SchedulingTime, mode: PlaybackMode): SchedulerId;

  stop(id: SchedulerId, time: SchedulingTime, mode: StoppingMode): void;
  stopAll(time: SchedulingTime, mode: StoppingMode): void;

  watch(id: SchedulerId): Observable<SchedulerEvent>; //TODO change

  getCurrentTime(): number;
  getCurrentBeat(): number;
  getCurrentBar(): number;

}