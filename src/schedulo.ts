import * as Tone from 'tone';
import { Time as ToneTime } from 'tone';
import { Scheduler, SchedulerId, ScheduledObject, Time, TimeType,
  StartTime, StartAt, StartNext, StartIn, StartAfter,
  PlaybackMode, LoopMode,  TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut } from './types';

class TonejsScheduledObject implements ScheduledObject {
  constructor(public tonejsObjects: any[], public startTime: Time, public duration: Time) {}
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

  private scheduledObjects: TonejsScheduledObject[] = [];
  private currentId = 0;
  private filenameCache = new Map<String, AudioBuffer>();

  setLoop(start: number, stop: number): void {
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = start;
    Tone.Transport.loopEnd = stop;
  }

  setTempo(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
  }

  setMeter(numerator: number, denominator: number): void {
    Tone.Transport.timeSignature = [numerator, denominator];
  }

  start(): void {
    Tone.Transport.start("+0.1");
  }

  async scheduleAudio(fileUris: string[], startTime: StartTime, mode: PlaybackMode): Promise<SchedulerId> {
    let time = this.calculateStartTime(startTime);
    let loop = mode instanceof LoopMode ? true : false;
    let players = await Promise.all(fileUris.map(f =>
      this.createTonePlayer({
        startTime: time,
        offset: mode.offset,
        duration: mode.duration
      }, {
        url: f,
        loop: loop
      })
    ));
    let duration = mode.duration ? mode.duration : Math.max(...players.map(p => p.buffer.duration));
    return this.addScheduledObject(new TonejsScheduledObject(players, time, duration));
  }

  transition(fromId: SchedulerId, toAudioFiles: string[], startTime: StartTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<SchedulerId> {
    let time = this.calculateStartTime(startTime);
    let duration = mode instanceof TransitionWithCrossfade ? mode.duration : 0;
    let objects = this.scheduledObjects[fromId].tonejsObjects;
    return this.scheduleAudio(toAudioFiles, startTime, playbackMode)
      .then(id => {
        this.scheduledObjects[id].tonejsObjects.forEach(o => {
          o.volume.value = -Infinity;
          o.volume.linearRampTo(0, duration, time);
        });
        objects.forEach(o => o.volume.linearRampTo(-Infinity, duration, time));
        return id;
      })
  }

  scheduleEvent(trigger: () => any, startTime: StartTime): SchedulerId {
    let time = this.calculateStartTime(startTime);
    return this.addScheduledObject(new Tone.Event(trigger).start(time));
  }

  stop(id: SchedulerId, startTime: StartTime, mode: StoppingMode): void {
    let time = this.calculateStartTime(startTime);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    let objects = this.scheduledObjects[id].tonejsObjects;
    objects.forEach(o => o.volume.linearRampTo(-Infinity, duration, time));
  }

  private addScheduledObject(object: TonejsScheduledObject): SchedulerId {
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

  private calculateStartTime(startTime: StartTime): Time {
    if (startTime instanceof StartAfter) {
      return this.calculateEndTime(startTime.id);
    } else if (startTime instanceof StartAt) {
      return startTime.at;
    } else if (startTime instanceof StartNext) {
      let subdiv = startTime.next === TimeType.Bar ? "1m" : "1n";
      return Tone.Transport.nextSubdivision(subdiv);
    } else if (startTime instanceof StartIn) {
      return Tone.Transport.nextSubdivision(startTime.inn);
    } else {
      return Tone.Transport.seconds+0.1;
    }
  }

  private calculateEndTime(id: SchedulerId): Time {
    const {startTime, duration = 0} = this.scheduledObjects[id];
    return new ToneTime(startTime).add(new ToneTime(duration)).toSeconds();
  }

}