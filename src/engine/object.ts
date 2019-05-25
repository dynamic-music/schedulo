import { ScheduloObject, Parameter, ScheduleTime,
  StoppingMode, ObjectStatus, RefTimeWithOnset, AudioObject, EventObject } from '../types';
import { DynamicBufferLifeCycle, IEvent, IEmitter, SingleOrMultiValueDispatcher,
  StoredValueHandler, LifeCycleWindow } from '../life-cycle';
import { ScheduloEngine } from './engine';
import { TimeStretcher } from './timestretcher';
import { OwnAudioObject } from './own-object';

export abstract class EventHandler {

  constructor(protected emitter: IEmitter<string, any>) {}

  abstract createEvent(name: ObjectStatus, task?: (n?: number) => void): IEvent;

  on(event: string, callback: (...args: any[]) => void) {
    this.emitter.on(event, callback);
  }

  off(event: string, callback: (...args: any[]) => void) {
    this.emitter.off(event, callback);
  }

  dispose() {
    this.emitter.dispose();
  }

  emit(event: ObjectStatus, args: number | string) {
    //console.log(event, args)
    this.emitter.emit(event, args);
  }

}

export abstract class ScheduledObject implements ScheduloObject {

  protected scheduledEvents: Map<string, IEvent> = new Map();
  protected playTime: number;
  protected isScheduled = false;

  constructor(protected startTime: RefTimeWithOnset,
      protected timings: DynamicBufferLifeCycle,
      protected eventHandler: EventHandler
    ) {
    if (this.startTime.onset == null) this.startTime.onset = 0;
  }

  abstract getDuration(): number;
  abstract set(param: Parameter, value: number | number[]): void;
  abstract stop(time: ScheduleTime, mode: StoppingMode): void;

  getScheduleTime() {
    return this.startTime.ref+this.startTime.onset;
  }
  
  getEndTime() {
    const time = this.getScheduleTime();
    const duration = this.getDuration();
    return duration ? time+duration : time;
  }

  protected updatePlayTime() {
    this.playTime = this.startTime.ref+this.startTime.onset+this.timings.connectToGraph.countIn;
  }

  /** schedules an event with the given task, adds it to the scheduled map,
    and returns a promise that gets resolved when the event is triggered, to
    enable scheduling dependent events. errors are simply caught and printed */
  protected scheduleEvent(name: ObjectStatus, time: number,
      task?: (n?: number) => void): Promise<void> {
    const event = this.eventHandler.createEvent(name, task);
    const oldEvent = this.scheduledEvents.get(name);
    this.scheduledEvents.set(name, event);
    //dispose old event and replace
    if (oldEvent) {
      oldEvent.cancel();
      oldEvent.dispose();
    }
    event.start(time);
    return this.createStatusPromise(name);
  }

  private createStatusPromise(name: ObjectStatus): Promise<void> {
    return new Promise(resolve => this.on(name, resolve));
  }

  protected removeAllEvents() {
    if (this.scheduledEvents.size > 0) {
      this.scheduledEvents.forEach(event => event.cancel());
      this.scheduledEvents.forEach(event => event.dispose());
      this.scheduledEvents = new Map();
    }
  }

  on(event: string, callback: (...args: any[]) => void): this {
    this.eventHandler.on(event, callback);
    return this;
  }

  off(event: string, callback: (...args: any[]) => void): this {
    this.eventHandler.off(event, callback);
    return this;
  }

  dispose() {
    this.eventHandler.dispose();
    return this;
  }

  emit(event: ObjectStatus, args: number | string): this {
    this.eventHandler.emit(event, args);
    return this;
  }

}

export enum NodeName {
  Player = "player",
  Source = "source",
  SourceGain = "sourceGain",
  Panner = "panner",
  Delay = "delay",
  Filter = "filter",
  Reverb = "reverb"
}

export abstract class ScheduledAudioObject extends ScheduledObject implements AudioObject {

  private startTimeDependentKeys: ObjectStatus[] = ['playing', 'scheduled', 'loaded'];
  private durationDependentKeys: ObjectStatus[] = ['stopped', 'disposed', 'freed'];

