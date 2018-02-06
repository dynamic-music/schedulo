import * as Tone from 'tone';

export class AudioBank {

  constructor(private minUnusedTime: number) {}

  private buffers = new Map<string, AudioBuffer>();
  private lastRequested = new Map<string, number>();

  /** returns the corresponding tone buffer and loads it if necessary */
  getToneBuffer(filePath: string): Promise<ToneBuffer> {
    this.lastRequested.set(filePath, Date.now());
    if (this.buffers.has(filePath)) {
      return this.createToneBuffer(this.buffers.get(filePath));
    }
    return this.createToneBuffer(filePath)
      .then(b => {
        this.buffers.set(filePath, b.get());
        return b;
      });
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