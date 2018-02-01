import * as Tone from 'tone';
import { Event } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime,
  StoppingMode, AudioStatus } from './types';
import { AudioBank } from './audio-bank';
import { DynamicBufferLifeCycle, SingleOrMultiValueDispatcher,
  StoredValueHandler, IDisposable } from './life-cycle';

export class TonejsScheduledObject extends Tone.Emitter implements ScheduledObject {
  constructor(
    public startTime: number,
    public offset?: number,
    public duration?: number,
  ) {
    super();
  }
}

export class TonejsAudioObject extends TonejsScheduledObject implements AudioObject {

  private parameterDispatchers: Map<Parameter, SingleOrMultiValueDispatcher> = new Map();
  private audioGraph: IDisposable[] = [];
  private scheduledEvents: Map<string, IDisposable> = new Map();
  private startTimeDependentKeys: AudioStatus[] = ['playing', 'scheduled', 'loaded'];
  private durationDependentKeys: AudioStatus[] = ['stopped', 'disposed', 'freed'];
  private buffer: ToneBuffer | null;
  private player: Player;
  private panner: Panner3D;
  private reverbVolume: Volume;
  private delayVolume: Volume;
  private isPlaying = false;

  constructor(
    private fileUri: string,
    private audioBank: AudioBank,
    private timings: DynamicBufferLifeCycle,
    private reverb: AudioNode,
    private delay: AudioNode,
    startTime: number,
    offset?: number,
    duration?: number,
  ) {
    super(startTime, offset, duration);
    this.initParamDispatchers();
    this.updateAllEvents();
  }

