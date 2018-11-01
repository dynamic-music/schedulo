import * as Tone from 'tone';
import { Event } from 'tone';
import { ScheduloObject, AudioObject, EventObject, Parameter, ScheduleTime,
  StoppingMode, ObjectStatus, RefTimeWithOnset } from './types';
import { AudioBank } from './audio-bank';
import { DynamicBufferLifeCycle, LifeCycleWindow, SingleOrMultiValueDispatcher,
  StoredValueHandler, IDisposable, IEvent } from './life-cycle';
import { TimeStretcher } from './timestretcher';

export abstract class TonejsScheduledObject extends Tone.Emitter implements ScheduloObject {
  protected scheduledEvents: Map<string, IEvent> = new Map();
  protected playTime: number;

  constructor(protected startTime: RefTimeWithOnset, protected timings: DynamicBufferLifeCycle) {
    super();
    if (this.startTime.onset == null) this.startTime.onset = 0;
  }

  abstract getDuration(): number;
  abstract set(param: Parameter, value: number | number[]): void;
  abstract stop(time: ScheduleTime, mode: StoppingMode): void;

  getScheduleTime() {
    return this.startTime.ref+this.startTime.onset;
  }

  protected updatePlayTime() {
    this.playTime = this.startTime.ref+this.startTime.onset+this.timings.connectToGraph.countIn;
  }

  /** schedules an event with the given task, adds it to the scheduled map,
    and returns a promise that gets resolved when the event is triggered, to
    enable scheduling dependent events. errors are simply caught and printed */
  protected scheduleEvent(name: ObjectStatus, time: number,
      task?: (n?: number) => void): Promise<any> {
    return new Promise((resolve, reject) => {
      const event = new Event(async time => {
        if (task) {
          try {
            await task(time);
            //console.log(name, time);
            this.emit(name, time);
          } catch (err) {
            console.warn(err);//, this.fileUri);
          }
          resolve();
        }
        //event.stop(); produces lots of errors
      });
      const oldEvent = this.scheduledEvents.get(name);
      this.scheduledEvents.set(name, event);
      event.start(time);
      //dispose old event and replace
      if (oldEvent) {
        oldEvent.cancel();
        oldEvent.dispose();
      }
    })
  }

  protected removeAllEvents() {
    if (this.scheduledEvents.size > 0) {
      this.scheduledEvents.forEach(event => event.cancel());
      this.scheduledEvents.forEach(event => event.dispose());
      this.scheduledEvents = new Map();
    }
  }
}

const PLAYER = "player";
const PANNER = "panner";
const DELAY = "delay";
const FILTER = "filter";
const REVERB = "reverb";

export class TonejsAudioObject extends TonejsScheduledObject implements AudioObject {

  private parameterDispatchers: Map<Parameter, SingleOrMultiValueDispatcher> = new Map();
  private audioGraph: Map<string,AudioNode> = new Map();
  private startTimeDependentKeys: ObjectStatus[] = ['playing', 'scheduled', 'loaded'];
  private durationDependentKeys: ObjectStatus[] = ['stopped', 'disposed', 'freed'];
  private buffer: ToneBuffer;
  private isScheduled = false;
  private isPlaying = false;
  private isDonePlaying = false;
  private offset = 0;
  private duration: number; // undefined means entire buffer is played
  private durationRatio = 1;
  private timeStretchRatio = 1;
  private filterCutoff = 1;

  private loadTime: number;
  private schedTime: number;
  private loading: Promise<any>;
  private scheduling: Promise<any>;

  constructor(
    private fileUri: string,
    private audioBank: AudioBank,
    timings: DynamicBufferLifeCycle,
    private fadeLength: number,
    private reverb: AudioNode,
    private delay: AudioNode,
    private filter: AudioNode,
    startTime: RefTimeWithOnset
  ) {
    super(startTime, timings);
    this.initParamDispatchers();
    this.updateStartEvents();
  }

