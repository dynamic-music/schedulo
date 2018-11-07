import * as WebAudioScheduler from 'web-audio-scheduler';
import { DynamicBufferLifeCycle } from '../life-cycle';
import { ScheduleTime, ScheduleAt, ScheduleAfter,
  ScheduleRelativeTo, RefTimeWithOnset } from '../types';
import { ScheduloEngine } from './engine';
import { OwnAudioObject, OwnEventObject } from './own-object';

declare var webkitAudioContext: any;

const REVERB_FILE = '../../audio/impulse_rev.wav';

export class OwnEngine extends ScheduloEngine {

  private audioContext: AudioContext;
  private scheduler: WebAudioScheduler;

  constructor(fadeLength: number, timings: DynamicBufferLifeCycle) {
    super(fadeLength, timings);
    this.audioContext = new (AudioContext || webkitAudioContext)();
    this.scheduler = new WebAudioScheduler({ context: this.audioContext });
    this.initSends();
  }

  private async initSends() {
    const reverb = this.audioContext.createConvolver();
    reverb.connect(this.audioContext.destination);
    //reverb.buffer = await this.loadBuffer(REVERB_FILE);
    this.reverb = reverb;

    const delay = this.audioContext.createDelay();
    delay.delayTime.value = this.DELAY_TIME;
    delay.connect(this.audioContext.destination);
    const delayFeedback = this.audioContext.createGain();
    delayFeedback.gain.value = this.DELAY_FEEDBACK;
    delay.connect(delayFeedback);
    delayFeedback.connect(delay);
    this.delay = delay;

    //this.filter = new Tone.Filter(200, "lowpass").toMaster();
  }

  getAudioContext() {
    return this.audioContext;
  }

  start() {
    this.scheduler.start();
  }

  pause() {
    this.scheduler.stop(false);
  }

  stop() {
    this.scheduler.stop(true);
  }

  createAudioObject(fileUri: string, startTime: ScheduleTime) {
    const times = this.calculateScheduleTime(startTime);
    return new OwnAudioObject(fileUri, this.timings, this, times, this.scheduler);
  }

  createEventObject(triggerFunction: () => any, startTime: ScheduleTime) {
    const times = this.calculateScheduleTime(startTime);
    return new OwnEventObject(triggerFunction, times, this.timings, this.scheduler);
  }

  async loadBuffer(filePath: string): Promise<AudioBuffer> {
    const response = await fetch(filePath, {
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });
    return new Promise<AudioBuffer>(async (res, rej) =>
      this.audioContext.decodeAudioData(await response.arrayBuffer(), res, rej)
    );
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
      return {ref: this.calculateEndTime(time.objects)-this.fadeLength};
    } else if (time instanceof ScheduleRelativeTo) {
      return {ref: time.object.getScheduleTime(), onset: Number(time.delta)};
    } else if (time instanceof ScheduleAt) {
      //adjust to changing count in!!
      return {ref: Number(time.at)};
    } /*else if (time instanceof ScheduleNext) {
      let subdiv = time.next === Subdivision.Bar ? "1m" : "1n";
      return {ref: Tone.Transport.nextSubdivision(subdiv)};
    } else if (time instanceof ScheduleIn) {
      return {ref: Tone.Transport.nextSubdivision(time.inn)};
    }*/ else { //instanceof Asap!!
      return {ref: this.audioContext.currentTime};
    }
  }

}