import { Audio, PositionalAudio, AudioListener, AudioLoader, Group } from "three";

const clamp = (value, fallback = 1) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const seconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;
const gestures = ["pointerdown", "touchend", "keydown"];

// Keep our own ramp endpoints: AudioParam.value is not the instantaneous value
// of an automation ramp on every browser. This also supports older Safari.
function ramp(param, target, duration, context, previous, initialValue = param.value) {
  const now = context.currentTime;
  const t = previous && previous.end > previous.start
    ? Math.max(0, Math.min(1, (now - previous.start) / (previous.end - previous.start))) : 1;
  const current = previous ? previous.from + (previous.to - previous.from) * t : initialValue;
  param.cancelScheduledValues(now);
  param.setValueAtTime(current, now);
  if (duration) param.linearRampToValueAtTime(target, now + duration);
  else param.setValueAtTime(target, now);
  return { from: current, to: target, start: now, end: now + duration };
}

class AudioVoice {
  constructor(manager, id, config, options, position) {
    this.manager = manager; this.id = id; this.config = config;
    this.channel = options.channel ?? config.channel ?? "sfx";
    this.loop = options.loop ?? config.loop ?? false;
    this.volume = clamp(options.volume, clamp(config.volume));
    const pitch = options.pitch ?? config.pitch ?? 1;
    const variationValue = options.pitchVariation ?? config.pitchVariation;
    const variation = Number.isFinite(variationValue) ? Math.max(0, variationValue) : 0;
    this.pitch = Math.max(.1, Math.min(4, (Number.isFinite(pitch) ? pitch : 1) + (Math.random() * 2 - 1) * variation));
    this.fade = seconds(options.fade);
    this.position = position ? { x: position.x, y: position.y, z: position.z } : null;
    this.options = options; this.sound = null; this.buffer = null;
    this.stopped = false; this.stopping = false; this.envelope = null;
    this.ready = new Promise(resolve => { this.resolveReady = resolve; });
  }
  stop(options = {}) { this.manager._stopVoice(this, seconds(options.fade)); }
  setVolume(value, { fade = 0 } = {}) {
    if (this.stopped || this.stopping) return;
    this.volume = clamp(value, this.volume);
    if (this.sound) this.envelope = ramp(this.sound.gain.gain, this.volume, seconds(fade), this.manager.context, this.envelope);
  }
  // World coordinates, copied immediately; callers may reuse their Vector3.
  setPosition(position) {
    if (!this.position || this.stopped) return;
    this.position.x = position.x; this.position.y = position.y; this.position.z = position.z;
    this.sound?.position.copy(position);
  }
}