  protected buffer: AudioBuffer;
  protected audioGraph: Map<string,AudioNode> = new Map();
  protected parameterDispatchers: Map<Parameter, SingleOrMultiValueDispatcher> = new Map();
  protected timestretcher: TimeStretcher;
  protected offset = 0;
  protected duration: number; // undefined means entire buffer is played
  protected durationRatio = 1;
  protected timeStretchRatio = 1;
  protected filterCutoff = 1;
  protected bufferLoaded = false;
  private isPlaying = false;
  protected isDonePlaying = false;

  private loadTime: number;
  private schedTime: number;
  private loading: Promise<any>;
  private scheduling: Promise<any>;

  constructor(
    private fileUri: string,
    timings: DynamicBufferLifeCycle,
    protected engine: ScheduloEngine,
    startTime: RefTimeWithOnset,
    eventHandler: EventHandler,
    addFades: boolean
  ) {
    super(startTime, timings, eventHandler);
    this.timestretcher = new TimeStretcher(this.engine.getAudioContext(),
        this.engine.getFadeLength(), addFades);
  }

  //to be called in constructors of inheriting classes
  protected init() {
    this.initParamDispatchers();
    this.updateStartEvents();
  }


  protected abstract setGain(nodeName: NodeName, value: number, rampTime?: number): void;
  protected abstract setPlaybackRate(value: number): void;
  protected abstract getPlaybackRate(): number;
  protected abstract getNow(): number;
  protected abstract async setupAudioGraphAndPlayer();
  protected abstract async stopPlayer();

  protected setPannerPosition(x: number, y: number, z: number) {
    (<PannerNode>this.audioGraph.get(NodeName.Panner)).setPosition(x, y, z);
  }

  ramp(param: Parameter, value: number, duration: number | string, time: number | string): void {
    if (param === Parameter.Amplitude) {
      //TODO DOESNT WORK FOR OWNOBJECT (BUT NOT CURRENTLY USED ANYWAY)
      //this.getPlayer().volume.linearRampTo(value, duration, time);
    }
  }

  //stopped from outside
  stop(time: ScheduleTime, mode: StoppingMode): void {
    this.stopPlayer();
    this.removeAllEvents();
    this.scheduleStopAndCleanup(this.getNow());
  }

  //actual duration when playing
  getDuration(): number {
    let duration = this.getBufferDuration()/this.timeStretchRatio;
    if (this.isScheduled) {
      duration /= this.getPlaybackRate();
    }
    return duration;
  }

  //duration of trimmed buffer
  private getBufferDuration() {
    let duration: number;
    if (this.duration) {
      duration = this.duration*this.durationRatio;
    } else if (this.bufferLoaded) {
      duration = (this.buffer.duration - this.offset)*this.durationRatio;
    }
    if (duration) {
      if (this.fileUri && (this.fileUri.indexOf("m4a") > 0 || this.fileUri.indexOf("mp3") > 0)) {
        duration -= 0.02;//compensate for silence at end of files
      }
      return duration;
    }
  }

