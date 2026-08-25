# Scene and system design guide

Load this reference for room, map, city, avatar, canvas, WebGL, or AI-led experiences.

## Pick the scene level

| Level | Use when | Strength | Main cost |
| --- | --- | --- | --- |
| DOM/SVG 2.5D | The scene is navigation and status display | Fast, accessible, light, easy to export | Limited depth and camera freedom |
| Hybrid canvas + DOM | Camera focus and spatial atmosphere are important, while forms and content remain conventional | Distinctive without sacrificing product usability | Two coordinated render layers |
| Full 3D free roam | Movement, distance, collision, or discovery is the product | Strong presence and exploration | Controls, physics, assets, performance, onboarding |

Default to DOM/SVG or hybrid. A small room with four functional objects rarely needs player physics.

## Recommended separation

```text
URL/router ───────► product page state
      │                    │
      │                    ▼
      └──────────► scene state machine
                           │
local store ──────► derived metrics ─────► scene reactions
      │                    │
      └──────────► export  └─────────────► AI summary request
                                                │
                                      validated result/fallback
```

The scene is a projection of product state. It must not become a second database.

## State model

Keep four state families distinct:

- **Route:** room, orders, clinic, goals, new-order.
- **Scene:** boot, intro, idle, focus, panel-open, reduced-motion, suspended.
- **Data:** empty, demo, personal, dirty, exporting, resetting.
- **AI:** ineligible, ready, consent-required, requesting, success, stale, failed, fallback.

Define allowed transitions and the visible result of each transition. Browser back and direct URL entry are first-class transitions.

## Hotspot registry

Use one data registry so scene, accessible navigation, analytics, and tests share the same IDs.

```ts
type Hotspot = {
  id: 'orders' | 'clinic' | 'goals'
  label: string
  route: string
  sceneTarget: string
  priority: 'primary' | 'secondary'
  enabledWhen: (view: ProductView) => boolean
  statusText: (view: ProductView) => string
}
```

Each hotspot needs a visible name, a semantic button or link, a focus style, a pointer target of at least 44 by 44 CSS pixels, and a non-spatial fallback.

## Interaction rules

- Let the first useful action be available immediately; intro animation is skippable and non-blocking.
- Use a 300–500 ms camera/focus transition as feedback, not as a gate.
- Do not require users to rotate or search for a critical object.
- Pause continuous rendering when hidden, offscreen, or reduced-motion is enabled.
- On mobile, use a fixed scene angle and bottom navigation. Do not introduce a joystick unless movement is itself the task.
- An optional character must explain, guide, or react. If removed, the task remains understandable.

## Local-first data

Persist an envelope rather than unrelated keys:

```ts
type LocalEnvelopeV1 = {
  schemaVersion: 1
  orders: Order[]
  currentGoal: Goal | null
  settings: Settings
  latestAiResult?: ValidatedAiResult
}
```

Use an explicit migration function per schema version. Derive all totals from source records. Export the same envelope with an export timestamp; protect CSV cells that begin with `=`, `+`, `-`, or `@`. Make demo records distinguishable and removable.

## AI contract

Build the AI boundary after deterministic local analysis exists.

```text
local records
  -> deterministic aggregate
  -> consent summary
  -> minimal same-origin request
  -> provider adapter
  -> schema validation and grounding checks
  -> render or labeled fallback
```

Never send raw names or notes by default. Never let AI overwrite authoritative numbers. Mark a saved AI result stale when the underlying order revision changes. A provider outage must not break local flows.

## Asset and implementation provenance

For every external asset or code sample, record origin, license, modifications, and redistribution permission. If any field is unknown, replace it with an original or clearly licensed alternative before public deployment.