/** One manager per game. Public playback calls return a cancellable voice or null. */
export class AudioManager {
  constructor({ camera, scene, sounds = {}, volumes = {}, maxVoices = 24,
    eventTarget = globalThis.window, documentTarget = globalThis.document,
    onError = message => console.warn(message) } = {}) {
    this.camera = camera; this.scene = scene; this.onError = onError;
    this.maxVoices = Number.isFinite(maxVoices) ? Math.max(2, Math.floor(maxVoices)) : 24;
    this.config = new Map(); this.buffers = new Map(); this.loads = new Map();
    this.voices = new Set(); this.reported = new Set(); this.buses = new Map();
    this.volumes = { master: clamp(volumes.master), music: clamp(volumes.music, .5), ambient: clamp(volumes.ambient, .6), sfx: clamp(volumes.sfx) };
    this.disposed = false; this.unlocked = false; this.music = null;
    this.eventTarget = eventTarget; this.documentTarget = documentTarget;
    this.root = new Group(); this.root.name = "World audio";
    scene?.add(this.root);
    for (const [id, config] of Object.entries(sounds)) this.register(id, config);
    // Audio is optional: an unavailable AudioContext must never stop gameplay.
    try {
      this.listener = new AudioListener(); this.context = this.listener.context;
      this.unlocked = this.context.state === "running";
      this.loader = new AudioLoader();
      this.setCamera(camera);
      this.listener.gain.gain.setValueAtTime(clamp(this.volumes.master), this.context.currentTime);
      for (const channel of ["music", "ambient", "sfx"]) {
        const node = this.context.createGain();
        node.gain.setValueAtTime(clamp(this.volumes[channel]), this.context.currentTime);
        node.connect(this.listener.getInput());
        this.buses.set(channel, { node, envelope: null });
      }
      this.silence = this.context.createBuffer(1, 1, this.context.sampleRate);
    } catch (error) { this.loader = null; this._report("init", `Audio unavailable: ${error.message}`); }
    this.gesture = () => { void this.unlock(); };
    this.visibility = () => {
      if (!this.context || this.disposed) return;
      if (documentTarget?.hidden) {
        Promise.resolve(this.context.suspend()).catch(() => {});
      } else if (this.unlocked) void this.unlock();
    };
    this.stateChange = () => {
      if (this.context.state === "running" && !documentTarget?.hidden) {
        this.unlocked = true;
        for (const voice of this.voices) this._tryStart(voice);
      }
    };
    // Passive capture does not consume the gesture needed by touch/game input.
    // Retain these after unlocking to recover from Safari interruptions.
    for (const type of gestures) eventTarget?.addEventListener(type, this.gesture, { capture: true, passive: true });
    eventTarget?.addEventListener("pageshow", this.visibility);
    documentTarget?.addEventListener("visibilitychange", this.visibility);
    this.context?.addEventListener("statechange", this.stateChange);
  }

  _report(key, message) {
    if (this.disposed || this.reported.has(key)) return;
    this.reported.add(key);
    try { this.onError(message); } catch { /* Diagnostics cannot break gameplay. */ }
  }

  register(id, config) {
    if (this.disposed) return;
    if (typeof config === "string") config = { url: config };
    const urls = config?.urls ?? [config?.url];
    if (!id || !urls.length || urls.some(url => typeof url !== "string" || !url)) throw new TypeError("A sound needs an ID and URL(s).");
    if (config.channel && !["sfx", "music", "ambient"].includes(config.channel)) throw new TypeError("Unknown audio channel");
    const maxInstances = Number.isFinite(config.maxInstances) ? Math.max(1, Math.floor(config.maxInstances)) : 4;
    this.config.set(id, { ...config, maxInstances, urls: urls.map(url => new URL(url, globalThis.location?.href ?? import.meta.url).href) });
    this.loads.delete(id); this.reported.delete(id);
  }

  setCamera(camera) {
    if (this.disposed) return;
    this.camera = camera;
    if (camera && this.listener) camera.add(this.listener); // add reparents the same listener.
    else this.listener?.removeFromParent();
  }

  async unlock() {
    if (this.disposed || !this.context || !this.loader || this.context.state === "closed" || this.documentTarget?.hidden) return false;
    try {
      if (this.context.state !== "running") {
        // Both calls happen synchronously inside the original trusted gesture.
        // Do not await a fetch or decode before resume() on iOS.
        const resumed = this.context.resume();
        if (!this.unlockSource) {
          const source = this.context.createBufferSource();
          this.unlockSource = source;
          source.buffer = this.silence; source.connect(this.context.destination);
          source.onended = () => { source.disconnect(); source.onended = null; if (this.unlockSource === source) this.unlockSource = null; };
          source.start(0);
        }
        await resumed;
      }
      if (this.disposed || this.context.state !== "running") return false;
      this.stateChange();
      return true;
    } catch { this._clearUnlockSource(); return false; } // Retry on the next gesture; never block input.
  }

  _clearUnlockSource() {
    const source = this.unlockSource;
    if (!source) return;
    source.onended = null;
    try { source.stop(); } catch { /* Already ended. */ }
    source.disconnect(); this.unlockSource = null;
  }

