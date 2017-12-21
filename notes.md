# O Schedulo, Schedulo! Wherefore art thou Schedulo? 

### Background
Schedulo is intended to provide a simple api for dynamically scheduling and manipulating audio over time, and arose from a refactoring effort for dymo-core. dymo-core is concerned primarily with representing dynamic music compositions using hierarchical, semantic-web based, structures which are interpreted at some point in a program's execution as something which is audibly played, to-date using the Web Audio API graph. 

This mapping of structure onto audio graph happened in a relatively deep object graph within dymo-core, and when trying to make a new DJ app using dymo-core, it became apparent that debugging existing or adding new audio functionality was not particularly easy within the code-base, and that perhaps it would be easier to ensure all the audio processing desired could be achieved entirely seperately from the semantic web stuff which dymo-core concerns itself with. The ability to then parse some serialised linked-data representation of a dynamic composition could be achieved elsewhere and played back using the new seperate functionality (consumed as a library dependency). 

As a starting point, it was decided to use [Tone.js](https://tonejs.github.io) - a library providing a core set of abstractions on top of the Web Audio API for loading audio files, and scheduling them on a transport which uses the audio clock. There was an assumption here that because it is quite a well known and used library for building interactive music apps, that it must consist of a relatively solid and thought out implementation. This hasn't been fully confirmed. It is known that a web worker is used as part of the implementation of a scheduler - which implies some degree of performance optimisation having been undertaken. 

### Lifecycles
Based on practical experience which pre-dates schedulo, from Semantic Player experiments with mobile devices, it was decided to implement resource lifecycles on a timeline for managing allocation and cleanup of audio resources and audio graph management. The basic idea being that nodes should only be connected to the graph when they're actually contributing to the audible signal at that point in time, and that buffers should only be kept around when they're going to be used soon. There have been no performance measurements before or after to verify optimisations in these areas. 

A brief overview:
  - `ManagedAudioEvent` internally manages a `Tone.Player` connecting and disconnecting it to the underlying audio graph some user specified time before and after the event's `startTime` and `startTime + duration` respectively
  - Its lifecycle events are automatically repositioned on the timeline when changing the `startTime` and `duration` from outside
  - values / state for audio parameters, volume etc, are managed internally and forwarded to actually affect the underlying audio graph when things are connected up with the lifecycle events
  - `DynamicBufferingManagedAudioEvent` extends `ManagedAudioEvent` to additionally manage the lifecycle of the underlying buffer used by the `Tone.Player`, it currently only manages the loading of the buffer some user specified time before the event's `startTime`. Clean-up is intended to be managed through some other mechanism. This is a somewhat naive approach and it is very possible that the buffer will not be loaded by the time it is needed to play, currently is will silently fail, resulting in no sound.
  - `ManagedAudioEvent` instances implement a simple `EventEmitter` style interface, emitting `playing`, `stopped` and `scheduled` events, at times corresponding to the `startTime`, `startTime + duration` and `startTime - connectToGraph.countIn` respectively.  

### Project Structure and style
The project is pretty small (~1500 lines of code). Type definitions contribute some significant amount to this, so there isn't much functionality yet. 

Code is organised using ES6 modules, with names roughly corresponding to the core concern of the module. So `life-cycle.ts` aims to encapsulate data abstractions and operations on those concerning the managing of lifecycles described above, and as such contains the definitions and implementations of `ManagedAudioEvent`, `DynamicBufferingManagedAudioEvent`, as well as helper functions for creating objects of those types, e.g `setupTonePlayers` and `lazilySetupTonePlayers`. 

The entry point to the library is `index.ts`, which serves as the main barrel for exporting the public library api. `schedulo.ts` is where the implementation of the majority of the user-level api lives.

There is a mixing of functional and object-orientated paradigms within the code. There is also a bias towards strong typing, and most recently the use of typed objects as single parameters for functions over multiple arguments.

e.g:

```typescript
function example(first, second = "something") {}

interface ExampleArgs {
  first: string;
  second: string;
}

function exampleTyped({first, second = "something"}: ExampleArgs) {}
```

This style emerged from dealing legacy code-bases and making additions to libraries such as dymo-core, where some functions have many arguments with a great deal of them being optional. A single object parameter makes calling code much more explict and readable, and also makes dealing with optional parameters much easier. Adding parameters is also simpler, and re-ordering of parameters in the calling code isn't an issue. Optional properties can be encoded in the TypeScript defintions, but also can be set using destructuring assignment in the function definition (as per the example), which is a more defensive approach (the compiler will always complain when a property is missing, and you have to code it away to do anything different). 

### Development env
Unfortunately there is not an automated test suite, this grew out of initially experimenting with interactive behaviour of Tone.js in the browser directly and never properly formulating a way of verifying behaviour without having to push everything through the Web Audio graph with Tone.js. There exists some documented set of cases in `test.ts` which is intended to be run in a browser, it can be built using the npm script and for simplicity of serving files it can be useful to setup a local server: 
```sh
npm run build && php -S 127.0.0.1:8080
```
It just runs a single named function, there are many other cases within the file which are not automatically run.

