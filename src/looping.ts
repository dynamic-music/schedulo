export interface BufferInfo {
  duration: number;
}

export interface Segment {
  offset: number;
  duration: number;
}

export interface BufferSegment extends Segment {
  parent: BufferInfo;
}

export interface ScheduleTime extends Segment {
  startTime: number;
  stopTime: number;
}

export interface LoopSchedule {
  times: Array<ScheduleTime[]>;
  duration: number;
}

export function toBufferSegment(
  buffer: BufferInfo,
  desired: Segment = {
    offset: 0,
    duration: buffer.duration
  }
): BufferSegment {
  const constrain = (n: number, maxDuration = buffer.duration) => {
    if (n > maxDuration) return maxDuration;
    if (n < 0) return 0;
    return n;
  };
  const actualOffset = constrain(desired.offset);
  return {
    offset: actualOffset,
    duration: constrain(desired.duration, buffer.duration - actualOffset),
    parent: buffer
  };
}

export interface LoopCalculator {
  calculateRepeatCount(segment: Segment): number;
  calculateScheduleTime(t: number, segment: Segment): ScheduleTime;
}

export class SnapToBoundary implements LoopCalculator {
  private loopPeriod: number;
  private masterRepeatCount: number;

  constructor(segments: Segment[], masterRepeatCount: number) {
    this.loopPeriod = findMaxDuration(segments);
    this.masterRepeatCount = masterRepeatCount;
  }

  calculateRepeatCount(segment: Segment): number {
    return this.masterRepeatCount;
  }
  calculateScheduleTime(t: number, segment: Segment): ScheduleTime {
    const startTime = t * this.loopPeriod;
    return {
      startTime,
      stopTime: startTime + segment.duration,
      offset: segment.offset,
      duration: segment.duration
    };
  }
}

export type LastLoopMode = 'drop' | 'trim';
export class LoopToFit implements LoopCalculator {
  private loopPeriod: number;
  private mode: LastLoopMode;
  private totalDuration: number;

  constructor(
    segments: Segment[],
    masterRepeatCount: number,
    mode: LastLoopMode = 'trim'
  ) {
    this.loopPeriod = findMaxDuration(segments);
    this.totalDuration = this.loopPeriod * masterRepeatCount;
    this.mode = mode;
  }

  calculateRepeatCount(segment: Segment): number {
    switch (this.mode) {
      case 'drop':
        return Math.floor(this.totalDuration / segment.duration);
      case 'trim':
        return Math.ceil(this.totalDuration / segment.duration);
    }
  }
  calculateScheduleTime(t: number, segment: Segment): ScheduleTime {
    const startTime = t * segment.duration;
    const stopTime = startTime + segment.duration;
    switch (this.mode) {
      case 'drop':
        return {
          startTime,
          stopTime,
          offset: segment.offset,
          duration: segment.duration
        };
      case 'trim':
        const trimmedStopTime = stopTime < this.totalDuration ? 
          stopTime :
          this.totalDuration;
        return {
          startTime,
          stopTime: trimmedStopTime,
          offset: segment.offset,
          duration: trimmedStopTime - startTime
        };
    }
  }
}

export const findMaxDuration = (segments: Segment[]) => segments.reduce(
  (max, {duration}) => Math.max(max, duration),
  0
);

export interface LoopCalculationOptions {
  scheduleTimeOffset?: number;
  calculator?: LoopCalculator;
}

export function calculateScheduleTimes(
  nRepeats: number,
  segments: Segment[],
  {
    scheduleTimeOffset = 0,
    calculator = new SnapToBoundary(segments, nRepeats)
  }: LoopCalculationOptions = {}
): LoopSchedule {
  const nSegments = segments.length;
  const times = new Array<ScheduleTime[]>(nSegments);
  for (let n = 0; n < nSegments; ++n) {
    const segment = segments[n];
    const nRepeatsForSegment = calculator.calculateRepeatCount(
      segment
    );
    const repeats = new Array<ScheduleTime>(nRepeatsForSegment);
    for (let t = 0; t < nRepeatsForSegment; ++t) {
      const {
        startTime,
        stopTime,
        ...others
      } = calculator.calculateScheduleTime(t, segment);
      repeats[t] = {
        ...others,
        startTime: startTime + scheduleTimeOffset,
        stopTime: stopTime + scheduleTimeOffset
      };
    }
    times[n] = repeats;
  }
  return {
    times,
    duration: nRepeats * findMaxDuration(segments)
  };
}