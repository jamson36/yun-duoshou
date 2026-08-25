---
name: interactive-site-rebuild
description: "Analyze a public or authorized creative website, extract reusable interaction mechanisms, and produce an original DESIGN.md, scene architecture, rebuild plan, and browser verification matrix. Use for requests such as 借鉴网站交互、复刻创意网站、搭建 2.5D/3D 场景、生成 design.md、local-first 前端或带 AI 的空间化体验. Do not use for ordinary CRUD UI or for copying unlicensed code, assets, branding, or text."
---

# Interactive Site Rebuild

Build an original product from a reference interaction system. Treat the reference as evidence, not as permission to copy.

## Choose the mode first

- Use **interaction adaptation** by default: preserve useful mechanisms while creating original visuals, content, code, assets, and information architecture.
- Use **authorized fidelity rebuild** only when the user owns the source or has explicit authorization. Record the authority and the allowed use before mirroring or copying anything.
- If authorization or asset licensing is unclear, inspect public behavior and public source only, list the uncertainty, and continue in interaction-adaptation mode.

## Workflow

### 1. Read the current project before designing

Inspect the product docs, existing files, current implementation, target devices, time budget, data boundary, and success criteria. Mark facts, assumptions, and unresolved decisions separately.

### 2. Capture mechanisms, not decoration

Create a mechanism inventory with these columns:

| Surface | Trigger | State transition | Feedback | Reusable principle | Reuse decision | Source or license |
| --- | --- | --- | --- | --- | --- | --- |

Record navigation, camera behavior, scene states, hotspots, input modes, fallbacks, loading, sound, persistence, and error states. Do not infer architecture from a dependency list alone; verify what actually drives the experience.

### 3. Compare three implementation levels

Always compare:

1. DOM/SVG 2.5D scene.
2. Hybrid scene canvas plus semantic DOM product layer.
3. Full free-roam 3D world.

Recommend the lightest level that preserves the product's signature interaction. Use full 3D only when spatial movement itself is essential to the product outcome.

### 4. Write DESIGN.md before implementation

Copy `assets/DESIGN.template.md` into the project and complete every required section. The document must decide:

- experience sentence, goals, non-goals, and success measures;
- reference boundary and asset provenance;
- chosen scene level and rejected alternatives;
- object-to-route/action map;
- route, scene, overlay, and data state machines;
- desktop, mobile, keyboard, and reduced-motion behavior;
- local data schema, versioning, export, migration, and reset;
- AI request contract, consent, validation, failure fallback, and non-authority;
- performance budgets and browser verification matrix.

Load `references/scene-and-system-design.md` when the product uses a room, map, city, avatar, canvas, WebGL, or AI. Load `references/verification-gates.md` before declaring a milestone complete.

### 5. Create the rebuild plan

Copy `assets/REBUILD_PLAN.template.md` into the project. Keep one forward queue, one mechanism/provenance register, one deliberate-deviation register, and a reverse-chronological milestone log. Update the plan with each milestone.

### 6. Build one vertical slice first

Implement one complete path before widening the scene:

`enter scene -> discover hotspot -> open product layer -> mutate local data -> scene reflects new state -> return/back works`

For AI products, extend the same slice with:

`local deterministic summary -> explicit consent -> structured AI result -> schema validation -> local fallback`

Do not start with asset polish, free movement, multiplayer, or decorative shaders.

### 7. Keep scene and product logic separate

- The router owns shareable navigation state.
- The product store owns orders, goals, settings, consent, and migrations.
- The scene state machine owns camera, focus, ambient effects, and hotspot availability.
- A typed event bridge maps product events to scene reactions.
- Hotspots use a configuration registry instead of scattered click handlers.
- 3D or canvas is never the only navigation path; keep semantic DOM controls.

### 8. Enforce local-first and AI boundaries

- Business totals and classifications are deterministic and locally recomputable.
- AI interprets structured summaries; it does not calculate authoritative totals or mutate orders and goals.
- Obtain consent before sending data. Minimize the payload and exclude raw sensitive notes by default.
- Never ship provider keys in frontend code. Use a minimal same-origin serverless or edge proxy when real AI is required.
- Validate structured output, limit lengths, time out visibly, and label deterministic fallback as fallback.

### 9. Verify with evidence

Test direct URLs, browser back, refresh, mobile layout, keyboard flow, reduced motion, local persistence, export, reset, AI success, and AI failure. Capture screenshots for the state matrix. Report documents, implementation, automated checks, browser verification, deployment, and real-service validation as separate states.

## Hard boundaries

- Do not copy code, models, textures, fonts, audio, video, wording, logos, or brand identity without a compatible license or explicit permission.
- Do not claim content from an inaccessible page was reviewed.
- Do not hide essential navigation inside image coordinates or raycasting.
- Do not make a mandatory intro longer than the time needed to understand the first action.
- Do not describe a visually similar screenshot as functional equivalence.
- Do not call AI output a financial, medical, or psychological diagnosis unless the product is explicitly qualified for that regulated use.
