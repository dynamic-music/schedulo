/// <reference path="../Tone.d.ts" />
import {
  TonejsAudioObject as ToneAudioEvent
} from './tone-object';
import {
  AudioObject as IAudioEvent,
  Parameter,
  ScheduleTime,
  StoppingMode,
  PlaybackMode,
  LoopMode,
  AudioStatus
} from './types';
import * as Tone from 'tone';
import { Event, Time, gainToDb, Emitter } from 'tone';
import { calculateScheduleTimes, toBufferSegment } from './looping';
import {
  createPlayerFactoryAfterLoadingBuffer,
  PlayerFactory,
  add
} from './tone-helpers';


export interface LifeCycleWindow {
  countIn: number;
  countOut: number;
}

export interface TimeLimited {
  [state: string]: LifeCycleWindow; // TODO string is not strict enough
}

export interface LifeCycleTimings {
  connectToGraph: LifeCycleWindow;
}

interface IDisposable {
  dispose(): void;
}

export const defaultAudioTimings: LifeCycleTimings = {
  connectToGraph: {countIn: 2, countOut: 2}
};

export type LifeCycleStates<Timings extends TimeLimited> = keyof Timings;
export interface LifeCycleMapping<T> { // TODO rename to something more meaningful
  inEvent: T;
  outEvent: T;
  event: T;
}
export type LifeCycleFunctions<Timings extends TimeLimited> = {
  [Key in keyof Timings]: LifeCycleMapping<(time: number) => void>;
}

export interface ManagedEventTimes<T> {
  startTime: number;
  duration?: number;
  timings: T;
}

export interface ManagedAudioEventArgs
extends ManagedEventTimes<LifeCycleTimings> {
  createPlayer: (startOffset: number) => Player;
  reverb: AudioNode;
  delay: AudioNode;
}

interface ParameterStateHandling {
  currentValue: number | number[];
  handler: (n: number | number[]) => void;
}

export interface ManagedEventArgs<T extends TimeLimited> {
  times: ManagedEventTimes<T>;
  functions: LifeCycleFunctions<T>;
}
export class ManagedEvent<T extends TimeLimited>
implements IEmitter<LifeCycleStates<T>, number> {

  private scheduled: Map<LifeCycleStates<T>, LifeCycleMapping<IDisposable>>;
  private emitter: IEmitter<LifeCycleStates<T>, number>;
  private currentTimes: ManagedEventTimes<T>;
  private functions: LifeCycleFunctions<T>;

  constructor(args: ManagedEventArgs<T>) {
    const { times, functions } = args;
    this.emitter = new Emitter();
    this.scheduled = new Map();
    this.functions = functions;
    this.times = times;
  }

  set startTime(startTime: number) {
    this.times = {
      ...this.currentTimes,
      startTime
    };
  }

  set duration(duration: number) {
    this.times = {
      ...this.currentTimes,
      duration
    };
  }

  dispose(): this {
    this.clear();
    this.emitter.dispose();
    return this;
  }

  emit(event: keyof T, ...args: number[]): this {
    this.emitter.emit(event, ...args);
    return this;
  }

  off(event: keyof T, callback?: ((...args: number[]) => void) | undefined): this {
    this.emitter.off(event, callback);
    return this;
  }

  on(event: keyof T, callback: (...args: number[]) => void): this {
    this.emitter.on(event, callback);
    return this;
  }


  private set times(times: ManagedEventTimes<T>) {
    this.currentTimes = times;
    this.clear();
    this.schedule();
  }

  private clear() {
    this.scheduled.forEach(({inEvent, outEvent, event}) => {
      inEvent.dispose();
      outEvent.dispose();
      event.dispose();
    });
    this.scheduled.clear();
  }

  private schedule() {
    const { timings, startTime, duration = 0 } = this.currentTimes;
    Object.keys(timings).forEach(key => {
      const { countIn, countOut } = timings[key];
      const constrain = (preLoadTime: number) => {
        return preLoadTime < Tone.Transport.seconds ?
          Tone.Transport.seconds : preLoadTime
      };

      const createEvent = (
        key: string,
        event: (t: number) => void,
        startTime: number
      ) => {
        const e = new Event(time => {
          e.stop(); // TODO is this necessary?
          event(time);
          this.emit(key, startTime);
        });
        e.start(startTime);
        return e;
      };

      const { inEvent, outEvent, event } = this.functions[key];

      this.scheduled.set(key, {
        inEvent: createEvent(
          `${key}In`,
          inEvent,
          constrain(startTime - countIn)
        ),
        outEvent: createEvent(
          `${key}Out`,
          outEvent,
          startTime + duration + countOut
        ),
        event: createEvent(key, event, startTime)
      });
    });
  }
}

