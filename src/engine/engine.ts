import { ScheduleTime, RefTimeWithOnset, AudioObject, EventObject, ScheduloObject } from '../types';
import { AudioBank } from '../audio-bank';
import { DynamicBufferLifeCycle } from '../life-cycle';

export abstract class ScheduloEngine {

  protected audioBank: AudioBank;
  protected reverb: AudioNode;
  protected delay: AudioNode;
  protected lowpass: AudioNode;
  protected highpass: AudioNode;
  protected distortion: AudioNode;
  protected DELAY_TIME = 0.47;
  protected DELAY_FEEDBACK = 0.6;

  constructor(protected fadeLength: number, protected timings: DynamicBufferLifeCycle) {
    const bufferWindow = timings.loadBuffer.countIn+timings.loadBuffer.countOut;
    this.audioBank = new AudioBank(bufferWindow, this);
  }

  getFadeLength() {
    return this.fadeLength;
  }

  getAudioBank() {
    return this.audioBank;
  }

  getReverb() {
    return this.reverb;
  }

  getDelay() {
    return this.delay;
  }

  getLowpass() {
    return this.lowpass;
  }
  
  getHighpass() {
    return this.highpass;
  }
  
  getDistortion() {
    return this.distortion;
  }

  abstract getAudioContext(): AudioContext;
  abstract start(): void;
  abstract pause(): void;
  abstract stop(): void;
  abstract createAudioObject(fileUri: string, startTime: ScheduleTime): AudioObject;
  abstract createEventObject(triggerFunction: () => any, startTime: ScheduleTime): EventObject;
  abstract calculateScheduleTime(time: ScheduleTime): RefTimeWithOnset;
  abstract loadBuffer(filePath: string): Promise<AudioBuffer>;
  abstract setListenerOrientation(posX: number, posY: number, posZ: number, forwX: number, forwY: number, forwZ: number);
  abstract setListenerPosition(x: number, y: number, z: number);

  //TODO GET RID OF THIS, NEEDS TO BE DYNAMIC, WITH DEPENDENCIES
  protected calculateEndTime(objects: ScheduloObject[]): number {
    let endTimes = objects.map(o => o.getEndTime());
    return Math.max(...endTimes);
  }

}