  private initParamDispatchers() {
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => {
          if (this.player.volume) {
            this.player.volume.value = Tone.gainToDb(n)
          }
        }
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
        handler: (n: number) => this.reverbVolume.volume.value = Tone.gainToDb(n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.delayVolume.volume.value = Tone.gainToDb(n)
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
        currentValue: this.startTime,
        handler: (n: number) => {
          if (!this.isPlaying) {
            this.startTime = n;
            this.reset();
            this.updateAllEvents();
          }
        }
      })
    );
    this.parameterDispatchers.set(
      Parameter.Duration,
      new StoredValueHandler({
        currentValue: this.duration ? this.duration : 0,
        handler: (n: number) => {
          this.duration = n;
          this.resetEvents(this.durationDependentKeys);
          this.updateEndEvents();
        }
      })
    );
  }

  set(param: Parameter, value: number | number[]): void {
    const dispatch = this.parameterDispatchers.get(param);
    if (dispatch) {
      dispatch.stored.currentValue = value;
      if (this.player) {
        try {
          dispatch.update();
        } catch (err) {
          console.warn(err);
        }
      }
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.player.volume.linearRampTo(value, duration, time);
    }
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    if (this.player && this.player.state === 'started') {
      this.player.unsync().stop();
    }
    this.resetEvents();
    this.scheduleStopAndCleanup(Tone.Transport.seconds);
  }

  private reset() {
    this.resetEvents();
    this.resetGraph();
  }

  private resetEvents(keys?: string[]) {
    if (this.scheduledEvents.size > 0) {
      if (keys) {
        keys.forEach(k => {
          const e = this.scheduledEvents.get(k);
          if (e) {
            e.dispose();
            this.scheduledEvents.delete(k);
          }
        });
      } else {
        this.scheduledEvents.forEach(event => event.dispose());
        this.scheduledEvents = new Map();
      }
    }
  }

  private updateAllEvents() {
    this.updateStartEvents();
    this.updateEndEvents();
  }

  private async updateStartEvents() {
    const loadTime = this.toFutureTime(
      this.startTime - this.timings.loadBuffer.countIn);
    await this.scheduleEvent('loaded', loadTime, this.initBuffer.bind(this));
    if (this.scheduledEvents.size > 0) {//simple way to check not cancelled
      const scheduleTime = this.toFutureTime(
        this.startTime - this.timings.connectToGraph.countIn);
      this.scheduleEvent('scheduled', scheduleTime, this.initAndSchedulePlayer.bind(this));
      this.scheduleEvent('playing', this.startTime, this.enterPlayState.bind(this));
    }
  }

  // Tone.js won't schedule an event if it isn't in the future,
  // so this function checks against "now" and adds a small offset
  private toFutureTime(ideal: number, delta: number = 0.001) {
    const now = Tone.Transport.seconds;
    return ideal <= now ? now + delta : ideal;
  }

  private updateEndEvents() {
    let duration = this.calculateDuration();
    if (duration) {
      this.scheduleStopAndCleanup(this.startTime + duration);
    }
  }

  private calculateDuration() {
    if (this.duration) {
      return this.duration;
    } else if (this.buffer) {
      let duration = this.buffer.duration;
      if (this.offset) {
        duration -= this.offset;
      }
      return duration;
    }
  }

  private scheduleStopAndCleanup(stopTime: number) {
    const disposeTime = stopTime + this.timings.connectToGraph.countOut;
    const freeTime = stopTime + this.timings.loadBuffer.countOut;
    this.scheduleEvent('stopped', stopTime, this.exitPlayState.bind(this));
    this.scheduleEvent('disposed', disposeTime, this.resetGraph.bind(this));
    this.scheduleEvent('freed', freeTime, this.freeBuffer.bind(this));
  }


  // LIFE CYCLE EVENT FUNCTIONS ////////////////////
  // most of these throw errors when appropriate to prevent events from emitting

  private async initBuffer() {
    this.buffer = await this.audioBank.getToneBuffer(this.fileUri);
    if (!this.duration) {
      let duration = this.buffer.duration;
      if (this.offset) {
        duration -= this.offset;
      }
      this.duration = duration;
    }
  }

  private async freeBuffer() {
    if (!this.buffer) {
      throw "no buffer to free";
    }
    this.buffer = null;
    this.audioBank.freeBuffer(this.fileUri);
  }

  private initAndSchedulePlayer() {
    if (!this.buffer) {
      throw "failed to schedule, buffer not loaded yet";
    }
    this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
    this.delayVolume = new Tone.Volume(0).connect(this.delay);
    this.audioGraph.push(this.reverbVolume);
    this.audioGraph.push(this.delayVolume);
    this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
    this.panner.connect(this.reverbVolume).connect(this.delayVolume);
    this.audioGraph.push(this.panner);

    this.player = new Tone.Player(this.buffer);
    this.player.sync().start(this.startTime, this.offset, this.duration);
    this.player.connect(this.panner);
    this.player.fadeIn = 0.02
    this.player.fadeOut = 0.02
    this.audioGraph.push(this.player);

    this.parameterDispatchers.forEach((storedValue, paramType) => {
      if (paramType != Parameter.StartTime) { // will cause infinite loop
        storedValue.update();
      }
    });
  }

  private resetGraph() {
    if (this.audioGraph.length > 0) {
      this.audioGraph.forEach(node => node.dispose());
      this.audioGraph = [];
    }
  }

  private enterPlayState() {
    if (this.player) {
      this.isPlaying = true;
    }
  }

  private exitPlayState() {
    if (this.isPlaying) {
      this.isPlaying = false;
    }
  }

  /** schedules an event with the given task, adds it to the scheduled map,
    and returns a promise that gets resolved when the event is triggered, to
    enable scheduling dependent events. errors are simply caught and printed */
  private scheduleEvent(name: AudioStatus, time: number,
      task?: (n?: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const event = new Event(async time => {
        if (task) {
          try {
            await task(time);
            //console.log(name, time);
            this.emit(name, time);
          } catch (err) {
            console.warn(err, this.fileUri);
          }
          resolve();
        }
        event.stop();
      });
      this.scheduledEvents.set(name, event);
      event.start(time);
    })
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {
  constructor(public tonejsEvent: any, public startTime: number) {
    super(tonejsEvent, startTime);
  }
}