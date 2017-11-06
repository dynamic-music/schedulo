import * as chai from 'chai';
import {
  calculateScheduleTimes,
  toBufferSegment,
  LoopToFit
} from '../src/looping';

/**
 * Generally loop segments at longest period
 * 
 * There are, however, options for how to handle the shorter loop "children"
 * 
 * no child looping
 * |.......|.......
 * |...    |...
 * 
 * loop children at individual periods to fit
 * |.......|.......
 * |...|...|...|...
 * 
 * possible "edge-case" handling: 
 * 
 * non integer-multiple children, trim last
 * |.........|.........
 * |..|..|..|..|..|..|.
 * 
 * non integer-multiple children, drop last
 * |.........|.........
 * |..|..|..|..|..|..
 */

describe('calculateScheduleTimes()', () => {
  it('calculates times for a single source', () => {
    const {times, duration} = calculateScheduleTimes(
      2,
      [
        toBufferSegment(
          {duration: 10},
          {offset: 2, duration: 5}
        )
      ]
    );
    chai.expect(duration).eql(2 * 5);
    chai.expect(times.length).eql(1);
    chai.expect(times[0].length).eql(2);
    chai.expect(times[0]).eql([
      {
        startTime: 0,
        stopTime: 5,
        offset: 2,
        duration: 5
      },
      {
        startTime: 5,
        stopTime: 10,
        offset: 2,
        duration: 5
      }
    ]);
  });

  it('can shift calculated times by a constant offset', () => {
    const {times, duration} = calculateScheduleTimes(
      2,
      [
        toBufferSegment(
          {duration: 10},
          {offset: 2, duration: 5}
        )
      ],
      {scheduleTimeOffset: 100}
    );
    chai.expect(times).eql([[
      {
        startTime: 100,
        stopTime: 105,
        offset: 2,
        duration: 5
      },
      {
        startTime: 105,
        stopTime: 110,
        offset: 2,
        duration: 5
      }
    ]]);
  });

  it('loops children at periods of largest source', () => {
    const {times, duration} = calculateScheduleTimes(
      3,
      [
        toBufferSegment({duration: 10}),
        toBufferSegment({duration: 5}),
        toBufferSegment({duration: 2.5})
      ]
    );
    chai.expect(duration).eql(30);
    chai.expect(times).eql([
      [
        {
          startTime: 0,
          stopTime: 10,
          offset: 0,
          duration: 10
        },
        {
          startTime: 10,
          stopTime: 20,
          offset: 0,
          duration: 10
        },
        {
          startTime: 20,
          stopTime: 30,
          offset: 0,
          duration: 10
        }
      ],
      [
        {
          startTime: 0,
          stopTime: 5,
          offset: 0,
          duration: 5
        },
        {
          startTime: 10,
          stopTime: 15,
          offset: 0,
          duration: 5
        },
        {
          startTime: 20,
          stopTime: 25,
          offset: 0,
          duration: 5
        }
      ],
      [
        {
          startTime: 0,
          stopTime: 2.5,
          offset: 0,
          duration: 2.5
        },
        {
          startTime: 10,
          stopTime: 12.5,
          offset: 0,
          duration: 2.5
        },
        {
          startTime: 20,
          stopTime: 22.5,
          offset: 0,
          duration: 2.5
        }
      ]
    ]);
  });

  it('loops children at individual periods to fit', () => {
    const segments = [
      toBufferSegment({duration: 10}),
      toBufferSegment({duration: 5}),
      toBufferSegment({duration: 2.5})
    ];
    const {times, duration} = calculateScheduleTimes(
      1,
      segments,
      {calculator: new LoopToFit(segments, 1)}
    );
    chai.expect(duration).eql(10);
    chai.expect(times.length).eql(3);
    chai.expect(times[0].length).eql(1);
    chai.expect(times[1].length).eql(2);
    chai.expect(times[2].length).eql(4);
    chai.expect(times).eql([
      [
        {
          startTime: 0,
          stopTime: 10,
          offset: 0,
          duration: 10
        }
      ],
      [
        {
          startTime: 0,
          stopTime: 5,
          offset: 0,
          duration: 5
        },
        {
          startTime: 5,
          stopTime: 10,
          offset: 0,
          duration: 5
        }
      ],
      [
        {
          startTime: 0,
          stopTime: 2.5,
          offset: 0,
          duration: 2.5
        },
        {
          startTime: 2.5,
          stopTime: 5.0,
          offset: 0,
          duration: 2.5
        },
        {
          startTime: 5.0,
          stopTime: 7.5,
          offset: 0,
          duration: 2.5
        },
        {
          startTime: 7.5,
          stopTime: 10,
          offset: 0,
          duration: 2.5
        }
      ]
    ]);
  });

  it('loops to fit, dropping last loop if longer than full period', () => {
    const segments = [
      toBufferSegment({duration: 4}),
      toBufferSegment({duration: 3})
    ];
    const {times, duration} = calculateScheduleTimes(
      2,
      segments,
      {calculator: new LoopToFit(segments, 2, 'drop')}
    );
    chai.expect(duration).eql(8);
    chai.expect(times).eql([
      [
        {
          startTime: 0,
          stopTime: 4,
          offset: 0,
          duration: 4
        },
        {
          startTime: 4,
          stopTime: 8,
          offset: 0,
          duration: 4
        },
      ],
      [
        {
          startTime: 0,
          stopTime: 3,
          offset: 0,
          duration: 3
        },
        {
          startTime: 3,
          stopTime: 6,
          offset: 0,
          duration: 3
        },
      ]
    ]);
  });

  it('loops to fit, trimming last loop if longer than full period', () => {
    const segments = [
      toBufferSegment({duration: 4}),
      toBufferSegment({duration: 3})
    ];
    const {times} = calculateScheduleTimes(
      2,
      segments,
      {calculator: new LoopToFit(segments, 2, 'trim')}
    );
    chai.expect(times).eql([
      [
        {
          startTime: 0,
          stopTime: 4,
          offset: 0,
          duration: 4
        },
        {
          startTime: 4,
          stopTime: 8,
          offset: 0,
          duration: 4
        },
      ],
      [
        {
          startTime: 0,
          stopTime: 3,
          offset: 0,
          duration: 3
        },
        {
          startTime: 3,
          stopTime: 6,
          offset: 0,
          duration: 3
        },
        {
          startTime: 6,
          stopTime: 8,
          offset: 0,
          duration: 2
        }
      ]
    ]);
  });
});

describe('toBufferSegment', () => {
  it('keeps segment within original buffer bounds', () => {
    chai.expect(toBufferSegment(
      {duration: 100},
      {offset: 80, duration: 30}
    )).eql({
      offset: 80,
      duration: 20,
      parent: {duration: 100}
    });
    chai.expect(toBufferSegment(
      {duration: 100},
      {offset: -80, duration: 30}
    )).eql({
      offset: 0,
      duration: 30,
      parent: {duration: 100}
    });
    chai.expect(toBufferSegment(
      {duration: 100},
      {offset: 10, duration: -30}
    )).eql({
      offset: 10,
      duration: 0,
      parent: {duration: 100}
    });
  });
});