  protected initParamDispatchers() {
    this.parameterDispatchers.set(
      Parameter.Amplitude,
      new StoredValueHandler({
        currentValue: 1.0,
        handler: (n: number) => this.setGain(NodeName.Player, n)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Panning,
      new StoredValueHandler({
        currentValue: [0.0, 0.0, 0.0],
        handler: (n: number[]) => this.setPannerPosition(n[0], n[1], n[2])

      })
    );
    this.parameterDispatchers.set(
      Parameter.Reverb,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.setGain(NodeName.Reverb, n*2)
      })
    );
    this.parameterDispatchers.set(
      Parameter.Delay,
      new StoredValueHandler({
        currentValue: 0.0,
        handler: (n: number) => this.setGain(NodeName.Delay, n)
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
        handler: this.setPlaybackRate.bind(this)
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
    } else if (param === Parameter.TimeStretchRatio && this.timeStretchRatio != value && !this.bufferLoaded) {
      this.timeStretchRatio = <number>value;
      this.updateEndEvents();
    } else if (param === Parameter.Offset && this.offset != value && !this.bufferLoaded) {
      this.offset = <number>value;
    }
  }

  protected async updateStartEvents() {
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
    const now = this.getNow();
    return ideal <= now ? now + delta : ideal;
  }

  protected updateEndEvents() {
    if (this.bufferLoaded && this.isScheduled && !this.isDonePlaying) {
      let duration = this.getDuration();
      //console.log(this.startTime.ref, this.duration, this.durationRatio, duration, (<Player>this.audioGraph.get(PLAYER)).playbackRate)
      if (duration) {
        this.scheduleStopAndCleanup(this.playTime + duration);
      }
    }
  }

  private scheduleStopAndCleanup(stopTime: number) {
    if (stopTime > this.getNow() || !this.scheduledEvents.has('stopped')) {
      const fadedTime = stopTime + this.engine.getFadeLength();
      const disposeTime = fadedTime + this.timings.connectToGraph.countOut;
      const freeTime = fadedTime + this.timings.loadBuffer.countOut;
      this.scheduleEvent('stopped', stopTime, this.stopPlayer.bind(this));
      this.scheduleEvent('disposed', disposeTime, this.resetGraph.bind(this));
      this.scheduleEvent('freed', freeTime, this.freeBuffer.bind(this));
    }
  }

  private async initBuffer() {
    const ignore = this.timings.loadBuffer.ignoreInaudible && !this.isAudible();
    if (this.fileUri && !ignore) {
      this.buffer = await this.engine.getAudioBank().getAudioBuffer(this.fileUri);
      this.bufferLoaded = true;
    }
  }

  protected getProcessedBuffer() {
    return this.timestretcher
      .getStretchedTrimmedBuffer(this.buffer, this.timeStretchRatio,
        this.offset, this.getBufferDuration());
  }

  protected async freeBuffer() {
    if (this.buffer) {
      this.buffer = null;
    }
    this.engine.getAudioBank().freeBuffer(this.fileUri);
    //completely done, so remove all events
    this.removeAllEvents();
  }

  protected async initAndSchedulePlayer() {
    if (this.loading) {
      await this.loading;
    }

    if (!this.bufferLoaded) {
      if (this.fileUri) {
        if (this.timings.loadBuffer.ignoreInaudible) {
          console.warn("buffer of inaudible object ignored");
        } else {
          console.warn("buffer not loaded in time");
          //increase load ahead time
          this.increaseCountIn(this.timings.loadBuffer, 0.5);
        }
      }
    } else if (this.playTime < this.getNow()) {
      console.warn("scheduled too late", this.fileUri);
      //increase schedule ahead time
      this.increaseCountIn(this.timings.loadBuffer, 0.2);
      this.increaseCountIn(this.timings.connectToGraph, 0.2);
      //try decreasing load ahead time
      this.decreaseCountIn(this.timings.loadBuffer, 0.01);
    } else {
      //try decreasing schedule and loading ahead time
      this.decreaseCountIn(this.timings.connectToGraph, 0.01);
      this.decreaseCountIn(this.timings.loadBuffer, 0.01);

      this.setupAudioGraphAndPlayer();

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

  protected isAudible(): boolean {
    const amp = this.parameterDispatchers.get(Parameter.Amplitude).stored.currentValue;
    const rev = this.parameterDispatchers.get(Parameter.Reverb).stored.currentValue;
    const del = this.parameterDispatchers.get(Parameter.Delay).stored.currentValue;
    return amp > 0 || rev > 0 || del > 0;
  }

  protected resetGraph() {
    this.audioGraph.forEach(node => node.dispose ? node.dispose() : node.disconnect());
    this.audioGraph.clear();
  }

  protected async enterPlayState() {
    this.isPlaying = true;
  }

  protected exitPlayState() {
    this.isPlaying = false;
    this.isDonePlaying = true;
  }

  protected increaseCountIn(window: LifeCycleWindow, increment: number) {
    //adjust min so never goes below that again
    if (window.countIn == window.minCountIn) {
      window.minCountIn += increment;
    }
    window.countIn += increment;
  }

  protected decreaseCountIn(window: LifeCycleWindow, decrement: number) {
    window.countIn = Math.max(window.minCountIn, window.countIn-decrement);
  }

}

export abstract class ScheduledEventObject extends ScheduledObject implements EventObject {

  constructor(protected triggerFunction: () => any, startTime: RefTimeWithOnset,
      timings: DynamicBufferLifeCycle, eventHandler: EventHandler) {
    super(startTime, timings, eventHandler);
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