import { Observable, BehaviorSubject } from 'rxjs';
import { ScheduloEngine } from './engine/engine';

export class AudioBank {

  constructor(private minUnusedTime: number, private engine: ScheduloEngine) {}

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
    return Promise.all(filePaths.map(this.getAudioBuffer.bind(this)));
  }

  async getAudioBuffer(filePath: string): Promise<AudioBuffer> {
    this.lastRequested.set(filePath, Date.now());
    if (!this.buffers.has(filePath)) {
      this.setBuffer(filePath, await this.engine.loadBuffer(filePath));
    }
    return this.buffers.get(filePath);
  }

  freeBuffer(filePath: string) {
    const lastRequested = this.lastRequested.get(filePath);
    if (lastRequested && this.minUnusedTime*1000 < Date.now() - lastRequested) {
      this.deleteBuffer(filePath);
    }
  }

}