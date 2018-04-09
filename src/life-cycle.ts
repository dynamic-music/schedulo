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
  add,
  createBuffer,
  createPlayerFactoryWithBuffer
} from './tone-helpers';
import { Effects } from './schedulo';


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

export interface BufferLoader {
  fetch(): Promise<ToneBuffer>;
}
export interface DynamicBufferLifeCycle extends LifeCycleTimings {
  loadBuffer: LifeCycleWindow;
}

export interface IDisposable {
  dispose(): void;
}

export const defaultAudioTimings: DynamicBufferLifeCycle = {
  connectToGraph: {countIn: 2, countOut: 2},
  loadBuffer: {countIn: 5, countOut: 5}
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
  offset?: number;
  timings: T;
}

export interface ManagedAudioEventArgs<T extends LifeCycleTimings>
extends ManagedEventTimes<T> {
  createPlayer: (startOffset: number) => Player;
  effects: Effects;
}

export interface DynamicBufferingManagedAudioEventArgs
extends ManagedEventTimes<DynamicBufferLifeCycle> {
  bufferResolver: BufferLoader;
  effects: Effects;
}

export interface ParameterStateHandling<T> {
  currentValue: T;
  handler: (n: T) => void;
}

export type SingleOrMultiValueDispatcher =
  StoredValueHandler<number>
  | StoredValueHandler<number[]>;

export class StoredValueHandler<T> {
  constructor(public stored: ParameterStateHandling<T>) {}
  update(): void {
    this.stored.handler(this.stored.currentValue);
  }
}

// Tone.js won't schedule an event if it isn't in the future,
// so this function checks against "now" and adds a small offset
function calculateStartTime(ideal: number, now: number, delta: number = 0.1) {
  return ideal <= now ? now + delta : ideal;
}

