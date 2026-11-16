# Midnight Stitch

A dream-world action-survival game, shipped as a single drop-in React component.

You play a girl and her plush bunny, stitching a nightmare back together. Survive twelve minutes against waves of unraveled scraps, level up, and pick upgrades as the swarm grows. The whole game renders to one `<canvas>`, ships with **no image or audio assets**, and has **no runtime dependencies** beyond React.

## Features

- **Self-contained.** Sprites are baked procedurally into offscreen canvases; sound is synthesised at runtime with the Web Audio API.
- **Deterministic runs.** A seeded RNG drives all gameplay. Choose a fresh seed per run or a shared _daily_ seed for everyone.
- **Built for performance.** Fixed 60 Hz simulation step with render interpolation, a spatial hash grid for collision queries, pooled entities, and an adaptive low-quality mode when frame times degrade.
- **Well-behaved on the page.** Pauses automatically when the tab is hidden or the game scrolls out of view, and only captures the keyboard while the player is actually engaged with it.
- **Desktop and touch.** Keyboard and mouse on desktop, a virtual joystick on touch devices.
- **Bilingual.** Full English and Persian (فارسی) UI.
- **Typed.** Written in strict TypeScript.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL to play the demo.

## Use it in your project

The component is a single file with no dependencies besides React 18 or newer. Copy [`src/MidnightStitch.tsx`](src/MidnightStitch.tsx) into your project and render it:

```tsx
import { MidnightStitch } from "./MidnightStitch"

export function App() {
    return (
        <div style={{ width: "100%", height: "100vh" }}>
            <MidnightStitch difficulty="Hard" language="EN" />
        </div>
    )
}
```

The component fills its parent (`width: 100%; height: 100%`, with a minimum of 320 × 240), so give the parent an explicit size. It is safe to import and render on the server; the game starts on the client after mount.

### Props

All props are optional.

| Prop            | Type                            | Default     | Description                                                       |
| --------------- | ------------------------------- | ----------- | ----------------------------------------------------------------- |
| `difficulty`    | `"Chill" \| "Normal" \| "Hard"` | `"Normal"`  | Scales enemy health, enemy damage and spawn rate.                 |
| `language`      | `"EN" \| "FA"`                  | `"EN"`      | UI language. `"FA"` switches the container to right-to-left.      |
| `seedMode`      | `"Random" \| "Daily"`           | `"Random"`  | `"Daily"` uses one shared seed per calendar day.                  |
| `soundOn`       | `boolean`                       | `true`      | Enables or mutes audio. Audio starts after the first user input.  |
| `showFPS`       | `boolean`                       | `false`     | Shows an FPS counter and the last runtime error on the canvas.    |
| `startTime`     | `number`                        | `0`         | Run clock offset in seconds (0–660). Handy for testing late game. |
| `accentColor`   | `string`                        | `"#FF6FA8"` | HUD accent colour (any CSS colour).                               |
| `backdropColor` | `string`                        | `"#160D24"` | Background colour behind the canvas.                              |
| `playerImage`   | `string`                        | —           | URL of a custom player sprite.                                    |
| `bunnyImage`    | `string`                        | —           | URL of a custom bunny sprite.                                     |

Invalid or missing values fall back to the defaults, so the component never crashes on bad input. Types are exported from [`src/index.ts`](src/index.ts).

## How to play

| Input                    | Action                         |
| ------------------------ | ------------------------------ |
| `W` `A` `S` `D` / arrows | Move                           |
| Drag (mouse or touch)    | Move with the virtual joystick |
| `P` / `Esc`              | Pause                          |

Attacks are automatic. Click or tap the game once to give it keyboard focus.

- **Survive 12:00** to win.
- Enemies drop gems; collect them to level up and choose from three upgrade cards (common, rare, epic).
- Each run grants **2 rerolls** and **1 banish** to shape your build.
- Your bunny fires heart bolts at the nearest enemy, swings at anything that gets close, and can block an incoming hit on a cooldown.

## Project structure

```
.
├── src/
│   ├── MidnightStitch.tsx   # The component and the whole game engine
│   └── index.ts             # Public exports
├── demo/
│   └── main.tsx             # Minimal host app
└── index.html
```

`MidnightStitch.tsx` is organised into numbered sections:

1. Types and interfaces
2. Data tables and balance constants
3. Utilities (math, seeded RNG, formatters)
4. Event bus
5. Procedural Web Audio engine
6. Input system (keyboard, mouse, virtual joystick)
7. Spatial hash grid
8. Object pools and entity stores
9. Offscreen sprite pre-renderer
10. Core game class and systems
11. React component

## Tuning the game

Gameplay lives in plain data tables near the top of the file, so most balance changes need no logic edits:

- `CONFIG` — simulation step, entity caps, player stats, win time
- `DIFFICULTY_TABLE` — per-difficulty multipliers
- `ENEMY_TABLE` — enemy stats and colours
- `HEART_BOLT_LEVELS` and `UPGRADE_TABLE` — weapon levels and upgrade cards
- `I18N` — every UI string, in both languages

## Scripts

| Command                | Description                        |
| ---------------------- | ---------------------------------- |
| `npm run dev`          | Start the demo with hot reload     |
| `npm run build`        | Type-check and build the demo      |
| `npm run preview`      | Serve the production build locally |
| `npm run typecheck`    | Run the TypeScript compiler        |
| `npm run format`       | Format the code with Prettier      |
| `npm run format:check` | Verify formatting (used in CI)     |

## Contributing

Issues and pull requests are welcome. Please run `npm run format` and `npm run build` before opening a PR.

## License

[MIT](LICENSE)
