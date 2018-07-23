import * as Tone from 'tone';

export class AudioBank {

  constructor(private minUnusedTime: number) {}

  private buffers = new Map<string, AudioBuffer>();
  private lastRequested = new Map<string, number>();

  preloadBuffers(filePaths: string[]): Promise<any> {
    return Promise.all(filePaths.map(f => this.createToneBuffer(f)
      .then(b => this.buffers.set(f, b.get()))));
  }

  /** returns the corresponding tone buffer and loads it if necessary */
  getToneBuffer(filePath: string): Promise<ToneBuffer> {
    this.lastRequested.set(filePath, Date.now());
    if (this.buffers.has(filePath)) {
      //TODO SOMEHOW TONEJS IS QUITE SLOW AT CREATING NEW BUFFERS!! (ca. 0.05s)
      return this.createToneBuffer(this.buffers.get(filePath));
    }
    return this.createToneBuffer(filePath)
      .then(b => {
        this.buffers.set(filePath, b.get());
        return b;
      });
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