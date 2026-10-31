# CatAdventure and the Golden Yarn – Game Design

> Living document. Keep it short. Details for individual quests belong in separate files.

## 1. Core

**A little cat who doesn't just defeat evil, but helps a world that is slowly changing.**

- **Genre:** 3D open-world adventure (N64+ style), easy to moderately challenging
- **Platform:** web (WebGL 2), mobile first, also desktop
- **Controls:** gamepad and touch
- **Goal:** playable release within roughly one year

## 2. Design Principles

1. **Fairytale-like and charming, not too dark.** The Spider King creates tension, but the world stays warm, colorful and hopeful.
2. **Moderately challenging.** Players sometimes need to think and practice, but rarely get stuck for long.
3. **Story leads to gameplay.** Exploration, dialogue and mysteries build up to confrontations.
4. **Variety over repetition.** Mix combat, platforming, puzzles, exploration and surprises.
5. **Respect the player's time.** Clear goals, generous checkpoints, no mandatory backtracking.
6. **Reward curiosity.** Secrets, hats, hearts and side quests, but the main story can be finished without them.
7. **Create memorable moments.** Every region has at least one surprise of its own.
8. **Fun before beautiful.** Playable with placeholders first, graphics later.

**Tone:** gentle humor and warmth ("Not yet, anyway").

**Measurable goals (proposal):**
- A hint appears if the player is stuck for 2–3 minutes
- Never more than 1–2 minutes of lost progress on death
- 60 FPS on a modern iPhone

## 3. Controls and Abilities

| Ability | Description |
|---|---|
| Walk / run | 3 m/s / 6 m/s |
| Jump | Platforming and obstacles |
| Claw combo | Left paw → right paw → pounce. Also works on objects (crates, vines) |
| Interact | Context button: talk, pick up, climb |
| Camera | Follows behind the cat, avoids walls, optional manual control |

- **Touch:** floating joystick on the left, drag for camera on the right, buttons for jump and claw.
- **Gamepad:** two sticks, more buttons, no UI covering the screen.

## 4. The World

5 × 5 km, one continuous open world. Zone names are working titles.

| Zone | Location | Thread theme | Surprise |
|---|---|---|---|
| Starting mountain | South | – (tutorial) | The view from the cliff |
| Fox Meadow | Center, hub | Suspicion, envy | _open_ |
| Sunscorch Valley (desert) | West | Greed | _open_ |
| Frostpeak Mountains (snow) | North | Coldness, loneliness | _open_ |
| Shadowlands | East | Fear | The Spider King's throne room |

**Approximate travel times (running, straight line):** Start → Fox Meadow ~3 min. Fox Meadow → each zone ~5–6 min.

### Starting mountain (tutorial)
Small, tight and enclosed. The player shouldn't realize the world is open until the cliff.

1. Wake up and walk
2. Crates as obstacles (claw on objects)
3. Simple platforming
4. Bridge or log as a simple puzzle
5. First spider (the combo)
6. Dark cave
7. The cliff: view, title scene, the owl

## 5. Story Summary

The golden thread, **the Golden Yarn**, binds together the paths of tomorrow. **The Spider King** in the Shadowlands wants to weave every future to his own will. His **dark threads** turn inhabitants evil or amplify their worst traits. A little cat, who knows nothing of kings or magic, sets out to help the world.

**Characters**
- **The cat:** protagonist
- **The owl:** meets the cat at the cliff, gives the first goal and a warning
- **The fox:** in Fox Meadow, the next step in the story
- **The Spider King:** final boss

### Intro (narration, ~60 s)
> Once upon a time, when the world was still young, there existed a golden thread.
> Not an ordinary thread, but one that bound together the countless paths of tomorrow.
> It was known as…
> the Golden Yarn.
> For ages, it lay hidden, untouched by those who wished to bend fate to their will.
> But far beyond the mountains, in the Shadowlands, a dark king had begun to stir.
> The Spider King, master of a thousand webs, dreamed of weaving every future into one of his own making.
> And so, as shadows slowly crept across the land, an unlikely hero was about to begin a most extraordinary journey.
> A little cat…
> who knew nothing of kings, ancient magic, or the fate of the world.
> Not yet, anyway.

