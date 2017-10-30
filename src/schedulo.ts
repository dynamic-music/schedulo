import * as Tone from 'tone';
import { Time as ToneTime } from 'tone';
import { Scheduler, SchedulerId, StartTime, StartAt, StartNext, StartAfter,
  PlaybackMode, LoopMode, ScheduledObject, Time } from './types';

class TonejsScheduledObject implements ScheduledObject {
  constructor(private tonejsObject: any, public startTime: Time, public duration: Time) {}
}

type Player = any; // TODO write definitions in Tone.d.ts
interface ScheduleOptions {
  startTime: Time;
  offset?: Time;
  duration?: Time;
}

interface SubsetPlayerOptions {
  url: string;
  loop: boolean;
  onload?: (player: Player) => void;
  playbackRate?: number;
}

export class Schedulo {

  private scheduledObjects: ScheduledObject[] = [];
  private currentId = 0;
  private filenameCache = new Map<String, AudioBuffer>();

  setLoop(start: number, stop: number) {
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = stop;
  }

  setTempo(bpm: number) {
    Tone.Transport.bpm.value = bpm;
  }

  start() {
    Tone.Transport.start("+0.1");
  }

  async schedule(filesOrEvent: string[] | (() => any), startTime: StartTime, mode: PlaybackMode): Promise<SchedulerId> {
    let time: Time;
    if (startTime instanceof StartAfter) {
      time = this.calculateEndTime(startTime.id);
    } else if (startTime instanceof StartAt) {
      time = startTime.at;
    } /*//TODO else if (startTime instanceof StartNext) {
      time = GETCURRENTBAR + time.next;
    }*/else {
      time = Tone.Transport.seconds+0.1;
    }
    if (filesOrEvent instanceof Function) {
      return this.scheduleEvent(filesOrEvent, time, mode);
    }
    return this.scheduleAudio(filesOrEvent, time, mode);
  }

  private calculateEndTime(id: SchedulerId): Time {
    const {startTime, duration = 0} = this.scheduledObjects[id];
    return new ToneTime(startTime).add(new ToneTime(duration)).toSeconds();
  }

  private async scheduleAudio(fileUris: string[], startTime: Time, mode: PlaybackMode): Promise<SchedulerId> {
    let loop = mode instanceof LoopMode ? true : false;
    let players = await Promise.all(fileUris.map(f =>
      this.createTonePlayer({
        startTime: startTime,
        offset: mode.offset,
        duration: mode.duration
      }, {
        url: f,
        loop: loop
      })
    ));
    let duration = mode.duration ? mode.duration : Math.max(...players.map(p => p.buffer.duration));
    return this.addScheduledObject(new TonejsScheduledObject(players, startTime, duration));
  }

  private scheduleEvent(trigger: () => any, startTime: Time, mode: PlaybackMode): SchedulerId {
    return this.addScheduledObject(
      new Tone.Event(trigger).start(startTime));
  }

  private addScheduledObject(object: ScheduledObject): SchedulerId {
    this.scheduledObjects[this.currentId] = object;
    return this.currentId++;
  }

  private createTonePlayer(
    scheduleOpts: ScheduleOptions,
    playerOpts: SubsetPlayerOptions
  ): Promise<Player> {
    return new Promise(resolve => {
      const {startTime, offset, duration} = scheduleOpts;
      const {url, onload = () => {}, ...otherOpts} = playerOpts;

      if (this.filenameCache.has(url)) {
        const buffer = new Tone.Buffer(
          this.filenameCache.get(url),
          (buffer: any) => { 
            const player = new Tone.Player(buffer);
            const {loop = false, playbackRate = 1} = otherOpts;
            player.loop = loop;
            player.playbackRate = playbackRate;
            player.toMaster().sync().start(startTime, offset, duration);
            // if we already have the buffer, manually resolve
            // (Tone.js doesn't call onload for Buffers)
            resolve(player);
          }
        );
      } else {
        playerOpts.onload = player => {
          onload(player);
          this.filenameCache.set(url, player.buffer.get());
          resolve(player);
        };
        new Tone.Player(playerOpts).toMaster().sync().start(
          startTime,
          offset,
          duration
        );
      }
    }
    );
  }

}