import * as Tone from 'tone';
import { TimeStretcher } from './timestretcher';

export class AudioBank {

  constructor(private minUnusedTime: number, private fadeLength: number) {}

  private buffers = new Map<string, AudioBuffer>();
  private stretchedBuffers = new Map<string, Map<number, AudioBuffer>>();
  private lastRequested = new Map<string, number>();

  preloadBuffers(filePaths: string[]): Promise<any> {
    return Promise.all(filePaths.map(f => {
      if (!this.buffers.has(f)) {
        this.createToneBuffer(f)
          .then(b => this.buffers.set(f, b.get()))
      }
    }));
  }

  /** returns the corresponding tone buffer and loads it if necessary */
  async getToneBuffer(filePath: string, stretchRatio?: number, offset?: number, duration?: number): Promise<ToneBuffer> {
    this.lastRequested.set(filePath, Date.now());
    let buffer: AudioBuffer;
    if (!this.buffers.has(filePath)) {
      //TODO SOMEHOW TONEJS IS QUITE SLOW AT CREATING NEW BUFFERS!! (ca. 0.05s)
      buffer = (await this.createToneBuffer(filePath)).get();
      this.buffers.set(filePath, buffer);
    }
    buffer = this.buffers.get(filePath);
    if (stretchRatio != 1 || offset != null || duration != null) {
      buffer = new TimeStretcher(Tone.context, this.fadeLength)
        .getStretchedTrimmedBuffer(buffer, stretchRatio, offset, duration);
    }
    return this.createToneBuffer(buffer);
  }

  async getAudioBuffer(filePath: string): Promise<AudioBuffer> {
    return (await this.getToneBuffer(filePath)).get();
  }

  freeBuffer(filePath: string) {
    const lastRequested = this.lastRequested.get(filePath);
    if (lastRequested && this.minUnusedTime*1000 < Date.now() - lastRequested) {
      this.buffers.delete(filePath);
    }
  }

  private createToneBuffer(
      urlOrBuffer: string | AudioBuffer | undefined): Promise<ToneBuffer> {
    return new Promise((resolve, reject) =>
      new Tone.Buffer(
        urlOrBuffer,
        (loaded: ToneBuffer) => resolve(loaded),
        (err: string) => reject(err)
      )
    );
  }

}