| Time | Scene |
|---|---|
| 0–9 s | A golden thread emerges from the darkness |
| 9–17 s | The camera follows the threads to the ball of yarn |
| 17–25 s | The ball of yarn hidden in an ancient shrine |
| 25–34 s | The volcano and the Spider King's realm |
| 34–43 s | The Spider King's silhouette and spreading webs |
| 43–51 s | Shadows moving over Fox Meadow |
| 51–59 s | The cat sleeps, wakes up and stretches |

### The cliff
The cat comes out of the cave → the camera reveals the world → the title **CatAdventure and the Golden Yarn** → the camera returns to the cat → wingbeats, the owl lands.

> [softly] Ah… there you are, little one.
> [thoughtful] Something is changing. Even the wind seems to know.
> [pause] There's a fox in the meadow below. You should speak with him.
> [whispers] And one more thing…
> [slowly] Be careful which threads you follow.

### The Spider King
Mysterious, but not anonymous. Present throughout the game, seen up close only at the end. Theatrical and a little vain rather than terrifying.

| Stage | How he appears |
|---|---|
| Early game | Only traces: dark threads, webs over old places, inhabitants who speak of him with fear |
| Mid game | Glimpses: silhouette against the volcano, eyes in the dark, his voice through a corrupted character |
| The castle | Climbs around in his webs in the background (silhouette, no details), short lines as the cat advances |
| Throne room | First close-up, boss fight |

**Castle arc** (follows his four expressions):
1. **Confident** when the cat enters
2. **Laughing** at the first obstacles
3. **Annoyed / angry** as the cat claws through his webs
4. **Surprised** when the cat reaches the throne room

**Rules:** one-sentence lines, triggered by progress, each line plays once, with pauses between them. Background climbing uses a low-detail model on spline paths, no collision or AI.

## 6. Quest Template

1. **Encounter:** something is wrong with a character
2. **Investigation:** talk, look for clues, follow the thread
3. **Escalation:** the trait gets worse
4. **Resolution:** often combat, sometimes not
5. **Aftermath:** the character returns to normal, reward or help later

**Non-combat resolutions:** claw off the thread while the character sleeps, find a memory object, lure them away from the source, free someone else first.

## 7. Enemies and Bosses

- **Basic enemies:** small spiders and creatures made of dark threads, more numerous and stronger closer to the Shadowlands
- **Corrupted characters:** inhabitants with dark threads, usually at the end of a quest, freed rather than defeated
- **Bosses:** one per zone (_open_), final boss the Spider King in the throne room

## 8. Rewards

- Hats (hat shop)
- Hearts
- Collectibles and secret places
- Side quests that unlock fun things

## 9. Technical Constraints

- Engine: MaxWorld (custom, WebGL 2, Three.js)
- 60 FPS on a modern iPhone, roughly 1 million triangles as a ceiling
- Developed mostly with a gamepad (touch causes frame spikes in Safari)
- Models from MaxPaint3D, texture atlas and usually one draw call per model
- **Audio and voice:** ElevenLabs, generated on a paid plan only. Free-plan files are replaced. License log for all audio.
- Key scenes: one audio file per line

## 10. Milestones

| Milestone | Done when |
|---|---|
| **Vertical slice** | The starting mountain is playable from the intro to the owl at the cliff, with real models and audio |
| **Alpha** | All regions, main quests and bosses are playable with placeholders. The whole story can be completed from start to finish. Graphics and animations don't need to be finished. |
| **Beta** | All content in place with final graphics, audio and voice. No known game-blocking bugs. Focus on polish and playtesting. |
| **Release** | 60 FPS on a modern iPhone, tested by players who haven't seen the game before. |

## 11. Open Questions

- Surprise for each zone
- Bosses for each zone
- Number of quests per zone
- Rain and weather
- Shadows
- Night brightness
- When to build the intro
