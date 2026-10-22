# Lost in Panelka

A quiet walk with no goal, in pixel style, through an endless Soviet microdistrict on a snowy winter night.

The main screen shows the walk card with a preview. Pick the snowfall right under it (Auto, Snow, Blizzard, Clear) and press the card to start or continue the walk. The game remembers where you stopped. The world seed lives in Settings; changing it resets your position.

Built with Three.js. Runs locally in the browser. This game started as the "Lost in Panelka" map of Walk and Relax (`../lost-in-city-game`) and was split out into its own project; on the first launch it picks up the panelka walk, seed, settings and snowfall that Walk and Relax saved in the same browser.

## Run

You need Node.js 18 or newer. There are no npm dependencies.

```bash
npm start
```

Then open http://localhost:3001 (port 3001, so it can run next to Walk and Relax on 3000). On macOS you can also double-click `start.command`.

All hints, controls and the description live in the menu (Controls, About). The game view itself has no HUD.

## Controls

| Key | Action |
|---|---|
| W A S D / arrows | walk |
| Mouse | look around |
| Shift | run (hold) |
| W twice | run while W is held |
| Space | jump; in front of a ledge up to 3 m (balcony, canopy, car, garage) climb onto it |
| Space twice | fly on or off (Space up, C down, Shift fast, landing ends the flight) |
| C | crouch (toggle or hold, see Settings) |
| E | open or close the door you look at, flip a light switch, open the roof hatch |
| V | third or first person |
| N | next piece of music |
| F | fullscreen |
| Esc | pause menu |

## How it works

**Microdistrict.** Blocks of 128 m with 9 m streets on the edges (`public/js/panelka.js`). Every block is generated from `hash(seed, blockX, blockZ)`, so the same seed always rebuilds the same yards; only the blocks around the player exist. A block is a courtyard closed by panel buildings, three rows of five-storeys with yards in between, or tower blocks; a power line crosses some rows of blocks. Every building turns its entrances to the yard and gets a driveway with parked cars, yard lamps and plough piles in front; the yard is split into zones (playground, hockey box or football goals, laundry poles and carpet beaters, containers and the transformer hut, garages) and filled with trees where there is room.

**Buildings.** They follow the common series: 1-464 / 1-447 five-storeys (3.2 m module, 2.7 m floors, pitched tin roofs with dormers and drainpipes on the brick ones) and II-49 / P-44 type 9, 12 and 16-storey blocks (3.0 m module, 2.8 m floors, lift rooms and TV antennas on the roof). Windows are real recesses with reveals and tin sills that catch the snow; the glass is drawn by a shader that reads the apartment, floor and kind of window from the UVs: wooden or plastic frames with a vent pane, net curtains and drapes, pot plants, ceiling lamps, a TV, dim stairwell bulbs, apartments switching their lights over time. Balconies are open (painted sheets, lattice, concrete), or glazed with wooden or plastic frames, with skis, boxes and frozen laundry; you can stand on them and climb from one floor to the next.

**Inside the five-storeys.** The panel five-storeys `k5i_3` and `k5i_4` (series 1-464, no lift, as in real life) can be walked into. Their plan is data in `data/blender/k5i_plan.py`: a section of 16 x 11.4 m, floors 2.7 m with 2.48 m ceilings; a two-flight stair with the entrance under the first half landing, five steps up to the first floor, a hatch with a steel ladder up to the roof; three flats per landing: B with one room (32 m2), R with two (45 m2, the bedroom walked through the living room), L with three (58 m2), each with a combined bath, a 6 m2 kitchen, balconies on the back. `data/blender/k5i.py` builds the colliders of the structure into the building (walls with door openings, slabs, treads, rails, the roof with its hatch), the inside of a section (`k5i_shell`), the furniture of every flat in two styles (`k5i_L_sov`, `k5i_L_xp`, ...: the Soviet flat with its wall unit, carpets, ZIL fridge and gas heater, the 2000s one with laminate, a leather sofa and a computer with Windows XP) and the door leaves. In the game (`public/js/interiors.js`) only the sections within 30 m of the camera (six at most) get their insides drawn; furniture collides everywhere. Each flat's style, who is at home and which rooms are lit come from an integer hash of building, section, floor and room, computed the same way in JS and in the shaders, so the windows on the facade always show what is behind them. A point inside a drawn section is lit only by the lamp of its own room (the room is looked up in the plan), so light does not leak through walls; finishes (wallpaper, tiles, oil paint, parquet, linoleum, laminate) are picked per room in the shader. Doors and the hatch are moving colliders; a door does not close on you. Switches you flip are kept for the session (the newest 32).

