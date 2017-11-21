import { Player, gainToDb } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime, StoppingMode } from './types';

export class TonejsScheduledObject implements ScheduledObject {
  constructor(
    public tonejsObject: any,
    public startTime: number | string,
    public offset?: number | string,
    public duration?: number | string,
  ) {}
}

export class TonejsAudioObject extends TonejsScheduledObject implements AudioObject {

  constructor(
    public tonejsPlayer: Player,
    public startTime: number | string,
    public offset?: number | string,
    public duration?: number | string
  ) {
    super(tonejsPlayer, startTime, offset, duration);
  }

  set(param: Parameter, value: number): void {
    console.log(Parameter[param], value)
    if (param === Parameter.Amplitude) {
      this.tonejsPlayer.volume.value = gainToDb(value);
    } else if (param === Parameter.PlaybackRate) {
      this.tonejsPlayer.playbackRate = value;
      /*this.tonejsPlayer.unsync().stop();
      this.tonejsPlayer = new Player();
      this.tonejsPlayer.playbackRate = value;*/
    } else if (param === Parameter.StartTime) {
      this.tonejsPlayer.unsync().stop();
      this.tonejsPlayer.sync().start(value);
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.tonejsPlayer.volume.linearRampTo(value, duration, time);
    }
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.tonejsPlayer.unsync().stop();
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {
  constructor(public tonejsEvent: any, public startTime: number | string) {
    super(tonejsEvent, startTime);
  }
}