  private initParamDispatchers() {
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => this.setGain(PLAYER, n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Panning,
      new StoredValueHandler({
        currentValue: [0.0, 0.0, 0.0],
        handler: (n: number[]) =>
          (<PannerNode>this.audioGraph.get(PANNER)).setPosition(n[0], n[1], n[2])
      })
    );
    this.parameterDispatchers.set(
      Parameter.Reverb,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.setGain(REVERB, n*2)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.setGain(DELAY, n)
      })
    );
    /*this.parameterDispatchers.set(
      Parameter.Filter,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.setGain(FILTER, n)
      })
    );*/
    this.parameterDispatchers.set(
      Parameter.PlaybackRate,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) =>
          this.getPlayer().playbackRate = n
      })
    );
    /*TODO for now time stretching made with playback rate held stable during playback
    this.parameterDispatchers.set(
      Parameter.TimeStretchRatio,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => {
          if (!this.isScheduled) {
            (<Player>this.audioGraph.get(PLAYER)).playbackRate = n
          }
        }
      })
    );*/
  }

  private getPlayer(): Player {
    return <Player>this.audioGraph.get(PLAYER);
  }

  private setGain(nodeName: string, value: number) {
    const db = Tone.gainToDb(value);
    const volume = (<Volume>this.audioGraph.get(nodeName)).volume;
    if (volume) {
      (<Volume>this.audioGraph.get(nodeName)).volume.linearRampTo(db, 0.01);
    }
  }

  set(param: Parameter, value: number | number[]): void {
    const dispatch = this.parameterDispatchers.get(param);
    if (dispatch) {
      dispatch.stored.currentValue = value;
      if (this.isScheduled) {
        try {
          dispatch.update();
        } catch (err) {
          console.warn(err);
        }
      }
    } else if (param === Parameter.StartTime) {
      if (!this.isScheduled && this.startTime.onset != value) {
        this.startTime.onset = <number>value;
        this.updateStartEvents();
        this.updateEndEvents();
      }
    } else if (param === Parameter.Duration && this.duration != value && !this.isScheduled) {
      this.duration = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.DurationRatio && this.durationRatio != value && !this.isScheduled) {
      this.durationRatio = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.TimeStretchRatio && this.timeStretchRatio != value && !this.buffer) {
      this.timeStretchRatio = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.Offset && this.offset != value && !this.buffer) {
      this.offset = <number>value;
    }
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      this.getPlayer().volume.linearRampTo(value, duration, time);
    }
  }

  //stopped from outside
  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.stopPlayer();
    this.removeAllEvents();
    this.scheduleStopAndCleanup(Tone.Transport.seconds);
  }

  //actual duration when playing
  getDuration(): number {
    let duration = this.getBufferDuration()/this.timeStretchRatio;
    if (this.getPlayer()) {
      duration /= this.getPlayer().playbackRate;
    }
    return duration;
  }

  //duration of trimmed buffer
  private getBufferDuration() {
    if (this.duration) {
      return this.duration*this.durationRatio;
    } else if (this.buffer) {
      return (this.buffer.duration - this.offset)*this.durationRatio;
    }
  }

  private async updateStartEvents() {
    //console.log("UPD", Tone.Transport.seconds, "L", this.timings.loadBuffer.countIn, "S", this.timings.connectToGraph.countIn)
    this.updatePlayTime();
    this.loadTime = this.toFutureTime(
      this.playTime - this.timings.loadBuffer.countIn);
    this.loading = this.scheduleEvent('loaded', this.loadTime, this.initBuffer.bind(this));
    if (this.scheduledEvents.size > 0) {//simple way to check not cancelled
      this.schedTime = this.toFutureTime(
        this.playTime - this.timings.connectToGraph.countIn);
      //console.log(this.loadTime-Tone.Transport.seconds, this.schedTime-this.loadTime, this.playTime-this.schedTime)
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
    if (this.buffer && this.isScheduled && !this.isDonePlaying) {
      let duration = this.getDuration();
      //console.log(this.startTime.ref, this.duration, this.durationRatio, duration, (<Player>this.audioGraph.get(PLAYER)).playbackRate)
      if (duration) {
        this.scheduleStopAndCleanup(this.playTime + duration);
      }
    }
  }

  private scheduleStopAndCleanup(stopTime: number) {
    if (stopTime > Tone.Transport.seconds || !this.scheduledEvents.has('stopped')) {
      const fadedTime = stopTime + this.fadeLength;
      const disposeTime = fadedTime + this.timings.connectToGraph.countOut;
      const freeTime = fadedTime + this.timings.loadBuffer.countOut;
      this.scheduleEvent('stopped', stopTime, this.stopPlayer.bind(this));
      this.scheduleEvent('disposed', disposeTime, this.resetGraph.bind(this));
      this.scheduleEvent('freed', freeTime, this.freeBuffer.bind(this));
    }
  }


  // LIFE CYCLE EVENT FUNCTIONS ////////////////////
  // most of these throw errors when appropriate to prevent events from emitting

  private async initBuffer() {
    const ignore = this.timings.loadBuffer.ignoreInaudible && !this.isAudible();
    if (this.fileUri && !ignore) {
      this.buffer = await this.audioBank.getToneBuffer(this.fileUri);
    }
  }

  private isAudible(): boolean {
    const amp = this.parameterDispatchers.get(Parameter.Amplitude).stored.currentValue;
    const rev = this.parameterDispatchers.get(Parameter.Reverb).stored.currentValue;
    const del = this.parameterDispatchers.get(Parameter.Delay).stored.currentValue;
    return amp > 0 || rev > 0 || del > 0;
  }

  private async freeBuffer() {
    if (this.buffer) {
      this.buffer.dispose();
      this.buffer = null;
    }
    this.audioBank.freeBuffer(this.fileUri);
    //completely done, so remove all events
    this.removeAllEvents();
  }

  private async initAndSchedulePlayer() {
    if (this.loading) {
      await this.loading;
    }

    if (!this.buffer) {
      if (this.fileUri) {
        if (this.timings.loadBuffer.ignoreInaudible) {
          console.warn("buffer of inaudible object ignored");
        } else {
          console.warn("buffer not loaded in time");
          //increase load ahead time
          this.increaseCountIn(this.timings.loadBuffer, 0.5);
        }
      }
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

      this.audioGraph.set(REVERB, new Tone.Volume(0).connect(this.reverb));
      this.audioGraph.set(DELAY, new Tone.Volume(0).connect(this.delay));
      //this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
      const panner = Tone.context.createPanner();
      this.audioGraph.set(PANNER, panner);
      panner.connect(this.audioGraph.get(REVERB));
      panner.connect(this.audioGraph.get(DELAY));

      /*if (this.fil) {
        this.audioGraph.set(FILTER, new Tone.Volume(0).connect(this.filter));
        panner.connect(Tone.Master);
      } else {*/
        panner.connect(Tone.Master);
      //}

      const processedBuffer = new TimeStretcher(Tone.context, this.fadeLength)
        .getStretchedTrimmedBuffer(this.buffer.get(), this.timeStretchRatio, this.offset, this.getBufferDuration());

      const player = new Tone.Player(new Tone.Buffer(processedBuffer));
      this.audioGraph.set(PLAYER, player);

      /*const player = new Tone.GrainPlayer(this.buffer);
      player.grainSize = 0.01;
      player.overlap = 0.05;
      player.loop = false;
      this.audioGraph.set(PLAYER, player);*/

      let offsetCorr = Math.min(this.offset, (this.fadeLength/2));
      player.sync().start(this.playTime-offsetCorr)//, this.offset-offsetCorr);//no duration given, makes it dynamic

      player.connect(panner);
      player.fadeIn = this.fadeLength;
      player.fadeOut = this.fadeLength;

      this.parameterDispatchers.forEach((dispatcher, paramType) => {
        if (paramType != Parameter.StartTime) { // will cause infinite loop
          dispatcher.update();
        }
      });

      this.isScheduled = true;

      //end events only updated once buffer is there and scheduled
      this.updateEndEvents();
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
    this.exitPlayState();
    const player = this.getPlayer();
    if (player) {
      if (player.volume) {
        player.volume.rampTo(Tone.gainToDb(0), this.fadeLength);
      }
      setTimeout(() => {
        //these calls often produce errors due to inconsistencies in tone
        try { player.unsync(); } catch (e) {};
        try { player.stop(); } catch (e) {};
      }, this.fadeLength*1000)
    }
  }

  private resetGraph() {
    this.audioGraph.forEach(node => node.dispose ? node.dispose() : node.disconnect());
    this.audioGraph.clear();
  }

  private async enterPlayState() {
    this.isPlaying = true;
  }

  private exitPlayState() {
    this.isPlaying = false;
    this.isDonePlaying = true;
  }

}

export class TonejsEventObject extends TonejsScheduledObject implements EventObject {

  private isScheduled;

  constructor(private triggerFunction: () => any, startTime: RefTimeWithOnset, timings: DynamicBufferLifeCycle) {
    super(startTime, timings);
    this.updateEvent();
  }

  set(param: Parameter, value: number | number[]): void {
    if (param === Parameter.StartTime) {
      if (!this.isScheduled && this.startTime.onset != value) {
        this.startTime.onset = <number>value;
        this.updateEvent();
      }
    }
  }

  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.removeAllEvents();
  }

  getDuration() {
    return 0;
  }

  private updateEvent() {
    this.updatePlayTime();
    this.scheduleEvent('scheduled', this.playTime, this.triggerFunction);
  }

}