**Cars.** VAZ-2101, 2107, 2109, Niva, Moskvich-2141, built from the reference sheets in `data/sources/*.jpeg`: lofted smooth bodies with real wheel arches, chrome or plastic bumpers, lights, mirrors, tires with rims, snow blankets that follow the panels, and every one gets a factory color of its model; past 42 m a low polygon twin (`*_lod`) is drawn instead.

**Light and snow.** Each frame the 24 nearest street lamps, entrance bulbs and shop windows go to all shaders (`uPL` / `uPC` in `materials.js`); street lamps shine down in a cone. Everything that faces up gets a cap of snow in the shader; snow glitters near the lamps. It falls in 3D on the GPU (`public/js/snow.js`) in three layers of depth: pixel flakes, whole-pixel squares far away and little 5 x 5 pixel crystals close up. The flakes fall almost straight down with a slow sway and drift a little with a breeze that turns over tens of seconds. You leave footprints. Snowfall Auto (`public/js/weather.js`) keeps a light snowfall with blizzards now and then.

**Look.** The scene renders at a low resolution (Settings, Pixel size, 2x by default) and is upscaled with `image-rendering: pixelated`. A post pass ray-marches a volumetric fog for the first 70 m (`fog.js`), the lamps scatter in it as halos; beyond that a per-material haze and a patchy low cloud deck take over, so the tops of the towers dissolve. Post-processing (`post.js`) adds a small bloom, a warm grade, a slight chromatic shift and ordered dithering; film grain and scanlines are optional. The snow is drawn after the fog pass with its own depth test against the scene and its own fade into the fog.

**Music.** `data/sources/ambience_panelka.m4a` cut into 14 pieces (`public/audio/part01..14.m4a`). The recording has no quiet gaps, so it was cut at the track changes of the music under the ambience, which repeats every 12:40. The player shuffles the pieces on every launch, starts the first one at a random point and crossfades between pieces for 7 seconds. Wind, the snow bed, a far traffic hum, footsteps in the snow and distant sirens are synthesized with WebAudio.

## Project layout

The root holds only what runs the game; everything else (sources, Blender files, tools, QA shots) lives in `data/`.

