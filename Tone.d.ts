type UntypedBodge = {[key: string]: any}
declare const ToneInstance: Tone & UntypedBodge;

declare module 'tone' {
  export = ToneInstance;
}

type Tone = {
  Time: TimeConstructor;
  TimeBase: TimeBaseConstructor;
  Transport: ToneTransport;
  Player: PlayerConstructor;
  gainToDb(gain: number): number;
  Event: ToneEventConstructor<any>;
  Emitter: Emitter<Object | Function>;
  Panner3D: Panner3DConstructor;
  Volume: VolumeConstructor;
};

type BarsBeatsSixteenths = string;
type Notation = string;

interface TimeBase {
  add(val: Time, units?: string): this;
  clone(): this;
  dispose(): void;
  div(val: Time, units?: string): this;
  mult(val: Time, units?: string): this;
  set(exprString: string): this;
  sub(val: Time, units?: string): this;
  valueOf(): number;
}

interface Time extends TimeBase {
  addNow(): Time;
  copy(): Time;
  quantize(): Time;
  toBarsBeatsSixteeths(): BarsBeatsSixteenths;
  toFrequency(): number;
  toMilliseconds(): number;
  toNotation(): Notation;
  toSamples(): number;
  toSeconds(): number;
  toTicks(): number;
}

interface TimeBaseConstructor {
  new(val: string | number, units?: string): TimeBase;
}

interface TimeConstructor {
  new(val: string | number, units?: string): Time;
}

interface ToneTransport {
  seconds: number,
  loop: boolean,
  loopStart: number,
  loopEnd: number,
  bpm: { value: number },
  timeSignature: number | number[],
  nextSubdivision(t: string | number): number,
  start(t: string): void
}

interface Signal {
  value: number,
  linearRampTo(value: number, duration: string | number, stopTime: string | number): void
}

interface ToneBuffer {
  get(): AudioBuffer;
  duration: number;
} // TODO, currently incomplete

interface AudioNode {
  connect(unit: AudioNode): this;
  toMaster(): this;
}

interface PlayerConstructorOptions {
  url?: string | ToneBuffer;
  onload?: (player: Player) => void;
  playbackRate?: number;
  loop?: boolean;
  autostart?: boolean;
  loopStart?: number;
  loopEnd?: number;
  retrigger?: boolean;
  reverse?: boolean;
  fadeIn?: number;
  fadeOut?: number;
}

interface PlayerConstructor {
  new(bufferOrOptions: string | ToneBuffer | PlayerConstructorOptions): Player;
}

interface Player extends AudioNode {
  buffer: ToneBuffer;
  volume: Signal;
  loop: boolean;
  playbackRate: number;
  loopEnd: number;
  loopStart: number;
  unsync(): Player;
  sync(): Player;
  start(startTime: string | number, offset?: string | number, duration?: string | number): Player;
  stop(offset?: string | number): Player;
  dispose(): void;
}

interface Volume extends AudioNode {
  volume: Signal;
}

interface VolumeConstructor {
  new(volume: number): Volume;
}

interface Panner3D extends AudioNode {
  setPosition(x: number, y: number, z: number): Panner3D;
}

interface Panner3DConstructor {
  new(positionX: number, positionY: number, positionZ: number): Panner3D;
}

interface IToneEvent<T> {
  callback: (time: number, value: T) => void;
  loop: boolean;
  loopEnd: number;
  loopStart: number;
  mute: boolean;
  playbackRate: number;
  probability: number;
  progress: number;
  state: string;
  dispose(): this;
  cancel(after?: string | number): this;
  start(startTime: string | number): this;
  stop(offset?: string | number): this;
}

interface ToneEventConstructor<T> {
  new(callback: (time: number, value: T) => void, value?: T): IToneEvent<T>;
}

interface IEmitter<EventTypes, FArgs> { // TODO no varaidic args, so this is too restrictive
  dispose(): this;
  emit(event: EventTypes, ...args: FArgs[]): this;
  off(event: EventTypes, callback?: (...args: FArgs[]) => void): this;
  on(event: EventTypes, callback: (...args: FArgs[]) => void): this;
}

interface Emitter<T> {
  new(): IEmitter<string, any>;
  mixin(obj: T): T & IEmitter<string, any>;
}