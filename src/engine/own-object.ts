import * as WebAudioScheduler from 'web-audio-scheduler';
import { EventObject, RefTimeWithOnset, ObjectStatus } from '../types';
import { IEmitter, IEvent, DynamicBufferLifeCycle } from '../life-cycle';
import { EventHandler, ScheduledAudioObject, ScheduledEventObject, NodeName } from './object';
import { OwnEngine } from './own-engine';

class OwnEmitter implements IEmitter<string, any> {

  private listeners = new Map<string, Function[]>();

  emit(event: string): this {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(c => c());
    }
    return this;
  }

  on(event: string, callback: Function): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
    return this;
  }

  off(event: string, callback: Function): this {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.splice(callbacks.indexOf(callback));
    }
    if (callbacks.length == 0) {
      this.listeners.delete(event);
    }
    return this;
  }

  dispose() {
    this.listeners = null;
    return this;
  }
}

class OwnEvent implements IEvent {

  private eventId: number;

  constructor(private scheduler: WebAudioScheduler,
    private task: (time: number) => void) {}

  start(time: number) {
    this.eventId = this.scheduler.insert(time, this.task);
  }

  cancel() {
    if (this.eventId) {
      this.scheduler.remove(this.eventId);
    }
  }

  dispose() {
    this.cancel();
    this.scheduler = null;
    this.task = null;
  }

}

export class OwnEventHandler extends EventHandler {

  constructor(private scheduler: WebAudioScheduler) {
    super(new OwnEmitter());
  }

  createEvent(name: ObjectStatus, task: (n?: number) => void): IEvent {
    return new OwnEvent(this.scheduler, async time => {
      try {
        await task(time);
        //console.log(name, time);
        this.emit(name, time);
      } catch (err) {
        console.warn(err);//, this.fileUri);
      }
      //event.stop(); produces lots of errors
    });
  }

}

export class OwnAudioObject extends ScheduledAudioObject {

  constructor(
    fileUri: string,
    timings: DynamicBufferLifeCycle,
    engine: OwnEngine,
    startTime: RefTimeWithOnset,
    private scheduler: WebAudioScheduler
  ) {
    super(fileUri, timings, engine, startTime, new OwnEventHandler(scheduler));
    this.init();
  }

  protected setGain(nodeName: string, value: number, rampTime?: number) {
    const gainParam = nodeName === NodeName.Player ?
      ((<GainNode>this.audioGraph.get(NodeName.SourceGain)).gain) :
      (<GainNode>this.audioGraph.get(nodeName)).gain;
    if (gainParam) {
      rampTime = rampTime ? rampTime : 0.01;
      gainParam.linearRampToValueAtTime(value, rampTime);
    }
  }

  protected getBufferSourceNode(): AudioBufferSourceNode {
    return <AudioBufferSourceNode>this.audioGraph.get(NodeName.Source);
  }

  protected setPlaybackRate(value: number) {
    this.getBufferSourceNode().playbackRate.linearRampToValueAtTime(value, 0.01);
  }

  protected getPlaybackRate(): number {
    return this.getBufferSourceNode().playbackRate.value;
  }

  protected getNow(): number {
    return this.scheduler.currentTime; //TODO CHECK IF MS OR S??
  }

  protected async setupAudioGraphAndPlayer() {
    const context = this.engine.getAudioContext();
    const reverbGain = context.createGain();
    const delayGain = context.createGain();
    reverbGain.connect(this.engine.getReverb());
    delayGain.connect(this.engine.getDelay());
    reverbGain.gain.value = 0;
    delayGain.gain.value = 0;
    this.audioGraph.set(NodeName.Reverb, reverbGain);
    this.audioGraph.set(NodeName.Delay, delayGain);
    //this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
    const panner = context.createPanner();
    this.audioGraph.set(NodeName.Panner, panner);
    panner.connect(this.audioGraph.get(NodeName.Reverb));
    panner.connect(this.audioGraph.get(NodeName.Delay));

    /*if (this.fil) {
      this.audioGraph.set(FILTER, new Tone.Volume(0).connect(this.filter));
      panner.connect(Tone.Master);
    } else {*/
      panner.connect(context.destination);
    //}

    const source = context.createBufferSource();
    source.buffer = this.getProcessedBuffer();
    this.audioGraph.set(NodeName.Source, source);
    const sourceGain = context.createGain();
    sourceGain.connect(panner);
    this.audioGraph.set(NodeName.SourceGain, sourceGain);
    source.connect(sourceGain);

    let offsetCorr = Math.min(this.offset, (this.engine.getFadeLength()/2));

    //TODO SCHEDULE THIS!!!!!?
    source.start(this.playTime-offsetCorr)//, this.offset-offsetCorr);//no duration given, makes it dynamic
  }

  protected stopPlayer() {
    this.exitPlayState();
    const source = this.getBufferSourceNode();
    if (source) {
      this.setGain(NodeName.SourceGain, 0, this.engine.getFadeLength());
      setTimeout(() => {
        //these calls often produce errors due to inconsistencies in tone
        try {
          source.stop();
          source.dispose();
        } catch (e) {};
      }, this.engine.getFadeLength()*1000)
    }
  }

}

export class OwnEventObject extends ScheduledEventObject implements EventObject {

  constructor(triggerFunction: () => any, startTime: RefTimeWithOnset,
      timings: DynamicBufferLifeCycle, scheduler: WebAudioScheduler) {
    super(triggerFunction, startTime, timings, new OwnEventHandler(scheduler));
  }

}

