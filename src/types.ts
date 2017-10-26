import { Observable } from 'rxjs';

export type SchedulerId = number;

export interface SchedulerEvent {}
export interface AudioEvent extends SchedulerEvent {
	fileUris: string[]
}
export interface AudioEvent extends SchedulerEvent {
	fileUris: string[]
}

export interface SchedulingTime {}
export interface Immediately extends SchedulingTime {}
export interface Time extends SchedulingTime {
	time: number;
}
export interface Beat extends SchedulingTime {
	beat: number;
}
export interface Bar extends SchedulingTime {}
export interface NextBeat extends SchedulingTime {}
export interface NextBar extends SchedulingTime {}

export interface SchedulingMode {}
export interface Oneshot extends SchedulingMode {}
export interface Loop extends SchedulingMode {}
export interface Repeat extends SchedulingMode {
  times: number
}

export interface SchedulingOptions {
  mode: SchedulingMode
}

export interface Scheduler {
  schedule(event: SchedulerEvent, time: SchedulingTime, mode: SchedulingMode): SchedulerId;
  schedulerAfter(id: SchedulerId, event: SchedulerEvent, mode: SchedulingMode): SchedulerId;

  stop(id: SchedulerId, time: SchedulingTime): SchedulerId;

  getCurrentTime(): number;
  getCurrentBeat(): number;
  getCurrentBar(): number;

  watch(id: SchedulerId): Observable<SchedulerEvent>; //TODO change
}