/*export class ManagedAudioEvent implements IAudioEvent {
  /** Event stuff
   * duration?: string | number | undefined;
  * *
  protected startTimeSecs: number;
  protected durationSecs: number;
  protected offsetSecs: number;
  protected createPlayer: (startOffset: number) => Player;
  protected scheduled: Map<string, IDisposable>; // TODO, could this just be an array?
  protected durationDependentKeys: string[]; // TODO, union type instead of string?
  protected startTimeDependentKeys: string[]; // TODO, union type instead of string?
  protected hasScheduledEmptyPlayer: boolean;
  private originalStartTimeSecs: number;
  private timings: LifeCycleTimings;
  private parameterDispatchers: Map<Parameter, SingleOrMultiValueDispatcher>;
  private emitter: IEmitter<AudioStatus, number | string>;
  private player: Player;
  private panner: Panner3D;
  private reverb: AudioNode;
  private delay: AudioNode;
  private reverbVolume: Volume;
  private delayVolume: Volume;


  constructor({
    startTime,
    duration = 0,
    offset = 0,
    ...otherParams
  }: ManagedAudioEventArgs<LifeCycleTimings>){
    const {
      timings = defaultAudioTimings,
      createPlayer,
      effects
    } = otherParams;
    this.hasScheduledEmptyPlayer = false;
    this.durationDependentKeys = ['stopped', 'dispose-player'];
    this.startTimeDependentKeys = ['player', 'connect', 'playing'];
    this.emitter = new Emitter();
    this.createPlayer = createPlayer;
    this.reverb = effects.reverb;
    this.delay = effects.delay;
    this.timings = timings;
    this.scheduled = new Map();
    this.parameterDispatchers = new Map();
    this.startTimeSecs = new Time(startTime).toSeconds();
    this.originalStartTimeSecs = this.startTimeSecs;
    this.durationSecs = new Time(duration).toSeconds();
    this.offsetSecs = new Time(offset).toSeconds();
    // TODO above might not be needed, i.e. the setter for startTime takes care of it
    this.startTime = startTime;
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => this.player.volume.value = gainToDb(n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Panning,
      new StoredValueHandler({
        currentValue: [0.0, 0.0, 0.0],
        handler: (n: number[]) => this.panner.setPosition(
          n[0], n[1], n[2]
        )
      })
    );
    this.parameterDispatchers.set(
      Parameter.Reverb,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.reverbVolume.volume.value = gainToDb(n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.delayVolume.volume.value = gainToDb(n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.PlaybackRate,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => this.player.playbackRate = n
      })
    );
    this.parameterDispatchers.set(
      Parameter.StartTime,
      new StoredValueHandler({
        currentValue: this.originalStartTimeSecs,
        handler: (n: number) => {
          const now = Tone.Transport.seconds;
          const isCurrentlyPlaying = now >= this.startTimeSecs &&
            now < this.startTimeSecs + this.durationSecs;
          if (!isCurrentlyPlaying) {
            this.startTime = n;
          }
        }
      })
    );
  }

  get duration(): string | number {
    return this.durationSecs;
  }

  set duration(d: string | number) {
    this.durationSecs = new Time(d).toSeconds();
    this.scheduled.forEach((e, key) => {
      if (this.durationDependentKeys.includes(key)) {
        e.dispose();
      }
    });
    this.calculateDurationDependentEvents();
  }

  get startTime(): number | string {
    return this.startTimeSecs;
  }

  set startTime(t: number | string) {
    this.startTimeSecs = new Time(t).toSeconds();
    this.calculateEvents();
  }

  set(param: Parameter, value: number | number[]): void {
    const dispatch = this.parameterDispatchers.get(param);
    const player = this.scheduled.get('player');
    if (dispatch) {
      dispatch.stored.currentValue = value;
      if (player) {
        dispatch.update();
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

  protected calculateStartTimeDependentEvents(): boolean {
    const startOffset = this.startTimeSecs - this.originalStartTimeSecs;
    const { connectToGraph } = this.timings;
    const connectAndScheduleToPlay = new Event(() => {
      this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
      this.delayVolume = new Tone.Volume(0).connect(this.delay);
      this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
      this.panner.connect(this.reverbVolume).connect(this.delayVolume);
      this.player = this.createPlayer(startOffset).connect(this.panner);
      this.player.fadeIn = 0.02
      this.player.fadeOut = 0.02
      console.log('connected', Tone.Transport.seconds)
      if (!this.player.buffer.duration) {
        this.hasScheduledEmptyPlayer = true;
        // bail out of doing any further scheduling if we aren't ready
        return false;
      }
      this.scheduled.set('player', this.player);
      this.parameterDispatchers.forEach((storedValue, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          storedValue.update();
        }
      });
      connectAndScheduleToPlay.stop();
      const isPlaying = new Event(time => {
        this.emit('playing', time);
        isPlaying.stop();
      });
      this.scheduled.set('playing', isPlaying);
      isPlaying.start(this.startTimeSecs);
      console.log('scheduled', Tone.Transport.seconds)
      this.emit('scheduled');
    });
    const preLoadTime = this.startTimeSecs - connectToGraph.countIn;
    const now = Tone.Transport.seconds;
    const toScheduleTime = calculateStartTime(preLoadTime, now);
    console.log('event', this.startTimeSecs, this.originalStartTimeSecs, toScheduleTime)
    //if (toScheduleTime < this.startTimeSecs) {
      connectAndScheduleToPlay.start(toScheduleTime);
      this.scheduled.set('connect', connectAndScheduleToPlay);
      return true;
    /*} else {
      return false;
    }*
  }

  protected calculateDurationDependentEvents() {
    const { connectToGraph } = this.timings;
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
    this.scheduled.set('dispose-player', disconnectAndDispose);
    const hasStopped = new Event(time => {
      this.emit('stopped', time);
      hasStopped.stop();
    });
    this.scheduled.set('stopped', hasStopped);
    hasStopped.start(this.startTimeSecs + this.durationSecs);
  }

  protected calculateEvents() {
    if (this.scheduled) {
      this.reset();
    }
    const wereScheduled = this.calculateStartTimeDependentEvents();
    if (wereScheduled) {
      this.calculateDurationDependentEvents();
    }
  }

  private reset() {
    this.scheduled.forEach(event => event.dispose());
    this.scheduled = new Map();
  }
}

export class DynamicBufferingManagedAudioEvent extends ManagedAudioEvent {
  private bufferResolver: BufferLoader;
  private loadBufferTimings: LifeCycleWindow;

  constructor({
    bufferResolver,
    ...args
  }: DynamicBufferingManagedAudioEventArgs) {
    super({
      ...args,
      createPlayer: (n: number) => new Tone.Player({}) // needs to be replaced later
    });
    const {loadBuffer} = args.timings;
    this.loadBufferTimings = loadBuffer;
    this.bufferResolver = bufferResolver;
    // we need to reset, super() already set up stuff on the timeline
    this.startTime = args.startTime;
  }

  protected calculateEvents() {
    super.calculateEvents();
    if (this.loadBufferTimings) {
      this.setupLoadEvent(this.startTimeSecs);
    }
  }

  private setupLoadEvent(time: number) {
    const scheduledLoadEvent = this.scheduled.get('loaded');
    if (scheduledLoadEvent) {
      scheduledLoadEvent.dispose();
    }
    const toSchedule = new Event(async () => {
      toSchedule.stop();
      const buffer = await this.bufferResolver.fetch();
      this.duration = buffer.duration; // TODO looping
      const playerFactory = createPlayerFactoryWithBuffer({
        startTime: time,
        offset: this.offsetSecs,
        duration: this.durationSecs,
        loop: false, // TODO, can't loop until dynamic looping is implemented
        buffer
      });
      this.createPlayer = (startOffset: number) => {
        const player = playerFactory.createPlayer(startOffset);
        player.sync().start(
          startOffset + this.startTimeSecs,
          this.offsetSecs,
          this.durationSecs
        );
        return player;
      }
      if (this.hasScheduledEmptyPlayer) {
        // if we got here, it means the connectToGraph stuff has already been
        // put on the transport and actually executed
        // - so we need to recalculate the creation event,
        // which will refire the events
        this.hasScheduledEmptyPlayer = false;
        this.startTimeDependentKeys.forEach(key => {
          const value = this.scheduled.get(key);
          // the events have actually already run,
          // but cleanup the transport anyway
          if (value) {
            value.dispose();
            this.scheduled.delete(key);
          }
        });
        this.calculateStartTimeDependentEvents();
      }
    });
    const preLoadTime = time - this.loadBufferTimings.countIn;
    const now = Tone.Transport.seconds;
    toSchedule.start(calculateStartTime(preLoadTime, now));
    this.scheduled.set('loaded', toSchedule);
  }
}*

interface ScheduleToLoadArgs {
  startTime: number;
  duration: number;
  uri: string;
}

// TODO, tidy - this is pretty messy
// TODO, the 'looping' logic is mixed up in this too - bad idea?

export interface SetupPlayerParams {
  startTime: ScheduleTime;
  mode: PlaybackMode;
  time: string | number;
  timings: LifeCycleTimings;
}
export interface SetupPlayerFromFilesParams extends SetupPlayerParams {
  fileUris: string[];
  effects: Effects;
  filenameCache: Map<String, AudioBuffer>;
}

export interface SetupPlayerLazilyFromFiles extends SetupPlayerFromFilesParams {
  timings: DynamicBufferLifeCycle;
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
      factories.map(({createPlayer, options, buffer}) => {
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

  return factories.map(({createPlayer, options, buffer}, i) => {
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
      buffer
    }
  });
}

export function lazilySetupTonePlayers({
  fileUris,
  startTime,
  mode,
  time,
  filenameCache,
  timings,
  effects
}: SetupPlayerLazilyFromFiles): ManagedAudioEvent[] {
  if (mode instanceof LoopMode) {
    // TODO change looping model and how durations are supplied to fix this
    throw "Looping not supported when scheduling buffers dynamically.";
  }
  return fileUris.map(url => {
    return new DynamicBufferingManagedAudioEvent({
      startTime: new Time(time).toSeconds(),
      timings,
      bufferResolver: {
        fetch: () => createBuffer({filenameCache, url})
      },
      effects
    });
  });
}

export async function setupTonePlayers({
  fileUris,
  startTime,
  mode,
  time,
  effects,
  filenameCache,
  timings
}: SetupPlayerFromFilesParams): Promise<ManagedAudioEvent[]> {
  const loop = mode instanceof LoopMode;
  const factories = await Promise.all(fileUris.map(f =>
    createPlayerFactoryAfterLoadingBuffer({
      scheduleOpts: {
        startTime: time,
        offset: mode.offset,
        duration: mode.duration
      },
      playerOpts: {
        url: f,
        loop
      },
      filenameCache
    })
  ));

  return toLoopingPlayerFactories({
    factories,
    startTime,
    mode,
    time,
    timings
  }).map(({createPlayer, options: {startTime, duration}}) => {
    return new ManagedAudioEvent({
      createPlayer,
      effects,
      startTime: new Time(startTime).toSeconds(),
      duration,
      timings
    });
  });
}*/