# MaxWorld audio

`js/main.js` owns one `AudioManager`. It attaches one Three.js `AudioListener` to
the existing camera shared by fly mode and both cat camera controllers. The
editor does not create an audio manager. Pass this instance to future gameplay,
trigger and cutscene code rather than constructing another manager or listener.

## Adding a sound

Add an entry to `js/audio/SoundConfig.js` and put the file under `sounds/`:

```js
waterfall: {
  url: new URL("../../sounds/SFX/waterfall.mp3", import.meta.url).href,
  channel: "ambient", loop: true, volume: .6,
  refDistance: 6, maxDistance: 120, rolloffFactor: 1,
},
```

The waterfall example requires supplying that recording; the six IDs already
bundled are `claw`, `crate_break`, `birds`, `crickets`, `wind`, and `exploration`.
For runtime registration, use `audio.register("door", "sounds/door.mp3")` or pass
the same configuration object. Plain paths resolve relative to the document URL.
`urls: [preferredURL, fallbackURL]` tries each format in order. `url` is shorthand
for a single URL. Registration can replace an ID; existing voices keep their
original settings and buffer.

## Playback API

```js
audio.play("claw");
audio.play("crate_break", { volume: .8, pitch: 1.1 });
const waterfall = audio.play3D("waterfall", position, { loop: true, volume: .6 });
audio.playMusic("exploration", { fade: 2 });
audio.stop("exploration", { fade: 2 });
```

`play`, `play3D`, and `playMusic` return a voice handle immediately, or `null` if
audio is unavailable, the ID is unknown, an effect is blocked before unlock, or
the voice budget cannot admit it. Playback loads asynchronously. A handle has:

```js
const voice = audio.play("claw");
if (voice) {
  const started = await voice.ready; // true on start; false on load failure/cancellation
  voice.setVolume(.4, { fade: .5 });
  voice.stop({ fade: .2 });
}
waterfall?.setPosition(position); // Copies a world-space { x, y, z } / Vector3
```

Stopping before loading/unlocking cancels playback. `stop(id)` stops **all**
voices for that ID, including pending voices; a handle stops only its own voice.
A stop without a fade immediately ends an existing fade. A settled `ready`
promise describes whether playback started, not whether it has since ended.
`voice.stopped` reports final cleanup.

| Option | Default / meaning |
| --- | --- |
| `volume` | Configuration value or `1`; clamped to `0..1` |
| `pitch` | Configuration value or `1`; playback-rate multiplier, clamped to `.1..4`; also changes duration |
| `pitchVariation` | Configuration value or `0`; random additive range, e.g. `.08` gives roughly `.92..1.08` at pitch `1` |
| `loop` | Configuration value or `false`; `playMusic` defaults to `true` |
| `fade` | `0`; fade-in/crossfade/stop duration in seconds |
| `channel` | Configuration value or `"sfx"`; `playMusic` selects `"music"` |
| `refDistance` | `4` world units; positional attenuation reference distance |
| `maxDistance` | `120` world units; distance-model parameter, not an automatic source cull |
| `rolloffFactor` | `1`; attenuation strength |
| `distanceModel` | `"inverse"`; also accepts `"linear"` and `"exponential"` |
| `panningModel` | `"equalpower"` for mobile cost; optionally `"HRTF"` |

All options except `fade` can be defaults in the sound configuration.
`maxInstances` is a registration-only setting (default `4`) that bounds voices
per ID, including pending loads and outgoing fades. Non-positional loops reuse
their active handle when requested again. Positional loops can have multiple
emitters, each with its own handle.

Repeated `playMusic` calls for the requested ID reuse its voice. Switching IDs
loads the replacement first, then fades it in while fading the old music out.
Failed replacements leave existing music audible. A newer request cancels an
older pending music request; rapid switches retire older outgoing fades to keep
at most two playing music sources after each switch.

## Mixer and lifecycle

```js
audio.setVolume("master", .8);
audio.setVolume("music", .3, { fade: 1 });
audio.setVolume("ambient", .5);
audio.setVolume("sfx", 1);
audio.getVolume("music"); // Target value, including while fading
audio.setCamera(nextCamera); // Reparents the same listener
await audio.preload(["claw", "crate_break"]);
// audio.load(id) resolves an AudioBuffer or null; preload() defaults to all IDs.
audio.dispose(); // Idempotent; cancels pending playback and removes all nodes/listeners
```

Native sliders in the game's **Audio** menu control all four gain buses.
Defaults are master `1`, music `.5`, ambient `.6`, and SFX `1`. Mixer settings
are session-local. Effective volume is voice × channel × master. The constructor
accepts `{ scene, camera, sounds, volumes, maxVoices, onError }`. Its default
global budget is 24 voices. At capacity it retires the oldest one-shot SFX;
protected loops are never stolen. A saturated budget of loops rejects new
voices. Spatial emitters are children of an identity-transform group in the
scene; `setPosition` always takes world coordinates.

