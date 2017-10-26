declare const ToneInstance: Tone;

declare module 'tone' {
  export = ToneInstance;
}

type Tone = any;
