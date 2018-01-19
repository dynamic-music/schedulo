import * as Tone from 'tone';

export class AudioBank {

  constructor() {}

  private buffers = new Map<string, AudioBuffer>();

  /** returns the corresponding tone buffer and loads it if necessary */
  getToneBuffer(filePath: string): Promise<ToneBuffer> {
    return new Promise((resolve, reject) => {
      //only add if not there yet..
      if (!this.buffers.get(filePath)) {
        const buffer = new Tone.Buffer(
          filePath,
          (loaded: ToneBuffer) => {
            const buffer = loaded.get();
            this.buffers.set(filePath, buffer);
            resolve(loaded);
          },
          (err: string) => reject(err)
        );
      } else {
        const buffer = new Tone.Buffer(
          this.buffers.get(filePath),
          (loaded: ToneBuffer) => {
            resolve(loaded);
          },
          (err: string) => reject(err)
        );
      }
    });
  }

  freeBuffer(filePath: string) {
    this.buffers.delete(filePath);
  }

}