Buffers and in-flight promises are cached by resolved URL across IDs. Playback
creates independent, bounded Three.js `Audio`/`PositionalAudio` voices so effects
can overlap; Web Audio buffer sources are inherently single-use. Natural ends
and stops disconnect sources, panners and gains. No manager frame update is
needed. Fades use audio-clock automation and scheduled source stops, so tab
suspension cannot make a wall-clock cleanup timer cut a fade short.
New voice fades supply their starting gain explicitly; they do not read back a
just-scheduled native AudioParam value, which can still report its default.

Missing files and decode/playback failures resolve safely and report through
`onError(message)` once per ID (default: `console.warn`). Failed URLs are also
cached for the manager lifetime; reload the session to retry the same failed URL.
Already issued Three.js loader requests may finish after disposal, but cannot
create sources or repopulate the manager's caches. Disposal releases decoded
buffer references and leaves Three.js's shared AudioContext open.

## Gameplay example and ambience

The working example is integrated in `js/main.js`: `combatAudio.clawSound` calls
`audio.play("claw")` once per actual `ClawCombo` swing, including buffered combo
swings. The existing destruction callback plays `crate_break` at the destroyed
target's position. The same example starts `exploration` music with a two-second
fade. Existing combat callbacks remain independent of the audio implementation.

`DayNightAudio.update(delta, environment.uniforms.uDaylight.value)` follows the
environment's existing eased solar/twilight curve. Birds fade toward the day
level and crickets toward the night level. The synthetic wind placeholder is
muted by default because its sustained tones mask both recordings; replace it
with a natural wind recording before opting in through its configured volume.
The wind ID remains available for explicit playback. Levels come from
`SoundConfig.js`. Updates reconcile at 4 Hz and quantize gains to avoid new work
every frame. Silent day/night loops stop rather than consuming permanent voices;
twilight overlaps them. Dispose this adapter before disposing the manager.

## Browser unlock and formats

Passive capture listeners call `resume()` and play a one-sample silent buffer
within the first pointer, touch-end, or keyboard gesture. They do not cancel input
or pause gameplay. Music/ambient loops may be requested before unlock and wait;
locked one-shots are dropped to avoid playing a backlog of attacks later. A
gamepad-only session may need one initial tap/key press to grant browser audio
permission. `audio.unlock()` is available for a host's own gesture handler.

Visibility changes suspend audio in the background and attempt resuming after
return. Gesture listeners remain installed for subsequent iOS interruptions;
failed resume attempts do not block gameplay and retry at the next gesture.
Hardware mute, OS audio routing, and Safari/PWA engine bugs still require device
testing; software cannot guarantee recovery from every OS interruption. See the
[WebKit PWA interruption report](https://bugs.webkit.org/show_bug.cgi?id=291892)
and [Three.js positional audio API](https://threejs.org/docs/pages/PositionalAudio.html).

The existing Opus recordings have mono 22.05 kHz PCM WAV fallbacks for browsers
that cannot decode that container. Music already uses MP3. `wind.wav` is a
deterministic eight-second synthesized seamless loop. Regenerate these files
with `node tests/run-audio-browser.mjs --prepare-assets`; the original recordings
are unchanged. WAV fallbacks add about 3.1 MiB on disk and load only if needed.

## Verification

From `MaxWorld` (Node 24 and local Chrome, with `CHROME_PATH` override supported):

```powershell
node --test --experimental-test-isolation=none tests/*.test.mjs
node tests/run-audio-browser.mjs
node tests/run-audio-browser.mjs --ambient
```

Node tests use the real Three.js audio classes with a small deterministic Web
Audio double to cover caching, overlap, failed resume/retry, pending cancellation,
missing assets/fallbacks, source budgets, crossfade races, listener reparenting,
mixer independence, day/night transitions and swing callbacks. Browser checks use
real decoding, gains, panners, source end events, and a trusted CDP pointer gesture
under an autoplay policy requiring user activation. Results are saved to
`tests/audio-browser-results.json`. The ambient diagnostic compares Opus/WAV
signals, isolates each source, measures gains/peaks, and checks day/night source
counts; its results are in `tests/ambient-audio-browser-results.json`. For manual
A/B listening, open `tests/ambient-audio-browser.html` and use Native/Three.js
playback with birds, crickets, or the synthetic wind selected. The browser page can also be opened manually
at `tests/audio-browser.html` and started with its button.

On Safari/iOS and an installed PWA, manually check: first-touch movement/claw
still works while unlocking; all sounds decode; volume sliders work; birds switch
to crickets at night; lock/unlock and background/foreground resume on return or
the next tap; navigation away releases playback. Chromium automation cannot
validate iOS hardware behavior.