export class ManagedAudioEvent implements IAudioEvent {
  /** Event stuff
   * duration?: string | number | undefined;
  * */
  private scheduled: Map<string, IDisposable>; // TODO, could this just be an array?
  private originalStartTimeSecs: number;
  private startTimeSecs: number;
  private durationSecs: number;
  private timings: LifeCycleTimings;
  private createPlayer: (startOffset: number) => Player;
  private parameterDispatchers: Map<Parameter, ParameterStateHandling>;
  private emitter: IEmitter<AudioStatus, number | string>;
  private player: Player;
  private panner: Panner3D;
  private reverb: AudioNode;
  private delay: AudioNode;
  private reverbVolume: Volume;
  private delayVolume: Volume;


  constructor({startTime, duration = 0, ...otherParams}: ManagedAudioEventArgs) {
    const { timings = defaultAudioTimings, createPlayer,
      reverb, delay } = otherParams;
    this.emitter = new Emitter();
    this.createPlayer = createPlayer;
    this.reverb = reverb;
    this.delay = delay;
    this.timings = timings;
    this.scheduled = new Map();
    this.parameterDispatchers = new Map();
    this.startTimeSecs = new Time(startTime).toSeconds();
    this.originalStartTimeSecs = this.startTimeSecs;
    this.durationSecs = new Time(duration).toSeconds();
    // TODO above might not be needed, i.e. the setter for startTime takes care of it
    this.startTime = startTime;
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      {
        currentValue: 1.0,
        handler: n => this.player.volume.value = gainToDb(<number>n)
      }
    );
    this.parameterDispatchers.set(
      Parameter.Panning,
      {
        currentValue: [0.0, 0.0, 0.0],
        handler: n => this.panner.setPosition(
          (<number[]>n)[0], (<number[]>n)[1], (<number[]>n)[2]
        )
      }
    );
    this.parameterDispatchers.set(
      Parameter.Reverb,
      {
        currentValue: 0.0,
        handler: n => this.reverbVolume.volume.value = gainToDb(<number>n)
      }
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      {
        currentValue: 0.0,
        handler: n => this.delayVolume.volume.value = gainToDb(<number>n)
      }
    );
    this.parameterDispatchers.set(
      Parameter.PlaybackRate,
      {
        currentValue: 1.0,
        handler: n => this.player.playbackRate = <number>n
      }
    );
    this.parameterDispatchers.set(
      Parameter.StartTime,
      {
        currentValue: this.originalStartTimeSecs,
        handler: n => {
          const now = Tone.Transport.seconds;
          const isCurrentlyPlaying = now >= this.startTimeSecs &&
            now < this.startTimeSecs + this.durationSecs;
          if (!isCurrentlyPlaying) {
            this.startTime = <number>n;
          }
        }
      }
    );
  }

  get duration(): string | number {
    return this.durationSecs;
  }

  get startTime(): number | string {
    return this.startTimeSecs;
  }

  set startTime(t: number | string) {
    // TODO shift events etc
    if (this.scheduled) {
      this.reset();
    }
    this.startTimeSecs = new Time(t).toSeconds();
    const startOffset = this.startTimeSecs - this.originalStartTimeSecs;
    const { connectToGraph } = this.timings;
    // check relative to current time? not negative? etc
    // schedule to create the player (i.e. connect to graph)
    // at the given time minus the managed timing for this object
    // schedule to play at the given offset
    const disconnectAndDispose = new Event(() => {
      const player = this.scheduled.get('player');
      if (player) {
        player.dispose();
        this.scheduled.delete('player');
      }
      disconnectAndDispose.stop();
    });
    disconnectAndDispose.start(
      this.startTimeSecs + this.durationSecs + connectToGraph.countOut
    );
    this.scheduled.set('dispose', disconnectAndDispose);

    const connectAndScheduleToPlay = new Event(() => {
      // TODO, de-couple buffer loading from player creation
      this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
      this.delayVolume = new Tone.Volume(0).connect(this.delay);
      this.panner = new Tone.Panner3D(0, 0, 0).toMaster()
        .connect(this.reverbVolume).connect(this.delayVolume);
      this.player = this.createPlayer(startOffset).connect(this.panner);
      this.scheduled.set('player', this.player);
      this.parameterDispatchers.forEach(({handler, currentValue}, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          handler(currentValue);
        }
      });
      connectAndScheduleToPlay.stop();
    });
    const preLoadTime = this.startTimeSecs - connectToGraph.countIn;
    connectAndScheduleToPlay.start(preLoadTime < Tone.Transport.seconds ?
      Tone.Transport.seconds : preLoadTime
    );
    this.scheduled.set('connect', connectAndScheduleToPlay);
    // naively fire events which ought to align with when the player starts and stops
    const isPlaying = new Event(time => {
      this.emit('playing', time);
      isPlaying.stop();
    });
    const hasStopped = new Event(time => {
      this.emit('stopped', time);
      hasStopped.stop();
    });
    this.scheduled.set('playing', isPlaying);
    this.scheduled.set('stopped', hasStopped);
    isPlaying.start(this.startTimeSecs);
    hasStopped.start(this.startTimeSecs + this.durationSecs);
  }

  set(param: Parameter, value: number): void {
    const dispatch = this.parameterDispatchers.get(param);
    const player = this.scheduled.get('player');
    if (dispatch && dispatch.handler) {
      dispatch.currentValue = value;
      if (player) {
        dispatch.handler(value);
      }
    }
  }

  ramp(
    param: Parameter,
    value: number,
    duration: string | number,
    time: string | number
  ): void {
    throw new Error("Method not implemented."); // TODO
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    // TODO stopping modes etc, clean up is different depending on mode
    this.emit('stopped', Tone.Transport.seconds);
    this.reset();
  }

  dispose(): this {
    this.emitter.dispose();
    return this;
  }

  emit(event: AudioStatus, ...args: (string | number)[]): this {
    this.emitter.emit(event, ...args);
    return this;
  }

  off(
    event: AudioStatus,
    callback?: ((...args: (string | number)[]) => void)
  ): this {
    this.emitter.off(event, callback);
    return this;
  }

  on(
    event: AudioStatus,
    callback: (...args: (string | number)[]) => void
  ): this {
    this.emitter.on(event, callback);
    return this;
  }

  private reset() {
    this.scheduled.forEach(event => event.dispose());
    this.scheduled = new Map();
  }
}

