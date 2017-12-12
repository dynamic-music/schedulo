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
  createPlayer: (startOffset: number) => Player;
  options: ScheduledOptions;
  buffer: AudioBuffer;
}

export function add(t1: string | number, t2: string | number): number {
  return new Time(t1).add(new Time(t2)).toSeconds();
}

function sub(t1: string | number, t2: string | number): number {
  return new Time(t1).sub(new Time(t2)).toSeconds();
}

export function createPlayerFactoryWithBuffer(
  args: ScheduleOptions & {
    loop: boolean;
    buffer: ToneBuffer;
    playbackRate?: number;
  },
): PlayerFactory {
  const {startTime, offset = 0, buffer, ...otherOpts} = args;

  const calculateDuration = (
    buffer: AudioBuffer,
    {duration} = otherOpts
  ): number => {
    return duration ?
      new Time(duration).toSeconds() :
      buffer.duration - new Time(offset).toSeconds();
  };

  const setLoopPoints = (player: Player, duration: number) => {
    if (otherOpts.loop) {
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

  const createPlayer = () => createAndInitPlayer(buffer);
  const duration = calculateDuration(buffer.get());
  return {
    createPlayer,
    options: {startTime, offset, duration},
    buffer: buffer.get()
  };
}

export interface CreateBufferParams {
  url: string;
  filenameCache: Map<String, AudioBuffer>;
}
export function createBuffer({
  filenameCache,
  url
}: CreateBufferParams): Promise<ToneBuffer> {
  return new Promise((resolve, reject) => {
    if (filenameCache.has(url)) {
      const buffer = new Tone.Buffer(
        filenameCache.get(url),
        (loaded: ToneBuffer) => {
          resolve(loaded);
        },
        (err: string) => reject(err)
      );
    } else {
      const buffer = new Tone.Buffer(
        url,
        (loaded: ToneBuffer) => {
          const buffer = loaded.get();
          filenameCache.set(url, buffer);
          resolve(loaded);
        },
        (err: string) => reject(err)
      );
    }
  });
}

export interface CreatePlayerAfterLoadingArgs {
  scheduleOpts: ScheduleOptions;
  playerOpts: SubsetPlayerOptions;
  filenameCache: Map<String, AudioBuffer>;
}
export function createPlayerFactoryAfterLoadingBuffer({
  scheduleOpts,
  playerOpts,
  filenameCache
}: CreatePlayerAfterLoadingArgs): Promise<PlayerFactory> {
  const { url, loop, playbackRate = 1 } = playerOpts;
  const toPlayerFactory = (buffer: ToneBuffer) => {
    return createPlayerFactoryWithBuffer({
      buffer,
      loop,
      playbackRate,
      ...scheduleOpts
    });
  }
  return createBuffer({
    url,
    filenameCache
  }).then(toPlayerFactory);
}