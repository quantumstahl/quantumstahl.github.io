const sfx = name => new URL(`../../sounds/SFX/${name}`, import.meta.url).href;

// Add one entry, then call audio.play(id) from any gameplay/trigger code.
// MP3/WAV fallbacks are decoded only if the browser cannot decode Opus.
export const SOUND_CONFIG = {
  claw: { urls: [sfx("swipe1.opus"), sfx("swipe1.wav")], volume: .65, pitchVariation: .08, maxInstances: 4 },
  crate_break: { urls: [sfx("cratebreaking.opus"), sfx("cratebreaking.wav")], volume: .8, maxInstances: 4 },
  birds: { urls: [sfx("woodlandbirds.opus"), sfx("woodlandbirds.wav")], channel: "ambient", loop: true, volume: .5 },
  crickets: { urls: [sfx("cricket.opus"), sfx("cricket.wav")], channel: "ambient", loop: true, volume: .4 },
  // Synthetic placeholder is a sustained tonal drone that masks the recordings.
  // Keep it registered for explicit playback; opt in after replacing the asset.
  wind: { url: sfx("wind.wav"), channel: "ambient", loop: true, volume: 0 },
  exploration: { url: new URL("../../sounds/music/mountain.mp3", import.meta.url).href, channel: "music", loop: true, volume: .5 },
};
