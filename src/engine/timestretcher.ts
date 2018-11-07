import { SoundTouch, SimpleFilter } from 'soundtouch-js';

/**
 * Offers some audio processing functions such as time stretching.
 */
export class TimeStretcher {

  private readonly BUFFER_SIZE = 1024;
  private readonly TIMESTRETCH_BUFFER_ZONE = 0.3; //seconds

  constructor(private audioContext: AudioContext, private fadeLength: number) {}

  getStretchedTrimmedBuffer(buffer: AudioBuffer, stretchRatio: number, offset: number, duration: number) {
    //trim if buffer too long
    if ((offset && offset != 0) || (duration && duration < buffer.duration)) {
      if (stretchRatio != 1) {
        //get too much cause of shitty timestretch algorithm
        duration += this.TIMESTRETCH_BUFFER_ZONE;
      } else {
        //add time for fade after source officially done
        duration += this.fadeLength;
      }
      buffer = this.getSubBuffer(buffer, this.toSamples(offset, buffer), this.toSamples(duration, buffer));
    }
    return this.getStretchedBuffer(buffer, duration, stretchRatio);
  }

  private getStretchedBuffer(buffer: AudioBuffer, duration: number, stretchRatio: number) {
    if (stretchRatio && stretchRatio != 1) {
      buffer = this.soundTouchTimeStretch(buffer, stretchRatio);
      if (duration) {
        //trim it down again
        var shouldBeDuration = duration/stretchRatio;
        //add time for fade after source officially done
        buffer = this.getSubBuffer(buffer, 0, this.toSamples(shouldBeDuration+this.fadeLength, buffer));
      }
    }
    return buffer;
  }

  private getSubBuffer(buffer: AudioBuffer, fromSample: number, durationInSamples: number) {
    //console.log(buffer, buffer.numberOfChannels, buffer.length, fromSample, durationInSamples, buffer.sampleRate)
    var samplesToCopy = Math.min(buffer.length-fromSample, durationInSamples);
    var subBuffer = this.audioContext.createBuffer(buffer.numberOfChannels, samplesToCopy, buffer.sampleRate);
    for (var i = 0; i < buffer.numberOfChannels; i++) {
      var currentCopyChannel = subBuffer.getChannelData(i);
      var currentOriginalChannel = buffer.getChannelData(i);
      for (var j = 0; j < samplesToCopy; j++) {
        currentCopyChannel[j] = currentOriginalChannel[fromSample+j];
      }
    }
    return subBuffer;
  }

  private soundTouchTimeStretch(buffer, ratio) {
    var soundTouch = new SoundTouch(buffer.sampleRate);
    soundTouch.tempo = ratio;
    var source = this.createSource(buffer);
    var filter = new SimpleFilter(source, soundTouch);
    var result = this.audioContext.createBuffer(buffer.numberOfChannels, buffer.length*(1/ratio), buffer.sampleRate);
    this.calculateStretched(buffer, result, filter);
    return result;
  }

  private createSource(buffer) {
    return {
      extract: function (target, numFrames, position) {
        var channels = [];
        for (var i = 0; i < buffer.numberOfChannels; i++) {
          channels.push(buffer.getChannelData(i));
        }
        for (var i = 0; i < numFrames; i++) {
          for (var j = 0; j < channels.length; j++) {
            target[i * channels.length + (j % channels.length)] = channels[j][i + position];
          }
        }
        return Math.min(numFrames, channels[0].length - position);
      }
    };
  }

  private calculateStretched(buffer, target, filter) {
    var channels = [];
    for (var i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(target.getChannelData(i));
    }
    var samples = new Float32Array(this.BUFFER_SIZE * 2);
    var framesExtracted = filter.extract(samples, this.BUFFER_SIZE);
    var totalFramesExtracted = 0;
    while (framesExtracted) {
      for (var i = 0; i < framesExtracted; i++) {
        for (var j = 0; j < channels.length; j++) {
          channels[j][i + totalFramesExtracted] = samples[i * channels.length + (j % channels.length)];
        }
      }
      totalFramesExtracted += framesExtracted;
      framesExtracted = filter.extract(samples, this.BUFFER_SIZE);
    }
    return channels;
  }

  private toSamples(seconds: number, buffer: AudioBuffer) {
    if (seconds || seconds == 0) {
      return Math.round(seconds*buffer.sampleRate);
    }
  }

}