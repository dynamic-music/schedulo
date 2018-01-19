import * as Tone from 'tone';
import { Event } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime,
  StoppingMode } from './types';
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
  private scheduled: Map<string, IDisposable> = new Map(); // TODO, could this just be an array?
  private startTimeDependentKeys = ['playing', 'scheduled', 'loaded'];
  private durationDependentKeys = ['stopped', 'dispose', 'freed'];
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
    this.updateStartEvents()
      .then(() => this.updateEndEvents());
  }

  private initParamDispatchers() {
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => this.player.volume.value = Tone.gainToDb(n)
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
        currentValue: new Tone.Time(this.startTime).toSeconds(),
        handler: (n: number) => {
          if (!this.isPlaying) {
            this.startTime = n;
          }
        }
      })
    );
  }

  /*get duration(): number {
    return this.duration;
  }

  set duration(d: number) {
    this.duration = d;
    this.scheduled.forEach((e, key) => {
      if (this.durationDependentKeys.includes(key)) {
        e.dispose();
      }
    });
    this.updateEndEvents();
  }

  get startTime(): number {
    return this.startTime;
  }

  set startTime(t: number) {
    this.startTime = t;
    if (this.scheduled) {
      this.reset();
    }
    this.updateStartEvents()
      .then(() => this.updateEndEvents());
  }*/

  set(param: Parameter, value: number | number[]): void {
    const dispatch = this.parameterDispatchers.get(param);
    if (dispatch) {
      dispatch.stored.currentValue = value;
      if (this.player) {
        dispatch.update();
      }
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.player.volume.linearRampTo(value, duration, time);
    }
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.emit('stopped', Tone.Transport.seconds);
    this.reset();
  }

  private reset() {
    this.scheduled.forEach(event => event.dispose());
    this.scheduled = new Map();
  }

  private async updateStartEvents(): Promise<any> {
    //TODO ASYNC IS PROBLEMATIC WHEN STARTTIME CHANGES....... MAKE EVENTS
    //DEPENDENT IN NESTED WAY
    try {
      const loadTime = this.toFutureTime(
        this.startTime - this.timings.loadBuffer.countIn);
      await this.scheduleEvent('loaded', loadTime, this.initBuffer.bind(this));
      const scheduleTime = this.toFutureTime(
        this.startTime - this.timings.connectToGraph.countIn);
      await this.scheduleEvent('scheduled', scheduleTime, this.initAndSchedulePlayer.bind(this));
      this.scheduleEvent('playing', this.startTime, () => this.isPlaying = true);
    } catch (err) {
      const reason = "failed to load and schedule audio on time";
      console.warn(reason, this.fileUri, err);
      return Promise.reject(reason);
    }
  }

  private updateEndEvents() {
    let duration;
    if (this.duration) {
      duration = this.duration;
    } else if (this.buffer) {
      duration = this.buffer.duration;
      if (this.offset) {
        duration -= this.offset;
      }
    }
    if (duration) {
      const stopTime = this.startTime + duration;
      const disposeTime = stopTime + this.timings.connectToGraph.countOut;
      const freeTime = stopTime + this.timings.loadBuffer.countOut;
      this.scheduleEvent('stopped', stopTime, () => this.isPlaying = false);
      this.scheduleEvent('disposed', disposeTime, this.disconnectAndDispose.bind(this));
      this.scheduleEvent('freed', freeTime, this.freeBuffer.bind(this));
    }
  }

  // Tone.js won't schedule an event if it isn't in the future,
  // so this function checks against "now" and adds a small offset
  private toFutureTime(ideal: number, delta: number = 0.001) {
    const now = Tone.Transport.seconds;
    return ideal <= now ? now + delta : ideal;
  }

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
    this.buffer = null;
    this.audioBank.freeBuffer(this.fileUri);
  }

  private initAndSchedulePlayer(): Promise<any> {
    if (this.buffer) {
      this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
      this.delayVolume = new Tone.Volume(0).connect(this.delay);
      this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
      this.panner.connect(this.reverbVolume).connect(this.delayVolume);

      this.player = new Tone.Player(this.buffer);
      this.player.toMaster().sync().start(this.startTime, this.offset, this.duration);
      this.player.connect(this.panner);
      this.player.fadeIn = 0.02
      this.player.fadeOut = 0.02
      this.scheduled.set('player', this.player);

      this.parameterDispatchers.forEach((storedValue, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          storedValue.update();
        }
      });
      return Promise.resolve();
    }
    return Promise.reject("failed to schedule, buffer not available yet")
  }

  private disconnectAndDispose() {
    //TODO DISCONNECT EVERYTHING ELSE!!!
    if (this.player) {
      this.player.dispose();
      this.scheduled.delete('player');
    }
  }

  /** schedules an event with the given task, adds it to the scheduled map,
    and returns a promise that gets resolved when the event is triggered, to
    enable scheduling dependent events */
  private scheduleEvent(name: string, time: number,
      task?: (n?: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const event = new Event(async time => {
        if (task) {
          try {
            await task(time);
            resolve();
          } catch (err) {
            reject(err);
          }
        }
        console.log(name, time);
        this.emit(name, time);
        event.stop();
      });
      this.scheduled.set(name, event);
      event.start(time);
    })
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {
  constructor(public tonejsEvent: any, public startTime: number) {
    super(tonejsEvent, startTime);
  }
}