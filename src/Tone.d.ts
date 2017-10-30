type UntypedBodge = {[key: string]: any}
declare const ToneInstance: Tone & UntypedBodge;

declare module 'tone' {
  export = ToneInstance;
}

type Tone = {
  Time: TimeConstructor;
  TimeBase: TimeBaseConstructor;
  Transport: {
    seconds: number,
    loop: boolean,
    loopStart: number,
    loopEnd: number,
    bpm: { value: number },
    timeSignature: number | number[],
    nextSubdivision: (t: string | number) => number,
    start: (t: string) => void
  };
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