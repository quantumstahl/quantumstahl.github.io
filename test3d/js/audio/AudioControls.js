// Native sliders stay usable with touch, keyboard and screen readers.
export function attachAudioControls(audio, container) {
  if (!container) return () => {};
  const input = event => {
    const channel = event.target.dataset.audioVolume;
    if (channel) audio.setVolume(channel, Number(event.target.value));
  };
  for (const slider of container.querySelectorAll("[data-audio-volume]")) slider.value = audio.getVolume(slider.dataset.audioVolume);
  container.addEventListener("input", input);
  return () => container.removeEventListener("input", input);
}
