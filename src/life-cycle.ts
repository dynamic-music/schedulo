import {
  TonejsAudioObject as ToneAudioEvent
} from './tone-object';
import {
  AudioObject as IAudioEvent,
  Parameter,
  ScheduleTime,
  StoppingMode,
  PlaybackMode,
  LoopMode
} from './types';
import * as Tone from 'tone';
import { Event, Time, gainToDb } from 'tone';
import { calculateScheduleTimes, toBufferSegment } from './looping';
import { createTonePlayer, PlayerFactory, add } from './tone-helpers';


export interface LifeCycleWindow {
  countIn: number;
  countOut: number;
}

export interface LifeCycleTimings {
  connectToGraph: LifeCycleWindow;
}

interface IDisposable {
  dispose(): void;
}

export const defaultTimings: LifeCycleTimings = {
  connectToGraph: {countIn: 2, countOut: 2}
};

export interface ManagedEventArgs {
  startTime: number | string;
  createPlayer: (startOffset?: number) => Player;
  duration?: number | string;
  timings?: LifeCycleTimings;
}

interface ParameterStateHandling {
  currentValue: number;
  handler: (n: number, player: Player) => void;
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
  private createPlayer: (startOffset?: number) => Player;
  private parameterDispatchers: Map<Parameter, ParameterStateHandling>;

  constructor({startTime, duration = 0, ...otherParams}: ManagedEventArgs) {
    const { timings = defaultTimings, createPlayer } = otherParams;
    this.createPlayer = createPlayer;
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
        handler: (n, player) => player.volume.value = gainToDb(n)
      }
    );
    this.parameterDispatchers.set(
      Parameter.PlaybackRate,
      {
        currentValue: 1.0,
        handler: (n, player) => player.playbackRate = n
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
            this.startTime = n;
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
      const player = this.createPlayer(startOffset);
      this.scheduled.set('player', player);
      this.parameterDispatchers.forEach(({handler, currentValue}, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          handler(currentValue, player);
        }
      });
      connectAndScheduleToPlay.stop();
    });
    const preLoadTime = this.startTimeSecs - connectToGraph.countIn;
    connectAndScheduleToPlay.start(preLoadTime < Tone.Transport.seconds ? 
      Tone.Transport.seconds : preLoadTime
    );
    this.scheduled.set('connect', connectAndScheduleToPlay);
  }
  
  set(param: Parameter, value: number): void {
    const dispatch = this.parameterDispatchers.get(param);
    const player = this.scheduled.get('player');
    if (dispatch && dispatch.handler) {
      dispatch.currentValue = value;
      if (player) {
        dispatch.handler(value, player as Player);
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
    this.reset();
  }

  private reset() {
    this.scheduled.forEach(event => event.dispose());
    this.scheduled = new Map();
  }
}

// TODO, tidy - this is pretty messy
// TODO, seperate buffer loading from player instantiation
// TODO, the 'looping' logic is mixed up in this too - bad idea?
export interface SetupPlayerParams {
  fileUris: string[];
  startTime: ScheduleTime;
  mode: PlaybackMode;
  time: string | number;
  filenameCache: Map<String, AudioBuffer>;
  timings: LifeCycleTimings;
}

export async function setupTonePlayers({
  fileUris,
  startTime,
  mode,
  time,
  filenameCache,
  timings
}: SetupPlayerParams): Promise<ManagedAudioEvent[]> {
  let loop = mode instanceof LoopMode;
  const playersToSetup = await Promise.all(fileUris.map(f =>
    createTonePlayer(
      {
        startTime: time,
        offset: mode.offset,
        duration: mode.duration
      },
      {
        url: f,
        loop: loop
      },
      filenameCache
    )
  ));

  const {times = 0} = Object.assign({times: 0}, mode);
  const hasRepeats = times > 0 && isFinite(times);

  const scheduleTimes = hasRepeats && mode instanceof LoopMode ?
    calculateScheduleTimes(
      times,
      playersToSetup.map(({createPlayer, options, buffer}) => {
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

  return playersToSetup.map(({createPlayer, options, buffer}, i) => {
    const {startTime, offset, duration} = options;
    const wrapped = (startOffset: number = 0.0) => {
      const player = createPlayer();
      if (scheduleTimes.times.length) {
        player.toMaster().sync();
        scheduleTimes.times[i].forEach(time => {
          player.start(
            startOffset + time.startTime,
            time.offset,
            time.duration
          ).stop(startOffset + time.stopTime);
        });
      } else {
        player.toMaster().sync().start(
          add(startOffset, startTime),
          offset,
          duration
        );
      }
      if (hasRepeats && mode instanceof LoopMode) {
        player.loop = false;
      }
      return player;
    }
    return new ManagedAudioEvent({
      createPlayer: wrapped,
      startTime,
      duration: scheduleTimes.duration || duration, // in retrospect, is scheduleTimes.duration even correct?,
      timings
    });
  });
}