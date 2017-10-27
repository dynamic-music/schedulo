type UntypedBodge = {[key: string]: any}
declare const ToneInstance: Tone & UntypedBodge;

declare module 'tone' {
  export = ToneInstance;
}

type Tone = {
  Time: TimeConstructor;
  TimeBase: TimeBaseConstructor;
};

type BarsBeatsSixteenths = string;
type Notation = string;

interface TimeBase {
  add(val: Time, units?: string): TimeBase;
  clone(): TimeBase;
  dispose(): void;
  div(val: Time, units?: string): TimeBase;
  mult(val: Time, units?: string): TimeBase;
  set(exprString: string): TimeBase;
  sub(val: Time, units?: string): TimeBase;
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