interface ScheduleToLoadArgs {
  startTime: number;
  duration: number;
  uri: string;
}

// TODO, tidy - this is pretty messy
// TODO, seperate buffer loading from player instantiation
// TODO, the 'looping' logic is mixed up in this too - bad idea?

export interface SetupPlayerParams {
  startTime: ScheduleTime;
  mode: PlaybackMode;
  time: string | number;
  timings: LifeCycleTimings;
}
export interface SetupPlayerFromFilesParams extends SetupPlayerParams {
  fileUris: string[];
  reverb: AudioNode;
  delay: AudioNode;
  filenameCache: Map<String, AudioBuffer>;
}

export interface SetupEventsWithFactories extends SetupPlayerParams {
  factories: PlayerFactory[];
}

function toLoopingPlayerFactories({
  factories,
  startTime,
  mode,
  time,
  timings
}: SetupEventsWithFactories): PlayerFactory[] {
  const {times = 0} = Object.assign({times: 0}, mode);
  const hasRepeats = times > 0 && isFinite(times);

  const scheduleTimes = hasRepeats && mode instanceof LoopMode ?
    calculateScheduleTimes(
      times,
      factories.map(({createPlayer, options, reverb, delay, buffer}) => {
        const {offset, duration} = options;
        return toBufferSegment(buffer, {
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

  return factories.map(({createPlayer, options, reverb, delay, buffer}, i) => {
    const {startTime, offset, duration} = options;
    const wrapped = (startOffset: number = 0.0) => {
      const player = createPlayer(startOffset);
      if (scheduleTimes.times.length) {
        player.sync();
        scheduleTimes.times[i].forEach(time => {
          player.start(
            startOffset + time.startTime,
            time.offset,
            time.duration
          ).stop(startOffset + time.stopTime);
        });
      } else {
        player.sync().start(
          add(startOffset, startTime),
          offset,
          duration
        );
      }
      if (hasRepeats && mode instanceof LoopMode) {
        player.loop = false;
      }
      return player;
    };
    return {
      createPlayer: wrapped,
      options: {
        ...options,
        duration: scheduleTimes.duration || duration // TODO, is this correct?
      },
      reverb,
      delay,
      buffer
    }
  });
}

export async function setupTonePlayers({
  fileUris,
  startTime,
  mode,
  time,
  reverb,
  delay,
  filenameCache,
  timings
}: SetupPlayerFromFilesParams): Promise<ManagedAudioEvent[]> {
  const loop = mode instanceof LoopMode;
  const factories = await Promise.all(fileUris.map(f =>
    createPlayerFactoryAfterLoadingBuffer(
      {
        startTime: time,
        offset: mode.offset,
        duration: mode.duration
      },
      {
        url: f,
        loop
      },
      reverb,
      delay,
      filenameCache
    )
  ));

  return toLoopingPlayerFactories({
    factories,
    startTime,
    mode,
    time,
    timings
  }).map(({createPlayer, reverb, delay, options: {startTime, duration}}) => {
    return new ManagedAudioEvent({
      createPlayer,
      reverb,
      delay,
      startTime: new Time(startTime).toSeconds(),
      duration,
      timings
    });
  });
}