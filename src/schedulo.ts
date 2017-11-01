import * as Tone from 'tone';
import { Time } from 'tone';
import { Scheduler, SchedulerId, ScheduledObject, Subdivision,
  ScheduleTime, ScheduleAt, ScheduleNext, ScheduleIn, ScheduleAfter,
  PlaybackMode, LoopMode,  TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut } from './types';

class TonejsScheduledObject implements ScheduledObject {
  constructor(public tonejsObjects: any[], public startTime: string | number, public duration: string | number) {}
}

type Player = any; // TODO write definitions in Tone.d.ts
interface ScheduleOptions {
  startTime: string | number;
  offset?: string | number;
  duration?: string | number;
}

interface SubsetPlayerOptions {
  url: string;
  loop: boolean;
  onload?: (player: Player) => void;
  playbackRate?: number;
}

export class Schedulo implements Scheduler {

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

  async scheduleAudio(fileUris: string[], startTime: ScheduleTime, mode: PlaybackMode): Promise<SchedulerId> {
    let time = this.calculateScheduleTime(startTime);
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

  transition(fromId: SchedulerId, toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<SchedulerId> {
    let time = this.calculateScheduleTime(startTime);
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

  scheduleEvent(trigger: () => any, time: ScheduleTime): SchedulerId {
    let startTime = this.calculateScheduleTime(time);
    return this.addScheduledObject(new Tone.Event(trigger).start(startTime));
  }

  stop(id: SchedulerId, time: ScheduleTime, mode: StoppingMode): void {
    let stopTime = this.calculateScheduleTime(time);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    let objects = this.scheduledObjects[id].tonejsObjects;
    objects.forEach(o => o.volume.linearRampTo(-Infinity, duration, stopTime));
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
      const {startTime, offset = 0} = scheduleOpts;
      const {url, onload = () => {}, ...otherOpts} = playerOpts;

      const calculateDuration = (
        buffer: AudioBuffer,
        {duration} = scheduleOpts
      ): number => {
        return duration ?
          new Time(duration).toSeconds() :
          buffer.duration - new Time(offset).toSeconds();
      };

      const setLoopPoints = (player: Player /*TODO Type*/, duration: number) => {
        if (playerOpts.loop) {
          player.loopStart = new Time(offset).toSeconds();
          player.loopEnd = new Time(duration).add(new Time(offset)).toSeconds();
        }
      }

      if (this.filenameCache.has(url)) {
        const buffer = new Tone.Buffer(
          this.filenameCache.get(url),
          (buffer: any) => {
            const player = new Tone.Player(buffer);
            const {loop = false, playbackRate = 1} = otherOpts;
            player.loop = loop;
            player.playbackRate = playbackRate;
            const duration = calculateDuration(buffer.get());
            setLoopPoints(player, duration)
            player.toMaster().sync().start(
              startTime,
              offset,
              duration
            );
            // if we already have the buffer, manually resolve
            // (Tone.js doesn't call onload for Buffers)
            resolve(player);
          }
        );
      } else {
        playerOpts.onload = player => {
          onload(player);
          this.filenameCache.set(url, player.buffer.get());
          const duration = calculateDuration(player.buffer.get());
          setLoopPoints(player, duration);
          player.toMaster().sync().start(
            startTime,
            offset,
            duration
          );
          resolve(player);
        };
        new Tone.Player(playerOpts);
      }
    });
  }

  private calculateScheduleTime(time: ScheduleTime): string | number {
    if (time instanceof ScheduleAfter) {
      return this.calculateEndTime(time.id);
    } else if (time instanceof ScheduleAt) {
      return time.at;
    } else if (time instanceof ScheduleNext) {
      let subdiv = time.next === Subdivision.Bar ? "1m" : "1n";
      return Tone.Transport.nextSubdivision(subdiv);
    } else if (time instanceof ScheduleIn) {
      return Tone.Transport.nextSubdivision(time.inn);
    } else {
      return Tone.Transport.seconds+0.1;
    }
  }

  private calculateEndTime(id: SchedulerId): string | number {
    const {startTime, duration = 0} = this.scheduledObjects[id];
    return new Time(startTime).add(new Time(duration)).toSeconds();
  }

}