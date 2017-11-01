import { Player } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime, StoppingMode } from './types';

export class TonejsScheduledObject implements ScheduledObject {
  constructor(public tonejsObject: any, public startTime: number | string, public duration?: number | string) {}
}

export class TonejsAudioObject extends TonejsScheduledObject implements AudioObject {

  constructor(public tonejsPlayer: Player, public startTime: number | string, public duration: number | string) {
    super(tonejsPlayer, startTime, duration);
  }

  set(param: Parameter, value: number): void {
    if (param === Parameter.Amplitude) {
      this.tonejsPlayer.volume.value = value;
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.tonejsPlayer.volume.linearRampTo(value, duration, time);
    }
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {
  constructor(public tonejsEvent: any, public startTime: number | string) {
    super(tonejsEvent, startTime);
  }
}