import * as Tone from 'tone';
import { Time, Player } from 'tone';
import { ScheduledObject } from './types';

export interface ScheduleOptions {
  startTime: string | number;
  offset?: string | number;
  duration?: string | number;
}

export interface ScheduledOptions {
  startTime: string | number;
  offset: string | number;
  duration: number;
}

export interface SubsetPlayerOptions {
  url: string;
  loop: boolean;
  onload?: (player: Player) => void;
  playbackRate?: number;
}

export interface PlayerFactory {
  createPlayer: () => Player;
  options: ScheduledOptions;
  buffer: AudioBuffer;
}

export function add(t1: string | number, t2: string | number): number {
  return new Time(t1).add(new Time(t2)).toSeconds();
}

function sub(t1: string | number, t2: string | number): number {
  return new Time(t1).sub(new Time(t2)).toSeconds();
}

export function createTonePlayer(
  scheduleOpts: ScheduleOptions,
  playerOpts: SubsetPlayerOptions,
  filenameCache: Map<String, AudioBuffer>
): Promise<PlayerFactory> {
  return new Promise((resolve, reject) => {
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
        player.loopEnd = add(duration, offset);
      }
    }

    const createAndInitPlayer = (buffer: ToneBuffer) => {
      const player = new Player(buffer);
      const {loop = false, playbackRate = 1} = otherOpts;
      player.loop = loop;
      player.playbackRate = playbackRate;
      const duration = calculateDuration(buffer.get());
      setLoopPoints(player, duration)
      return player;
    };

    if (filenameCache.has(url)) {
      const buffer = new Tone.Buffer(
        filenameCache.get(url),
        (loaded: ToneBuffer) => {
          const createPlayer = () => createAndInitPlayer(loaded);
          // if we already have the buffer, manually resolve
          // (Tone.js doesn't call onload for Buffers)
          const buffer = loaded.get();
          const duration = calculateDuration(buffer); // TODO remove dupe
          resolve({
            createPlayer,
            options: {startTime, offset, duration},
            buffer
          });
        }
      );
    } else {
      const buffer = new Tone.Buffer(
        url,
        (loaded: ToneBuffer) => {
          const buffer = loaded.get();
          filenameCache.set(url, buffer);
          const duration = calculateDuration(buffer);
          const createPlayer = () => createAndInitPlayer(loaded);
          resolve({
            createPlayer,
            options: {startTime, offset, duration},
            buffer
          });
        },
        (err: string) => reject(err)
      );
    }
  });
}