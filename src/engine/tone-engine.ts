import * as Tone from 'tone';
import { ScheduleTime, ScheduleAt, ScheduleNext, ScheduleIn, ScheduleAfter,
  ScheduleRelativeTo, RefTimeWithOnset, Subdivision } from '../types';
import { DynamicBufferLifeCycle } from '../life-cycle';
import { ScheduloEngine } from './engine';
import { TonejsAudioObject, TonejsEventObject } from './tone-object';

export class ToneEngine extends ScheduloEngine {

  constructor(fadeLength: number, timings: DynamicBufferLifeCycle) {
    super(fadeLength, timings);
    this.reverb = new Tone.Freeverb().toMaster();
    this.delay = new Tone.FeedbackDelay(this.DELAY_TIME, this.DELAY_FEEDBACK).toMaster();
    this.filter = new Tone.Filter(200, "lowpass").toMaster();
  }

  getAudioContext() {
    return Tone.context;
  }
  
  setListenerOrientation(posX: number, posY: number, posZ: number, forwX: number, forwY: number, forwZ: number) {
    Tone.Listener.setOrientation(posX, posY, posZ, forwX, forwY, forwZ);
  }
  
  setListenerPosition(x: number, y: number, z: number) {
    Tone.Listener.setPosition(x, y, z);
  }

  start() {
    Tone.Transport.start("+0.1");
  }

  /** pauses if not paused, resumes otherwise */
  pause(): void {
    if (Tone.Transport.state == "started") {
      Tone.Transport.pause("+0.1");
    } else if (Tone.Transport.state == "paused") {
      this.start();
    }
  }

  stop() {
    if (Tone.Transport.state == "started") {
      Tone.Transport.stop("+0.1");
    }
  }

  createAudioObject(fileUri: string, startTime: ScheduleTime) {
    const times = this.calculateScheduleTime(startTime);
    return new TonejsAudioObject(fileUri, this.timings, this, times);
  }

  createEventObject(triggerFunction: () => any, startTime: ScheduleTime) {
    const times = this.calculateScheduleTime(startTime);
    return new TonejsEventObject(triggerFunction, times, this.timings);
  }

  //pair of ref and time
  calculateScheduleTime(time: ScheduleTime): RefTimeWithOnset {
    if (time instanceof ScheduleAfter) {
      // TODO this isn't going to work for objects with an indeterminate duration.
      // This is only really complicated by the fact that we want to be able to
      // loop audio continuiously, i.e. n repeats is not known ahead of time.
      // Looping will eventually stop based on some external event, and so
      // at some unknown point in the future, it eventually ends.
      // Unfortunately, unless it is possible to obtain the explicit eventual
      // stop time prior to it occuring, there is going to be a delay in scheduling
      // the next event. Either way, we can't know any time upfront...
      // so this needs rethinking
      return {ref: new Tone.Time(this.calculateEndTime(time.objects)).toSeconds()}//-this.fadeLength};
    } else if (time instanceof ScheduleRelativeTo) {
      //const diff = new Tone.Time(add(time.object.getStartTime(), time.delta)).toSeconds();
      //console.log("CALC", this.timings.connectToGraph.countIn)
      let delta = new Tone.Time(time.delta).toSeconds();
      return {ref: time.object.getScheduleTime(), onset: delta};
    } else if (time instanceof ScheduleAt) {
      //adjust to changing count in!!
      return {ref: new Tone.Time(time.at).toSeconds()};
    } else if (time instanceof ScheduleNext) {
      let subdiv = time.next === Subdivision.Bar ? "1m" : "1n";
      return {ref: Tone.Transport.nextSubdivision(subdiv)};
    } else if (time instanceof ScheduleIn) {
      return {ref: Tone.Transport.nextSubdivision(time.inn)};
    } else { //instanceof Asap!!
      return {ref: Tone.Transport.seconds};
    }
  }

  /** returns the corresponding tone buffer and loads it if necessary */
  async getToneBuffer(filePath: string): Promise<ToneBuffer> {
    return this.createToneBuffer(await this.audioBank.getAudioBuffer(filePath));
  }

  async loadBuffer(filePath: string): Promise<AudioBuffer> {
    return (await this.createToneBuffer(filePath)).get();
  }

  private createToneBuffer(
      urlOrBuffer: string | AudioBuffer | undefined): Promise<ToneBuffer> {
    if (urlOrBuffer instanceof AudioBuffer) {
      return new Tone.Buffer(urlOrBuffer);
    }
    return new Promise((resolve, reject) =>
      new Tone.Buffer(urlOrBuffer, resolve, reject));
  }

}