  load(id) {
    if (this.disposed || !this.loader) return Promise.resolve(null);
    if (this.loads.has(id)) return this.loads.get(id);
    const config = this.config.get(id);
    if (!config) { this._report(id, `Unknown sound: ${id}`); return Promise.resolve(null); }
    const promise = (async () => {
      for (const url of config.urls) {
        // Cache the promise, including failures, so concurrent voices/aliases
        // neither fetch nor decode twice and missing files never retry per frame.
        if (!this.buffers.has(url)) this.buffers.set(url, Promise.resolve().then(() => this.disposed ? null : this.loader.loadAsync(url)).catch(() => null));
        const buffer = await this.buffers.get(url);
        if (this.disposed) return null;
        if (buffer) return buffer;
      }
      this._report(id, `Could not load audio "${id}": ${config.urls.join(", ")}`);
      return null;
    })();
    this.loads.set(id, promise);
    return promise;
  }

  preload(ids = [...this.config.keys()]) { return Promise.all(ids.map(id => this.load(id))); }
  play(id, options = {}) { return this._play(id, options, null); }
  play3D(id, position, options = {}) {
    if (!position || ![position.x, position.y, position.z].every(Number.isFinite)) return null;
    return this._play(id, options, position);
  }
  playMusic(id, options = {}) {
    if (this.music?.id === id && !this.music.stopped && !this.music.stopping) return this.music;
    if (this.music && !this.music.sound) this.music.stop();
    const voice = this._play(id, { ...options, channel: "music", loop: options.loop ?? true }, null);
    if (voice) this.music = voice;
    return voice;
  }

  _play(id, options, position) {
    if (this.disposed || !this.loader || !this.listener) return null;
    const config = this.config.get(id);
    if (!config) { this._report(id, `Unknown sound: ${id}`); return null; }
    const channel = options.channel ?? config.channel ?? "sfx";
    if (!this.buses.has(channel)) return null;
    const loop = options.loop ?? config.loop ?? false;
    // Never build a backlog of attacks while locked or in the background.
    if (!loop && (this.context.state !== "running" || this.documentTarget?.hidden)) return null;
    let count = 0, oldest = null;
    for (const voice of this.voices) if (voice.id === id) {
      if (loop && !position && !voice.position && !voice.stopping) return voice;
      count++; if (!voice.loop && !oldest) oldest = voice;
    }
    if (count >= (config.maxInstances ?? 4)) {
      if (oldest) this._release(oldest); else return null;
    }
    if (this.voices.size >= this.maxVoices) {
      let victim = null;
      for (const voice of this.voices) if (!voice.loop && voice.channel === "sfx") { victim = voice; break; }
      if (!victim) return null;
      this._release(victim);
    }
    const voice = new AudioVoice(this, id, config, options, position);
    this.voices.add(voice);
    this.load(id).then(buffer => {
      if (voice.stopped) return;
      if (!buffer) { this._release(voice); return; }
      voice.buffer = buffer;
      if (!voice.loop && (this.context.state !== "running" || this.documentTarget?.hidden)) this._release(voice);
      else this._tryStart(voice);
    });
    return voice;
  }

