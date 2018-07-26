import * as Tone from 'tone';
import { Event } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime,
  StoppingMode, AudioStatus, RefTimeWithOnset } from './types';
import { AudioBank } from './audio-bank';
import { DynamicBufferLifeCycle, LifeCycleWindow, SingleOrMultiValueDispatcher,
  StoredValueHandler, IDisposable } from './life-cycle';

export abstract class TonejsScheduledObject extends Tone.Emitter implements ScheduledObject {
  abstract getScheduleTime(): number;
  abstract getDuration(): number;
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
  private offset = 0;
  private duration: number; // undefined means entire buffer is played
  private durationRatio = 1;

  private loadTime: number;
  private schedTime: number;
  private playTime: number;
  private loading: Promise<any>;
  private scheduling: Promise<any>;

  constructor(
    private fileUri: string,
    private audioBank: AudioBank,
    private timings: DynamicBufferLifeCycle,
    private fadeLength: number,
    private reverb: AudioNode,
    private delay: AudioNode,
    private startTime: RefTimeWithOnset
  ) {
    super();
    if (this.startTime.onset == null) this.startTime.onset = 0;
    this.initParamDispatchers();
    this.updateStartEvents();
    this.updateEndEvents();
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
        handler: (n: number) => {
          if (this.reverbVolume.volume) {
            this.reverbVolume.volume.value = Tone.gainToDb(n*2);
          }
        }
      })
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => {
          if (this.delayVolume.volume) {
            this.delayVolume.volume.value = Tone.gainToDb(n);
          }
      }})
    );
    this.parameterDispatchers.set(
      Parameter.PlaybackRate,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => {
          this.player.playbackRate = n;
        }
      })
    );
  }

  set(param: Parameter, value: number | number[]): void {
    const dispatch = this.parameterDispatchers.get(param);
    if (dispatch) {
      dispatch.stored.currentValue = value;
      if (this.isScheduled()) {
        try {
          dispatch.update();
        } catch (err) {
          console.warn(err);
        }
      }
    } else if (param === Parameter.StartTime) {
      //console.log("SET", value, this.startTime.onset)
      if (!this.isScheduled() && this.startTime.onset != value) {
        this.startTime.onset = <number>value;
        this.resetEvents();
        this.updateStartEvents();
        this.updateEndEvents();
      }
    } else if (param === Parameter.Duration && this.duration != value) {
      this.duration = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.DurationRatio && this.durationRatio != value) {
      this.durationRatio = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.Offset && this.offset != value) {
      this.offset = <number>value;
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.player.volume.linearRampTo(value, duration, time);
    }
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.stopPlayer();
    this.resetEvents();
    this.scheduleStopAndCleanup(Tone.Transport.seconds);
  }

  getScheduleTime() {
    return this.startTime.ref+this.startTime.onset;
  }

  getDuration() {
    if (this.duration) {
      return this.duration*this.durationRatio;
    } else if (this.buffer) {
      return this.buffer.duration - this.offset;
    }
    return 0;
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

  private async updateStartEvents() {
    //console.log("UPD", Tone.Transport.seconds, "L", this.timings.loadBuffer.countIn, "S", this.timings.connectToGraph.countIn)
    this.playTime = this.startTime.ref+this.startTime.onset+this.timings.connectToGraph.countIn;
    this.loadTime = this.toFutureTime(
      this.playTime - this.timings.loadBuffer.countIn);
    this.loading = this.scheduleEvent('loaded', this.loadTime, this.initBuffer.bind(this));
    if (this.scheduledEvents.size > 0) {//simple way to check not cancelled
      this.schedTime = this.toFutureTime(
        this.playTime - this.timings.connectToGraph.countIn);
      //console.log(loadTime-Tone.Transport.seconds, scheduleTime-loadTime, startTime-scheduleTime)
      this.scheduling = this.scheduleEvent('scheduled', this.schedTime, this.initAndSchedulePlayer.bind(this));
      this.scheduleEvent('playing', this.playTime, this.enterPlayState.bind(this));
    }
  }

  // Tone.js won't schedule an event if it isn't in the future,
  // so this function checks against "now" and adds a small offset
  private toFutureTime(ideal: number, delta: number = 0.001) {
    const now = Tone.Transport.seconds;
    return ideal <= now ? now + delta : ideal;
  }

  private updateEndEvents() {
    this.resetEvents(this.durationDependentKeys);
    let duration = this.getDuration();
    if (duration) {
      this.scheduleStopAndCleanup(this.playTime + duration);
    }
  }

  private scheduleStopAndCleanup(stopTime: number) {
    let fadedTime = stopTime + this.fadeLength;
    const disposeTime = fadedTime + this.timings.connectToGraph.countOut;
    const freeTime = fadedTime + this.timings.loadBuffer.countOut;
    this.scheduleEvent('stopped', stopTime, this.stopPlayer.bind(this));
    this.scheduleEvent('disposed', disposeTime, this.resetGraph.bind(this));
    this.scheduleEvent('freed', freeTime, this.freeBuffer.bind(this));
  }


  // LIFE CYCLE EVENT FUNCTIONS ////////////////////
  // most of these throw errors when appropriate to prevent events from emitting

  private async initBuffer() {
    if (this.fileUri) {
      const t = Tone.Transport.seconds;
      this.buffer = await this.audioBank.getToneBuffer(this.fileUri);
    }
  }

  private async freeBuffer() {
    if (!this.buffer) {
      throw "no buffer to free";
    }
    this.buffer = null;
    this.audioBank.freeBuffer(this.fileUri);
  }

  private isScheduled() {
    return this.player != null;
  }

  private async initAndSchedulePlayer() {
    if (this.loading) {
      await this.loading;
    }

    const l = Tone.Transport.seconds;

    if (!this.buffer) {
      console.warn("buffer not loaded in time");
      //increase load ahead time
      this.increaseCountIn(this.timings.loadBuffer, 0.5);
    } else if (this.playTime < Tone.Transport.seconds) {
      console.warn("scheduled too late", this.buffer);
      //increase schedule ahead time
      this.increaseCountIn(this.timings.loadBuffer, 0.2);
      this.increaseCountIn(this.timings.connectToGraph, 0.2);
      //try decreasing load ahead time
      this.decreaseCountIn(this.timings.loadBuffer, 0.01);
    } else {
      //try decreasing schedule and loading ahead time
      this.decreaseCountIn(this.timings.connectToGraph, 0.01);
      this.decreaseCountIn(this.timings.loadBuffer, 0.01);
      this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
      this.delayVolume = new Tone.Volume(0).connect(this.delay);
      this.audioGraph.push(this.reverbVolume);
      this.audioGraph.push(this.delayVolume);
      this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
      this.panner.connect(this.reverbVolume);
      this.panner.connect(this.delayVolume);
      this.audioGraph.push(this.panner);

      this.player = new Tone.Player(this.buffer);

      /*this.player = new Tone.GrainPlayer(this.buffer);
      let playz = <any>this.player;
      playz.grainSize = 0.1
      playz.overlap = 0.05*/

      //console.log(startTime, this.offset, this.duration, this.getDuration())
      let offsetCorr = Math.min(this.offset, (this.fadeLength/2));
      this.player.sync().start(this.playTime-offsetCorr, this.offset-offsetCorr);//no duration given, makes it dynamic
      this.player.connect(this.panner);
      this.player.fadeIn = this.fadeLength;
      this.player.fadeOut = this.fadeLength;
      this.audioGraph.push(this.player);

      this.parameterDispatchers.forEach((dispatcher, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          dispatcher.update();
        }
      });

      const s = Tone.Transport.seconds;
      //console.log("TIM", "L", l, "S", s);
      //console.log("DEL", "L", l-this.loadTime, "S", s-l, "P", s-this.playTime);
    }
  }

  private increaseCountIn(window: LifeCycleWindow, increment: number) {
    //adjust min so never goes below that again
    if (window.countIn == window.minCountIn) {
      window.minCountIn += increment;
    }
    window.countIn += increment;
  }

  private decreaseCountIn(window: LifeCycleWindow, decrement: number) {
    window.countIn = Math.max(window.minCountIn, window.countIn-decrement);
  }

  private stopPlayer() {
    if (this.player) {
      if (this.player.volume) {
        this.player.volume.rampTo(Tone.gainToDb(0), this.fadeLength);
      }
      setTimeout(() => {
        //these calls often produce errors due to inconsistencies in tone
        try { this.player.unsync(); } catch (e) {};
        try { this.player.stop(); } catch (e) {};
      }, this.fadeLength*1000)
    }
    this.exitPlayState();
  }

  private resetGraph() {
    if (this.audioGraph.length > 0) {
      this.audioGraph.forEach(node => node.dispose());
      this.audioGraph = [];
    }
  }

  private async enterPlayState() {
    this.isPlaying = true;
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
        //event.stop(); produces lots of errors
      });
      this.scheduledEvents.set(name, event);
      event.start(time);
    })
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {
  constructor(private tonejsEvent: any) {
    super();
  }

  getScheduleTime() {
    return this.tonejsEvent
  }

  getDuration() {
    return 0;
  }
}