import { Audio, PositionalAudio, AudioListener, AudioLoader, Group } from "three";

const clamp = (value, fallback = 1) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const seconds = value => Number.isFinite(value) ? Math.max(0, value) : 0;
// Touch start can unlock some Safari versions; pointer-up/touch-end are the
// activation-bearing events for touch on others. All belong to the first tap.
// Safari may expose activation only after release capture, at native click.
// Retry there too; an earlier blocked resume can remain pending indefinitely.
const gestures = ["touchstart", "pointerdown", "pointerup", "touchend", "click", "keydown"];

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
    if (this.sound && !this.paused) this.envelope = ramp(this.sound.gain.gain, this.volume, seconds(fade), this.manager.context, this.envelope);
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
    onError = message => console.warn(message), onTrace = null } = {}) {
    this.camera = camera; this.scene = scene; this.onError = onError;
    this.onTrace = onTrace; this.resumeAttempts = 0; this.pendingResumes = 0;
    this.maxVoices = Number.isFinite(maxVoices) ? Math.max(2, Math.floor(maxVoices)) : 24;
    this.config = new Map(); this.buffers = new Map(); this.loads = new Map();
    this.voices = new Set(); this.reported = new Set(); this.buses = new Map();
    this.volumes = { master: clamp(volumes.master), music: clamp(volumes.music, .5), ambient: clamp(volumes.ambient, .6), sfx: clamp(volumes.sfx) };
    this.disposed = false; this.unlocked = false; this.music = null;
    this.backgrounded = !!documentTarget?.hidden; this.pageHidden = false;
    this.suspendTimer = null;
    this.initializationAttempted = false;
    this.activationStrategy = "cat-touchstart-suspend-resume";
    this.loader = new AudioLoader(); // Construction alone does not create a context.
    this.eventTarget = eventTarget; this.documentTarget = documentTarget;
    this.root = new Group(); this.root.name = "World audio";
    scene?.add(this.root);
    for (const [id, config] of Object.entries(sounds)) this.register(id, config);
    this.gesture = event => {
      this._trace("gesture", { event: event.type, trusted: event.isTrusted, pointerType: event.pointerType,
        pointerId: event.pointerId, touches: event.touches?.length, defaultPrevented: event.defaultPrevented,
        target: event.target?.id || event.target?.className?.baseVal || event.target?.className || event.target?.nodeName });
      if (documentTarget?.hidden || this.pageHidden) return;
      this.backgrounded = false; // A real interaction also recovers a missed focus event.
      void this.unlock(event.type); // resume() executes here, before any promise/await.
    };
    this.visibility = () => { this._trace("visibilitychange"); documentTarget?.hidden ? this._background() : this._foreground(); };
    this.blur = () => { this._trace("blur"); this._background(); };
    this.focus = () => { this._trace("focus"); this._foreground(); };
    this.pageHide = () => { this._trace("pagehide"); this.pageHidden = true; this._background(true); };
    this.pageShow = () => { this._trace("pageshow"); this.pageHidden = false; this._foreground(); };
    this.stateChange = event => {
      this._trace(event ? "context:statechange" : "output:reconcile");
      if (this.disposed || !this.loader || !this.outputGate) return;
      if (this.context.state === "running" && this._active()) {
        this.unlocked = true;
        for (const voice of this.voices) this._tryStart(voice);
        this._syncMusicElement();
        if (this.gateEnvelope.to !== 1) this.gateEnvelope = ramp(this.outputGate.gain, 1, .25, this.context, this.gateEnvelope);
      } else if (this.context.state === "running") {
        this._background(true); // A late resume must never unmute a hidden page.
      } else if (this.context.state === "suspended" || this.context.state === "interrupted") {
        this._silence(); // iOS can interrupt audio before visibilitychange fires.
      }
    };
    // Passive capture does not consume the gesture needed by touch/game input.
    // Retain these after unlocking to recover from Safari interruptions.
    for (const type of gestures) eventTarget?.addEventListener(type, this.gesture, { capture: true, passive: true });
    eventTarget?.addEventListener("blur", this.blur);
    eventTarget?.addEventListener("focus", this.focus);
    eventTarget?.addEventListener("pagehide", this.pageHide);
    eventTarget?.addEventListener("pageshow", this.pageShow);
    documentTarget?.addEventListener("visibilitychange", this.visibility);
    this._initialize("constructor");
    this._trace("init");
  }

  _initialize(reason) {
    if (this.initializationAttempted) return !!(this.context && this.loader && this.outputGate);
    if (this.disposed) return false;
    this.initializationAttempted = true;
    this._trace("context:create:attempt", { reason });
    // Reuse Three's shared context for the listener, decoding and all voices.
    try {
      this.listener = new AudioListener(); this.context = this.listener.context;
      this.unlocked = this.context.state === "running";
      this.setCamera(this.camera);
      this.listener.gain.gain.setValueAtTime(clamp(this.volumes.master), this.context.currentTime);
      this.outputGate = this.context.createGain();
      this.listener.gain.disconnect(); this.listener.gain.connect(this.outputGate);
      this.outputGate.connect(this.context.destination);
      const initial = this.unlocked && !this.backgrounded ? 1 : 0;
      this.gateEnvelope = ramp(this.outputGate.gain, initial, 0, this.context, null, initial);
      for (const channel of ["music", "ambient", "sfx"]) {
        const node = this.context.createGain();
        node.gain.setValueAtTime(clamp(this.volumes[channel]), this.context.currentTime);
        node.connect(this.listener.getInput());
        this.buses.set(channel, { node, envelope: null });
      }
      this.context.addEventListener("statechange", this.stateChange);
      this._trace("context:created", { reason });
      return true;
    } catch (error) {
      this.loader = null; this._report("init", `Audio unavailable: ${error.message}`);
      return false;
    }
  }

  _trace(type, details) {
    try { this.onTrace?.(type, details, this); } catch { /* Diagnostics cannot affect audio or input. */ }
  }

  _active() { return !this.backgrounded && !this.pageHidden && !this.documentTarget?.hidden; }

  _silence() {
    if (!this.context || !this.outputGate) return;
    this._trace("output:silence");
    this._syncMusicElement();
    this.gateEnvelope = ramp(this.outputGate.gain, 0, 0, this.context, this.gateEnvelope);
    for (const voice of this.voices) {
      if ((!voice.loop && !voice.options?.preserveOnPause) || voice.stopping) this._release(voice);
      else if (voice.sound?.isPlaying) {
        // Keep the same voice/Audio object and loop offset, but release its
        // single-use buffer source. No stale attack or outgoing fade is replayed.
        const sound = voice.sound;
        sound.pause(); sound.disconnect(); sound.source.disconnect(); sound.source = null;
        voice.paused = true;
      }
    }
  }

  _suspend() {
    this.suspendTimer = null;
    if (this.disposed || this._active() || !this.context) return;
    this._silence();
    if (this.context.state === "closed" || this.context.state === "suspended") return;
    try {
      this._trace("suspend:attempt");
      Promise.resolve(this.context.suspend()).then(() => {
        this._trace("suspend:resolved");
        // A queued native suspension may complete after the page has returned.
        if (!this.disposed && this._active() && this.unlocked) void this.unlock("late-suspend");
      }).catch(error => this._trace("suspend:rejected", { error: error.name, message: error.message }));
    } catch (error) { this._trace("suspend:rejected", { error: error.name, message: error.message }); }
  }

  _background(immediate = false) {
    if (this.disposed || !this.context || !this.outputGate) return;
    this.backgrounded = true;
    if (immediate || this.context.state !== "running") {
      clearTimeout(this.suspendTimer); this._suspend();
    } else if (this.suspendTimer === null) {
      // Allow a short output fade on blur/visibility changes. pagehide takes
      // the synchronous path because a frozen/BFCache page cannot run timers.
      this.gateEnvelope = ramp(this.outputGate.gain, 0, .02, this.context, this.gateEnvelope);
      for (const voice of this.voices) if ((!voice.loop && !voice.options?.preserveOnPause) || voice.stopping) this._release(voice);
      this.suspendTimer = setTimeout(() => this._suspend(), 40);
    }
  }

  _foreground() {
    if (this.disposed || this.pageHidden || this.documentTarget?.hidden) return;
    this.backgrounded = false;
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    if (this.unlocked) void this.unlock("foreground");
  }

  _report(key, message) {
    if (this.disposed || this.reported.has(key)) return;
    this.reported.add(key);
    this._trace("error", { key, message });
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

  async unlock(reason = "manual") {
    if (this.disposed || !this.loader || !this._active()) return false;
    if (!this._initialize(reason) || this.context.state === "closed") return false;
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    try {
      if (this.context.state !== "running") {
        // Match CatAdventure's working cold-start sequence. WebKit's suspend
        // path checks processingUserGestureForMedia, separately from resume's
        // activation check. Call both now, without awaiting suspend or resetting
        // an already-unlocked graph during normal lifecycle recovery.
        if (reason === "touchstart" && !this.unlocked && this.context.state === "suspended") {
          this._trace("unlock:suspend:attempt", { reason });
          try {
            Promise.resolve(this.context.suspend())
              .then(() => this._trace("unlock:suspend:resolved", { reason }))
              .catch(error => this._trace("unlock:suspend:rejected", { reason, error: error.name }));
          } catch (error) { this._trace("unlock:suspend:rejected", { reason, error: error.name }); }
        }
        // Must run synchronously in the original gesture for both suspended and
        // interrupted states. No direct-to-speaker warm-up buffers are needed.
        const attempt = ++this.resumeAttempts;
        this.pendingResumes++;
        this._trace("resume:attempt", { attempt, reason });
        try {
          await this.context.resume();
          this._trace("resume:resolved", { attempt, reason });
        } catch (error) {
          this._trace("resume:rejected", { attempt, reason, error: error.name, message: error.message });
          return false;
        } finally { this.pendingResumes--; }
      }
      if (this.disposed || !this._active() || this.context.state !== "running") return false;
      this.stateChange();
      return true;
    } catch { return false; } // Retry on the same tap's release or next gesture.
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
    if (!loop && (this.menuPaused || this.context?.state !== "running" || !this._active())) return null;
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
    this._trace("voice:queued", { id, channel, loop });
    this.load(id).then(buffer => {
      if (voice.stopped) return;
      if (!buffer) { this._release(voice); return; }
      voice.buffer = buffer;
      this._trace("voice:buffer", { id });
      if (!voice.loop && !voice.options.preserveOnPause && (this.menuPaused || this.context.state !== "running" || !this._active())) this._release(voice);
      else this._tryStart(voice);
    });
    return voice;
  }

  _tryStart(voice) {
    if (this.menuPaused || voice.stopped || (voice.sound && !voice.paused) || !voice.buffer || this.context?.state !== "running" || !this._active()) return;
    try {
      if (voice.paused) {
        const sound = voice.sound;
        voice.envelope = ramp(sound.gain.gain, voice.volume, .25, this.context, null, 0);
        sound.play();
        sound.source.onended = () => { sound.onEnded(); this._release(voice); };
        voice.paused = false;
        this._trace("voice:resumed", { id: voice.id });
        return;
      }
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
      this._trace("voice:started", { id: voice.id });
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
    if (!voice.sound || voice.paused || !fade) { this._release(voice); return; }
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
    this._syncMusicElement();
  }
  getVolume(channel) { return this.volumes[channel]; }

  // The verified legacy gesture handlers keep owning this element's unlock.
  // Route its one music stream through the existing buses, including on iOS
  // where HTMLMediaElement.volume itself does not support software volume.
  attachMusicElement(element, url) {
    this.musicElement = element;
    this.musicElementEnabled = true;
    if (url) element.src = url;
    try {
      this.musicElementSource = this.context.createMediaElementSource(element);
      // Only the legacy gameplay stream is faded. Music preferences, title
      // voices, nature ambience and SFX keep their existing buses and levels.
      this.musicElementGain = this.context.createGain?.();
      if (this.musicElementGain) {
        this.musicElementSource.connect(this.musicElementGain);
        this.musicElementGain.connect(this.buses.get('music').node);
      } else this.musicElementSource.connect(this.buses.get('music').node);
    } catch (error) { this._report("music-element", `Music volume routing unavailable: ${error.message}`); }
    this.musicElementPlay = () => { this.musicElementStarted = true; this._syncMusicElement(); };
    element.addEventListener("play", this.musicElementPlay);
    this._syncMusicElement();
  }
  setMusicElementEnabled(enabled, { fade = 0 } = {}) {
    this.musicElementEnabled = !!enabled;
    if (this.musicElementGain) this.musicElementEnvelope = ramp(this.musicElementGain.gain, enabled ? 1 : 0, seconds(fade), this.context, this.musicElementEnvelope);
    this._syncMusicElement();
  }
  updateMusicElement() { this._syncMusicElement(); }
  _syncMusicElement() {
    const element = this.musicElement;
    if (!element) return;
    const fading = this.musicElementEnvelope && this.context.currentTime < this.musicElementEnvelope.end;
    const stopped = this.musicElementEnabled === false && !fading;
    const blocked = !!this.menuPaused || !this._active() || stopped;
    element.muted = blocked || (!this.musicElementSource && this.volumes.master * this.volumes.music === 0);
    if (!this.musicElementSource) element.volume = this.volumes.master * this.volumes.music;
    if (blocked) element.pause();
    else if (this.musicElementStarted && element.paused) {
      try { element.play()?.catch(() => {}); } catch { /* Next verified gesture retries playback. */ }
    }
  }
  setMenuPaused(paused) {
    if (this.disposed || !!this.menuPaused === paused) return;
    this.menuPaused = paused;
    if (paused) {
      for (const voice of this.voices) {
        if ((!voice.loop && !voice.options?.preserveOnPause) || voice.stopping) this._release(voice);
        else if (voice.sound?.isPlaying) {
          const sound = voice.sound;
          sound.pause(); sound.disconnect(); sound.source.disconnect(); sound.source = null;
          voice.paused = true;
        }
      }
    } else for (const voice of this.voices) this._tryStart(voice);
    this._syncMusicElement();
    // Menu transitions never suspend, close, recreate or re-unlock the context.
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.musicElement?.removeEventListener("play", this.musicElementPlay);
    this.musicElement?.pause(); this.musicElementSource?.disconnect();
    this.musicElementGain?.disconnect();
    this._trace("dispose");
    for (const type of gestures) this.eventTarget?.removeEventListener(type, this.gesture, { capture: true });
    this.eventTarget?.removeEventListener("blur", this.blur);
    this.eventTarget?.removeEventListener("focus", this.focus);
    this.eventTarget?.removeEventListener("pagehide", this.pageHide);
    this.eventTarget?.removeEventListener("pageshow", this.pageShow);
    this.documentTarget?.removeEventListener("visibilitychange", this.visibility);
    this.context?.removeEventListener("statechange", this.stateChange);
    clearTimeout(this.suspendTimer); this.suspendTimer = null;
    for (const voice of this.voices) this._release(voice);
    for (const bus of this.buses.values()) bus.node.disconnect();
    this.buses.clear(); this.buffers.clear(); this.loads.clear(); this.config.clear();
    this.root.removeFromParent(); this.listener?.removeFromParent();
    this.listener?.gain.disconnect(); this.listener?._timer?.dispose();
    this.outputGate?.disconnect();
    // Three shares its AudioContext with loaders/other users. Do not close it.
  }
}
