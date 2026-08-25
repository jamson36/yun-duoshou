# Verification gates

Use these gates before calling an interaction-led frontend milestone complete.

## Gate 1: design completeness

- Every critical object maps to a route or action.
- Scene, route, data, and AI states are named separately.
- Mobile, keyboard, reduced-motion, loading, empty, and error behavior are decided.
- Asset provenance and deliberate deviations have owners.

## Gate 2: vertical slice

In a clean browser profile, verify:

1. Enter the scene without login.
2. Discover and activate one hotspot.
3. Complete one real product action.
4. See local derived data and the scene update.
5. Return with UI, `Esc`, and browser back where applicable.
6. Refresh and direct-load the route without losing or corrupting state.

## Gate 3: local data

- Schema migration is deterministic and tested.
- Derived totals recompute after create, update, delete, and status correction.
- Demo and personal data remain distinguishable.
- JSON and CSV exports are local, parseable, and formula-safe.
- Reset requires confirmation and clears consent and cached AI results.

## Gate 4: AI

Verify distinct states for ineligible, consent-required, loading, success, stale, timeout, rate limit, invalid structure, user cancellation, and deterministic fallback.

Assert that:

- the outgoing payload matches the displayed consent summary;
- provider credentials are absent from browser assets and requests;
- returned numbers do not contradict local authoritative statistics;
- AI cannot mutate orders or goals;
- local features still work with the AI endpoint unavailable.

## Gate 5: access and devices

Test at least 375, 768, and 1440 CSS pixels. Complete the main flow with keyboard only. Check visible focus, 44-pixel targets, semantic labels, screen-reader status announcements, fixed mobile navigation, and reduced-motion behavior.

## Gate 6: performance and resilience

- First useful action is available without waiting for decorative assets.
- Scene failure reveals textual navigation instead of a blank screen.
- Background tabs and offscreen scenes stop unnecessary rendering.
- Large models, videos, remote fonts, and audio are not required for P0.
- Test a slow network, an asset 404, disabled storage, and an AI timeout.

## Evidence matrix

| State | Viewport | Input | Data | Network | Expected proof |
| --- | --- | --- | --- | --- | --- |
| Fresh room | 375 | touch | empty | online | screenshot + first-action timing |
| Room with data | 1440 | keyboard | personal | online | screenshot + focus traversal |
| AI success | 1440 | pointer | demo | online | payload assertion + result screenshot |
| AI fallback | 375 | touch | personal | endpoint failed | fallback screenshot + local flow pass |
| Reduced motion | 768 | keyboard | personal | online | screenshot + animation audit |

Keep documents, code, automated checks, browser evidence, deployment, and live-service validation as separate claims.