  _tryStart(voice) {
    if (voice.stopped || voice.sound || !voice.buffer || this.context.state !== "running" || this.documentTarget?.hidden) return;
    try {
      const sound = voice.position ? new PositionalAudio(this.listener) : new Audio(this.listener);
      voice.sound = sound;
      sound.gain.disconnect(); sound.gain.connect(this.buses.get(voice.channel).node);
      sound.setBuffer(voice.buffer); sound.setLoop(voice.loop); sound.setPlaybackRate(voice.pitch);
      if (voice.position) {
        sound.position.copy(voice.position);
        const config = voice.config, options = voice.options;
        sound.setDistanceModel(options.distanceModel ?? config.distanceModel ?? "inverse");
        sound.setRefDistance(options.refDistance ?? config.refDistance ?? 4);
        sound.setMaxDistance(options.maxDistance ?? config.maxDistance ?? 120);
        sound.setRolloffFactor(options.rolloffFactor ?? config.rolloffFactor ?? 1);
        sound.panner.panningModel = options.panningModel ?? config.panningModel ?? "equalpower";
        this.root.add(sound);
        sound.updateMatrixWorld(true);
      }
      // Scheduling zero does not immediately change AudioParam.value in the
      // current render quantum. Supply the known start so fades cannot begin at 1.
      voice.envelope = ramp(sound.gain.gain, voice.volume, voice.fade, this.context, null, voice.fade ? 0 : voice.volume);
      sound.play();
      sound.source.onended = () => { sound.onEnded(); this._release(voice); };
      // Only crossfade after a replacement really starts. A missing track must
      // leave the current music audible. Bound rapid switches to two sources.
      if (voice.channel === "music") for (const other of this.voices) {
        if (other !== voice && other.channel === "music" && other.sound) {
          if (other.stopping) this._release(other);
          else this._stopVoice(other, voice.fade);
        }
      }
      voice.resolveReady(true);
    } catch (error) {
      this._report(voice.id, `Could not play audio "${voice.id}": ${error.message}`);
      this._release(voice);
    }
  }

  stop(id, { fade = 0 } = {}) {
    for (const voice of this.voices) if (voice.id === id) this._stopVoice(voice, seconds(fade));
  }
  _stopVoice(voice, fade) {
    if (voice.stopped) return;
    if (!voice.sound || !fade) { this._release(voice); return; }
    if (voice.stopping) return;
    voice.stopping = true;
    voice.envelope = ramp(voice.sound.gain.gain, 0, fade, this.context, voice.envelope);
    // Use the audio clock, not a timer that can fire while Safari is suspended.
    // Do not use THREE.Audio.stop(delay): it removes the onended cleanup hook.
    voice.sound.source.stop(this.context.currentTime + fade);
  }
  _release(voice) {
    if (voice.stopped) return;
    voice.stopped = true; this.voices.delete(voice);
    if (this.music === voice) this.music = null;
    const sound = voice.sound;
    if (sound) {
      if (sound.source) {
        sound.source.onended = null;
        try { sound.source.stop(); } catch { /* Already ended. */ }
        sound.source.disconnect();
      }
      sound.isPlaying = false;
      sound.panner?.disconnect(); sound.gain.disconnect(); sound.removeFromParent();
      sound.buffer = null; sound.source = null;
    }
    voice.sound = null; voice.buffer = null; voice.resolveReady(false);
  }

  setVolume(channel, value, { fade = .03 } = {}) {
    if (this.disposed || !Object.hasOwn(this.volumes, channel)) return;
    this.volumes[channel] = clamp(value, this.volumes[channel]);
    if (channel === "master" && this.listener) this.masterEnvelope = ramp(this.listener.gain.gain, this.volumes.master, seconds(fade), this.context, this.masterEnvelope);
    else {
      const bus = this.buses.get(channel);
      if (bus) bus.envelope = ramp(bus.node.gain, this.volumes[channel], seconds(fade), this.context, bus.envelope);
    }
  }
  getVolume(channel) { return this.volumes[channel]; }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const type of gestures) this.eventTarget?.removeEventListener(type, this.gesture, true);
    this.eventTarget?.removeEventListener("pageshow", this.visibility);
    this.documentTarget?.removeEventListener("visibilitychange", this.visibility);
    this.context?.removeEventListener("statechange", this.stateChange);
    this._clearUnlockSource();
    for (const voice of this.voices) this._release(voice);
    for (const bus of this.buses.values()) bus.node.disconnect();
    this.buses.clear(); this.buffers.clear(); this.loads.clear(); this.config.clear();
    this.root.removeFromParent(); this.listener?.removeFromParent();
    this.listener?.gain.disconnect(); this.listener?._timer?.dispose();
    this.silence = null;
    // Three shares its AudioContext with loaders/other users. Do not close it.
  }
}
