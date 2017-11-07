declare var global: any;
if (typeof window === 'undefined') {
  global.window = {};
}

import * as Tone from 'tone';
import { Time, Player } from 'tone';
import { Scheduler, ScheduledObject, AudioObject, EventObject, Subdivision,
  ScheduleTime, ScheduleAt, ScheduleNext, ScheduleIn, ScheduleAfter,
  PlaybackMode, LoopMode,  TransitionMode, TransitionWithCrossfade,
  StoppingMode, StopWithFadeOut, Parameter } from './types';
import { TonejsScheduledObject, TonejsAudioObject, TonejsEventObject } from './tone-object';
import { calculateScheduleTimes, toBufferSegment } from './looping';

interface ScheduleOptions {
  startTime: string | number;
  offset?: string | number;
  duration?: string | number;
}

interface ScheduledOptions {
  startTime: string | number;
  offset: string | number;
  duration: number;
}

interface SubsetPlayerOptions {
  url: string;
  loop: boolean;
  onload?: (player: Player) => void;
  playbackRate?: number;
}

interface PlayerConfiguration {
  player: Player;
  options: ScheduledOptions;
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

  getCurrentTime(): number {
    return Tone.Transport.seconds;
  }

  async scheduleAudio(fileUris: string[], startTime: ScheduleTime, mode: PlaybackMode): Promise<AudioObject[]> {
    let time = this.calculateScheduleTime(startTime);
    let loop = mode instanceof LoopMode;

    const playersToSetup = await Promise.all(fileUris.map(f =>
      this.createTonePlayer({
        startTime: time,
        offset: mode.offset,
        duration: mode.duration
      }, {
        url: f,
        loop: loop
      })
    ));

    const {times = 0} = Object.assign({times: 0}, mode);
    const hasRepeats = times > 0 && isFinite(times);

    const scheduleTimes = hasRepeats && mode instanceof LoopMode ?
      calculateScheduleTimes(
        times,
        playersToSetup.map(({player, options}) => {
          const {offset, duration} = options;
          player.loop = false;
          return toBufferSegment(player.buffer, {
            offset: new Time(offset).toSeconds(),
            duration: new Time(duration).toSeconds()
          });
        }),
        {
          scheduleTimeOffset: new Time(time).toSeconds()
        }
      ) : { // this is ugly, not actually the same type
        times: [],
        duration: null
      };

    const objects = playersToSetup.map(({player, options}, i) => {
      const {startTime, offset, duration} = options;

      if (scheduleTimes.times.length) {
        player.toMaster().sync();
        scheduleTimes.times[i].forEach(time => {
          player.start(
            time.startTime,
            time.offset,
            time.duration
          ).stop(time.stopTime);
        });
      } else {
        player.toMaster().sync().start(
          startTime,
          offset,
          duration
        );
      }
      return new TonejsAudioObject(
        player,
        startTime,
        scheduleTimes.duration || duration
      );
    });

    this.scheduledObjects = this.scheduledObjects.concat(objects);
    return objects;
  }

  transition(from: AudioObject[], toAudioFiles: string[], startTime: ScheduleTime, mode: TransitionMode, playbackMode: PlaybackMode): Promise<AudioObject[]> {
    let time = this.calculateScheduleTime(startTime);
    let duration = mode instanceof TransitionWithCrossfade ? mode.duration : 0;
    return this.scheduleAudio(toAudioFiles, startTime, playbackMode)
      .then(obj => {
        //fade in
        obj.forEach(o => {
          o.set(Parameter.Amplitude, -Infinity);
          o.ramp(Parameter.Amplitude, 0, duration, time);
        });
        //fade out
        from.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, time));
        return obj;
      })
  }

  scheduleEvent(trigger: () => any, time: ScheduleTime): EventObject {
    let startTime = this.calculateScheduleTime(time);
    return new TonejsEventObject(new Tone.Event(trigger).start(startTime), startTime);
  }

  stopAudio(objects: AudioObject[], time: ScheduleTime, mode: StoppingMode): void {
    let stopTime = this.calculateScheduleTime(time);
    let duration = mode instanceof StopWithFadeOut ? mode.duration : 0;
    objects.forEach(o => o.ramp(Parameter.Amplitude, -Infinity, duration, stopTime));
  }

  private createTonePlayer(
    scheduleOpts: ScheduleOptions,
    playerOpts: SubsetPlayerOptions
  ): Promise<PlayerConfiguration> {
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

      const setLoopPoints = (player: Player, duration: number) => {
        if (playerOpts.loop) {
          player.loopStart = new Time(offset).toSeconds();
          player.loopEnd = this.add(duration, offset);
        }
      }

      if (this.filenameCache.has(url)) {
        const buffer = new Tone.Buffer(
          this.filenameCache.get(url),
          (buffer: any) => {
            const player = new Player(buffer);
            const {loop = false, playbackRate = 1} = otherOpts;
            player.loop = loop;
            player.playbackRate = playbackRate;
            const duration = calculateDuration(buffer.get());
            setLoopPoints(player, duration)
            // if we already have the buffer, manually resolve
            // (Tone.js doesn't call onload for Buffers)
            resolve({player, options: {startTime, offset, duration}});
          }
        );
      } else {
        playerOpts.onload = player => {
          onload(player);
          this.filenameCache.set(url, player.buffer.get());
          const duration = calculateDuration(player.buffer.get());
          setLoopPoints(player, duration);
          resolve({player, options: {startTime, offset, duration}});
        };
        new Player(playerOpts);
      }
    });
  }

  private calculateScheduleTime(time: ScheduleTime): string | number {
    if (time instanceof ScheduleAfter) {
      return this.calculateEndTime(time.objects);
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

  private calculateEndTime(objects: ScheduledObject[]): string | number {
    let endTimes = objects.map(({offset, duration = 0}) => this.add(offset, duration));
    return Math.max(...endTimes);
  }

  private add(t1: string | number, t2: string | number): number {
    return new Time(t1).add(new Time(t2)).toSeconds();
  }

  private sub(t1: string | number, t2: string | number): number {
    return new Time(t1).sub(new Time(t2)).toSeconds();
  }

}