```
server.js                    static server (Range support for music), port 3001
start.command                double-click launcher for macOS
public/index.html            page, menus
public/css/style.css         pixel UI
public/img/preview.jpg       picture on the main menu card (npm run preview)
public/img/cover.jpg         cover for diyoreg.com/games
public/game.json             card for diyoreg.com/games
public/js/main.js            boot, main loop, modes, title card, snowfall picker, seed, autosave
public/js/panelka.js         generator: blocks, yards, driveways, lights, collider grid, footprints
public/js/interiors.js       insides of the five-storeys: drawn sections, doors, switches, room lights
public/js/assets.js          loads panelka.glb: meshes, colliders, metadata
public/js/materials.js       all shaders and the material table (pk_* names from build_panelka.py)
public/js/snow.js            falling snow in 3D on the GPU
public/js/weather.js         snowfall intensity: auto cycle with blizzards, or a fixed mode
public/js/fx.js              wind (drives fog, snow, sound) and steam particles (block.emitters, unused yet)
public/js/post.js            low-res render, fog, snow layer, bloom, grade, dithering
public/js/fog.js             volumetric fog ray march and its 3D noise
public/js/player.js          movement, jump, crouch, climbing, flying, collisions, camera
public/js/character.js       animated player: clip state machine, idle variations, footsteps
public/js/audio.js           music shuffle with crossfades, synthesized ambience
public/js/ui.js              menus, settings, texts
public/js/storage.js         localStorage (keys panelka:*), one-time import from Walk and Relax
public/js/textures.js        shop sign atlas drawn at runtime
public/js/preview.js         standalone character preview (public/preview.html)
public/models/panelka.glb    every 3D asset of the microdistrict, generated in Blender
public/models/k5i_plan.json  plan of the five-storey with interiors: rooms, lamps, doors, switches
public/models/player.glb     the player with its animations; player_anims.json: clip speeds and heel contacts
public/tex/*.png             pixelized CC0 textures
data/sources/                music, car reference sheets, San Andreas ped model and ped.ifp, INU Tools add-on
data/blender/                build_panelka.py, k5i.py and k5i_plan.py (the five-storey you walk into),
                             animate_player.py and the .blend files
data/tools/                  texture pixelizer, music splitter, animation retargeting, headless QA scripts
data/shots/                  QA screenshots
```

## Rebuilding assets

Models (Blender 4.2+ or 5.x):

```bash
npm run assets      # public/models/panelka.glb and k5i_plan.json from data/blender/build_panelka.py
npm run anims       # public/models/player.glb from the San Andreas ped model and ped.ifp
```

Textures: download the ambientCG `*_1K-JPG.zip` archives listed in `data/tools/pixelize_textures.py` (`TEXTURES`), unpack the `*_Color.jpg` files into a folder and run `python3 data/tools/pixelize_textures.py <folder>`. Missing archives are skipped. Birch bark, twigs and spruce boughs are drawn by the script itself.

Music: see the steps at the top of `data/tools/split_music.py`.

## QA in headless Chrome

```bash
npm run shots        # title view, a walk, an overview; prints FPS, draw calls, errors (data/shots/pk-*.png)
npm run shots:menu   # menu, snowfall picker, seed, blizzard
npm run climb        # climbs a stack of balconies
npm run interiors    # inside a five-storey: flood fill of every floor with the player's size and step, then a
                     # walk with the real physics through the entrance, up the stairs, into every flat and room,
                     # out on the balconies, switches, the hatch and the roof; screenshots in data/shots/in-*.png
npm run perf         # block generation time, draw calls, jump, crouch, wall collisions
npm run preview      # rewrites public/img/preview.jpg and cover.jpg
```

In the page, `window.__game` exposes the player, world, camera, settings and a free camera (`__game.freeCam = { p: [x, y, z], l: [x, y, z] }`) for debugging.

## Publishing on diyoreg.com/games

`public/` is a self-contained web root with relative paths, and `public/game.json` fills in the card. Build the archive with `npm run pack` (writes `data/lost-in-panelka.zip`), then upload it in `/admin`, Games.

## Credits

- Three.js (MIT)
- Textures from [ambientCG](https://ambientcg.com) (CC0), downscaled to pixels
- Font: Press Start 2P by CodeMan38 (SIL Open Font License)
- Models generated in Blender by `data/blender/build_panelka.py`
- Character model: [GTA npc 2 San Andreas](https://sketchfab.com/3d-models/gta-npc-2-san-andreas-f58a94b7cc3a4c41b499de404b4e7cf6) by Dudueyidk (CC BY 4.0)
- Character animations: GTA San Andreas `ped.ifp` (Rockstar Games) from your own copy of the game, read with the IFP reader of [INU Tools](https://github.com/INU-ez/INU_Tools-GTA-sa-) (GPL-3.0). These are Rockstar assets: fine for a personal project, do not redistribute them. `data/blender/animate_player.py` makes a fully original set instead.
