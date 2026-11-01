// Opt-in diagnostics only. No AudioContext, playback, resume retries or input
// cancellation live here. AudioManager's existing handlers report their work.
export function createAudioDiagnostics({ eventTarget = window, documentTarget = document, capacity = 512 } = {}) {
  const entries = [], started = performance.now();
  let audio = null, input = null, timer = null, panel = null, output = null, dropped = 0;
  const cleanup = [];
  function snapshot() {
    const activation = eventTarget.navigator?.userActivation;
    return {
      state: audio?.context?.state ?? "unavailable",
      audioTime: audio?.context?.currentTime ?? null,
      unlocked: audio?.unlocked ?? false, pendingResumes: audio?.pendingResumes ?? 0,
      hidden: !!documentTarget.hidden, focused: documentTarget.hasFocus?.() ?? null,
      backgrounded: audio?.backgrounded ?? null, pageHidden: audio?.pageHidden ?? null,
      activation: activation ? { active: activation.isActive, everActive: activation.hasBeenActive } : null,
      gate: audio?.outputGate?.gain.value ?? null, gateTarget: audio?.gateEnvelope?.to ?? null,
      volumes: audio ? { ...audio.volumes } : null,
      voices: audio ? [...audio.voices].map(v => ({ id: v.id, channel: v.channel, loop: v.loop,
        loaded: !!v.buffer, playing: !!v.sound?.isPlaying, paused: !!v.paused,
        stopping: v.stopping, volume: v.volume, gain: v.sound?.gain.gain.value ?? null })) : [],
      input: input ? { gamepadConnected: input.gamepadConnected, moveX: input.moveX, moveZ: input.moveZ,
        touchEnabled: !!input.touch?.enabled, joystickHeld: input.touch?.joystick.pointerId != null,
        joystickPower: input.touch?.joystick.vector.power ?? 0,
        padAxes: input.gamepad ? Array.from(input.gamepad.axes) : [],
        padButtons: input.gamepad ? Array.from(input.gamepad.buttons, b => b.pressed) : [] } : null,
    };
  }
  function record(type, details = {}, manager = null) {
    if (manager) audio = manager;
    entries.push({ ms: Math.round(performance.now() - started), type, ...details, ...snapshot() });
    if (entries.length > capacity) { entries.shift(); dropped++; }
    if (output) output.textContent = entries.slice(-5).map(e => `${e.ms} ${e.type}${e.event ? ` ${e.event}` : ""}: ${e.state}, gate ${e.gateTarget}, resumes ${e.pendingResumes}`).join("\n");
  }
  function report() {
    return { version: 1, activationStrategy: audio?.activationStrategy ?? "reference", capturedAt: new Date().toISOString(), userAgent: eventTarget.navigator?.userAgent,
      platform: eventTarget.navigator?.platform, maxTouchPoints: eventTarget.navigator?.maxTouchPoints,
      dropped, current: snapshot(), entries: entries.slice() };
  }
  function listen(type) {
    // These are additional diagnostic event types, not duplicate unlock handlers.
    // One move per 100ms is sufficient to correlate a drag with pointer capture.
    let lastMove = -Infinity;
    const listener = event => {
      if (type.endsWith("move") && performance.now() - lastMove < 100) return;
      lastMove = performance.now();
      record("input:event", { event: type, trusted: event.isTrusted, pointerType: event.pointerType,
        defaultPrevented: event.defaultPrevented, pointerId: event.pointerId,
        target: event.target?.className?.baseVal ?? event.target?.className ?? event.target?.nodeName });
    };
    // Bubble observes defaultPrevented after gameplay has handled the event.
    eventTarget.addEventListener(type, listener, { passive: true });
    cleanup.push(() => eventTarget.removeEventListener(type, listener));
  }
  function attach(manager, container = documentTarget.querySelector("#audioControls")) {
    audio = manager;
    if (timer !== null) return;
    for (const type of ["pointermove", "touchmove", "pointercancel", "touchcancel", "gotpointercapture", "lostpointercapture", "contextmenu", "gamepadconnected", "gamepaddisconnected"]) listen(type);
    // AudioManager reports gestures from its existing capture handler; these
    // samples also capture the resulting input and output state after dispatch.
    timer = setInterval(() => record("sample"), 500);
    if (container) {
      panel = documentTarget.createElement("div");
      const label = documentTarget.createElement("p"); label.textContent = "Audio trace (device test)";
      output = documentTarget.createElement("pre"); output.style.cssText = "max-width:300px;white-space:pre-wrap;font:10px monospace;user-select:text";
      const status = documentTarget.createElement("p");
      const button = (text, action) => {
        const element = documentTarget.createElement("button"); element.type = "button"; element.textContent = text;
        element.addEventListener("click", action); panel.append(element);
      };
      panel.append(label, output);
      button("Sound audible", () => record("observation", { heard: true }));
      button("Sound silent", () => record("observation", { heard: false }));
      button("Copy trace", async () => {
        try { await eventTarget.navigator.clipboard.writeText(JSON.stringify(report(), null, 2)); status.textContent = "Trace copied."; }
        catch { status.textContent = "Use Save trace if clipboard access is unavailable."; }
      });
      button("Save trace", () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report(), null, 2)], { type: "application/json" }));
        const link = documentTarget.createElement("a"); link.href = url; link.download = "maxworld-audio-trace.json";
        panel.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      panel.append(status); container.append(panel);
    }
    record("diagnostics:attached");
  }
  return { record, report, attach, snapshot, setInput: value => { input = value; },
    dispose() { clearInterval(timer); timer = null; for (const remove of cleanup.splice(0)) remove(); panel?.remove(); panel = output = null; },
  };
}
