import * as Tone from 'tone';
import { Event } from 'tone';
import { ScheduledObject, AudioObject, EventObject, Parameter, ScheduleTime,
  StoppingMode, AudioStatus } from './types';
import { AudioBank } from './audio-bank';
import { DynamicBufferLifeCycle, SingleOrMultiValueDispatcher,
  StoredValueHandler, IDisposable } from './life-cycle';

const FADE_TIME = 0.1;

export abstract class TonejsScheduledObject extends Tone.Emitter implements ScheduledObject {
  abstract getStartTime(): number;
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

  constructor(
    private fileUri: string,
    private audioBank: AudioBank,
    private timings: DynamicBufferLifeCycle,
    private reverb: AudioNode,
    private delay: AudioNode,
    private startTime: number
  ) {
    super();
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
      if (this.player) {
        try {
          dispatch.update();
        } catch (err) {
          console.warn(err);
        }
      }
    } else if (param === Parameter.StartTime) {
      this.startTime = <number>value;
      this.reset();
      this.updateAllEvents();
    } else if (param === Parameter.Duration) {
      this.duration = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.DurationRatio) {
      this.durationRatio = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.Offset) {
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

  getStartTime() {
    return this.startTime;
  }

  getDuration() {
    if (this.duration) {
      return this.duration*this.durationRatio;
    } else if (this.buffer) {
      return this.buffer.duration - this.offset;
    }
    return 0;
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
    const startTime = this.startTime// - (FADE_TIME/2);
    const loadTime = this.toFutureTime(
      startTime - this.timings.loadBuffer.countIn);
    await this.scheduleEvent('loaded', loadTime, this.initBuffer.bind(this));
    if (this.scheduledEvents.size > 0) {//simple way to check not cancelled
      //console.log("START", startTime)
      const scheduleTime = this.toFutureTime(
        startTime - this.timings.connectToGraph.countIn);
      this.scheduleEvent('scheduled', scheduleTime, this.initAndSchedulePlayer.bind(this));
      this.scheduleEvent('playing', startTime, this.enterPlayState.bind(this));
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
      this.scheduleStopAndCleanup(this.startTime + duration);
    }
  }

  private scheduleStopAndCleanup(stopTime: number) {
    //console.log("STOP", this.startTime, stopTime)
    let fadedTime = stopTime + FADE_TIME;
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

  private initAndSchedulePlayer() {
    if (this.buffer) {
      this.reverbVolume = new Tone.Volume(0).connect(this.reverb);
      this.delayVolume = new Tone.Volume(0).connect(this.delay);
      this.audioGraph.push(this.reverbVolume);
      this.audioGraph.push(this.delayVolume);
      this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
      this.panner.connect(this.reverbVolume).connect(this.delayVolume);
      this.audioGraph.push(this.panner);

      this.player = new Tone.Player(this.buffer);

      //console.log(this.startTime, this.offset, this.duration, this.getDuration())
      let offsetCorr = Math.min(this.offset, (FADE_TIME/2));
      this.player.sync().start(this.startTime-offsetCorr, this.offset-offsetCorr);//no duration given, makes it dynamic
      this.player.connect(this.panner);
      this.player.fadeIn = FADE_TIME;
      this.player.fadeOut = FADE_TIME;
      this.audioGraph.push(this.player);

      this.parameterDispatchers.forEach((dispatcher, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          dispatcher.update();
        }
      });
    } else {
      console.log("scheduled with empty buffer (may be intended)");
    }
  }

  private stopPlayer() {
    if (this.player) {
      this.player.volume.rampTo(Tone.gainToDb(0), FADE_TIME);
      setTimeout(() => {
        //these calls often produce errors due to inconsistencies in tone
        try { this.player.unsync(); } catch (e) {};
        try { this.player.stop(); } catch (e) {};
      }, FADE_TIME*1000)
    }
    this.exitPlayState();
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

  getStartTime() {
    return this.tonejsEvent
  }

  getDuration() {
    return 0;
  }
}