import * as Tone from 'tone';
import { Observable, BehaviorSubject } from 'rxjs';

export class AudioBank {

  constructor(private minUnusedTime: number) {}

  private buffers = new Map<string, AudioBuffer>();
  private lastRequested = new Map<string, number>();
  private bufferCount: BehaviorSubject<number> = new BehaviorSubject(0);

  private setBuffer(name: string, buffer: AudioBuffer) {
    this.buffers.set(name, buffer);
    this.updateBufferCount();
  }

  private deleteBuffer(name: string) {
    this.buffers.delete(name);
    this.updateBufferCount();
  }

  private updateBufferCount() {
    this.bufferCount.next(this.buffers.size);
  }

  getBufferCount(): Observable<number> {
    return this.bufferCount.asObservable();
  }

  preloadBuffers(filePaths: string[]): Promise<any> {
    return Promise.all(filePaths.map(f => {
      if (!this.buffers.has(f)) {
        return this.createToneBuffer(f).then(b => this.setBuffer(f, b.get()))
      }
    }));
  }

  async getAudioBuffer(filePath: string): Promise<AudioBuffer> {
    const toneBuffer = await this.getToneBuffer(filePath);
    return toneBuffer.get();
  }

  /** returns the corresponding tone buffer and loads it if necessary */
  async getToneBuffer(filePath: string): Promise<ToneBuffer> {
    this.lastRequested.set(filePath, Date.now());
    let buffer: AudioBuffer;
    if (!this.buffers.has(filePath)) {
      //TODO SOMEHOW TONEJS IS QUITE SLOW AT CREATING NEW BUFFERS!! (ca. 0.05s)
      buffer = (await this.createToneBuffer(filePath)).get();
      this.setBuffer(filePath, buffer);
    }
    buffer = this.buffers.get(filePath);
    return this.createToneBuffer(buffer);
  }

  freeBuffer(filePath: string) {
    const lastRequested = this.lastRequested.get(filePath);
    if (lastRequested && this.minUnusedTime*1000 < Date.now() - lastRequested) {
      this.deleteBuffer(filePath);
    }
  }

  private createToneBuffer(
      urlOrBuffer: string | AudioBuffer | undefined): Promise<ToneBuffer> {
    if (urlOrBuffer instanceof AudioBuffer) {
      return new Tone.Buffer(urlOrBuffer);
    }
    return new Promise((resolve, reject) =>
      new Tone.Buffer(
        urlOrBuffer,
        (loaded: ToneBuffer) => {
          loaded = loaded.slice(0, loaded.duration-0.02); //TODO HACK FOR SEMANTIC MACHINE M4As!
          console.log("loaded", urlOrBuffer)
          resolve(loaded)
        },
        (err: string) => reject(err)
      )
    );
  }

}