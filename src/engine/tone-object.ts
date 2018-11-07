import * as Tone from 'tone';
import { Event as ToneEvent } from 'tone';
import { EventObject, RefTimeWithOnset, ObjectStatus } from '../types';
import { DynamicBufferLifeCycle, IEvent } from '../life-cycle';
import { ToneEngine } from './tone-engine';
import { EventHandler, ScheduledAudioObject, ScheduledEventObject, NodeName } from './object';

export class ToneEventHandler extends EventHandler {

  constructor() {
    super(new Tone.Emitter());
  }

  createEvent(name: ObjectStatus, task?: (n?: number) => void): IEvent {
    return new ToneEvent(async time => {
      try {
        await task(time);
        this.emit(name, time);
      } catch (err) {
        console.warn(err);//, this.fileUri);
      }
      //event.stop(); produces lots of errors
    });
  }

}

export class TonejsAudioObject extends ScheduledAudioObject {

  private toneBuffer: ToneBuffer;

  constructor(
    fileUri: string,
    timings: DynamicBufferLifeCycle,
    engine: ToneEngine,
    startTime: RefTimeWithOnset
  ) {
    super(fileUri, timings, engine, startTime, new ToneEventHandler());
    this.init();
  }

  protected setGain(nodeName: string, value: number, rampTime?: number) {
    const db = Tone.gainToDb(value);
    const volume = (<Volume>this.audioGraph.get(nodeName)).volume;
    if (volume) {
      rampTime = rampTime ? rampTime : 0.01;
      (<Volume>this.audioGraph.get(nodeName)).volume.linearRampTo(db, rampTime);
    }
  }

  protected getPlayer(): Player {
    return <Player>this.audioGraph.get(NodeName.Player);
  }

  protected setPlaybackRate(value: number) {
    this.getPlayer().playbackRate = value;
  }

  protected getPlaybackRate() {
    return this.getPlayer().playbackRate;
  }

  protected getNow() {
    return Tone.Transport.seconds;
  }

  protected async freeBuffer() {
    super.freeBuffer();
    if (this.toneBuffer) {
      this.toneBuffer.dispose();
      this.toneBuffer = null;
    }
  }

  protected async setupAudioGraphAndPlayer() {
    this.audioGraph.set(NodeName.Reverb, new Tone.Volume(0).connect(this.engine.getReverb()));
    this.audioGraph.set(NodeName.Delay, new Tone.Volume(0).connect(this.engine.getDelay()));
    //this.panner = new Tone.Panner3D(0, 0, 0).toMaster();
    const panner = Tone.context.createPanner();
    this.audioGraph.set(NodeName.Panner, panner);
    panner.connect(this.audioGraph.get(NodeName.Reverb));
    panner.connect(this.audioGraph.get(NodeName.Delay));

    /*if (this.fil) {
      this.audioGraph.set(FILTER, new Tone.Volume(0).connect(this.filter));
      panner.connect(Tone.Master);
    } else {*/
      panner.connect(Tone.Master);
    //}

    const player = new Tone.Player(new Tone.Buffer(this.getProcessedBuffer()));
    this.audioGraph.set(NodeName.Player, player);

    /*const player = new Tone.GrainPlayer(this.buffer);
    player.grainSize = 0.01;
    player.overlap = 0.05;
    player.loop = false;
    this.audioGraph.set(PLAYER, player);*/

    let offsetCorr = Math.min(this.offset, (this.engine.getFadeLength()/2));
    player.sync().start(this.playTime-offsetCorr)//, this.offset-offsetCorr);//no duration given, makes it dynamic

    player.connect(panner);
  }

  protected stopPlayer() {
    this.exitPlayState();
    const player = this.getPlayer();
    if (player) {
      this.setGain(NodeName.Player, 0, this.engine.getFadeLength());
      setTimeout(() => {
        //these calls often produce errors due to inconsistencies in tone
        try { player.unsync(); } catch (e) {};
        try { player.stop(); } catch (e) {};
      }, this.engine.getFadeLength()*1000)
    }
  }

}

export class TonejsEventObject extends ScheduledEventObject implements EventObject {

  constructor(triggerFunction: () => any, startTime: RefTimeWithOnset, timings: DynamicBufferLifeCycle) {
    super(triggerFunction, startTime, timings, new ToneEventHandler());
  }

}