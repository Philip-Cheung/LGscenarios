# Design system

Doorstep Practice uses the approved **Warm Coach** design: a warm canvas, one centred practice panel, a serif heading face, a single teal accent, and calm motion. The source of truth is the design handoff (`ai-developer-handoff/reference/`: `tokens.css`, `style.css`, `app.js`, `index.html`, plus the SVGs in `assets/`). The app reproduces the product panel from that reference. It does not include the reference's preview workbench, its preview controls, or its two-column layout.

There is one light theme, no theme switch and no automatic dark variant. No external UI library or Tailwind is installed; the primitives are plain HTML elements styled with CSS modules.

## Files and boundary

| File | Role |
| --- | --- |
| `src/styles/tokens.css` | **Canonical** tokens, copied from the reference `tokens.css`. The only file allowed to contain raw colours. |
| `src/styles/app.css` | Globals: box sizing, body type on the canvas, disabled buttons, the focus ring, and heading type. |
| `src/components/ui/` | App-owned primitives (`Button`, `TextInput`, `StatusMessage`, `ConfirmDialog`) exported from `index.ts`. |
| `src/components/screens.module.css` | The panel and every screen, reproduced from the reference `style.css`. |
| `src/components/AppScreen.tsx` | The panel frame: header, meta, content, note, status, actions. |
| `src/components/art.tsx` | Icons, the doorway illustration (inlined from `src/assets/doorway.svg` so its door and light can animate), the conversation illustration (`src/assets/*.svg`, copied from the handoff), the pairing check mark, and the activity dots. |
| `src/lib/motion.ts` | The saved "Pause motion" preference. |

`npm run lint` runs `scripts/check-ui-boundary.ts`. It fails when:

- any file imports `@openai/apps-sdk-ui`, `tailwindcss`, `@tailwindcss/*`, `radix-ui` or `@radix-ui/*` (through JavaScript imports, CSS `@import` or `@source`), or
- any CSS file other than `tokens.css` contains a raw hex colour.

`src/main.tsx` imports `tokens.css`, then `app.css`. All CSS is unlayered.

## Tokens

All tokens are defined on `:root` in `tokens.css`, with the reference's names and values. Screens use `var(--…)` and never repeat colour values.

| Group | Tokens | Values |
| --- | --- | --- |
| Colour | `--color-canvas`, `--color-surface`, `--color-ink`, `--color-muted`, `--color-teal`, `--color-teal-hover`, `--color-sage`, `--color-peach`, `--color-line`, `--color-danger`, `--color-focus`, `--color-backdrop` | Canvas `#faf7f0`, panel `#fffdf8`, ink `#26332f`, muted `#5b655f`, teal `#205c50` (hover `#17483e`), sage `#e7eee6`, peach `#f5e5d8`, line `#d9ddd3`, danger `#a13b32`, focus `#9b493c`, dialog backdrop ink at 40% |
| Type | `--font-body`, `--font-heading`, `--text-small`, `--text-body`, `--text-title` | System sans for body text; Georgia for headings, quotes and the pairing code. 13px small, 17px body, titles `clamp(1.65rem, 2.5vw, 1.95rem)`. No webfont download |
| Spacing | `--space-1` … `--space-7` | 4, 8, 12, 16, 24, 32, 48px |
| Shape | `--radius-control`, `--radius-surface` | Controls 14px, the panel 24px |
| Motion | `--motion-fast`, `--motion-enter`, `--motion-activity`, `--motion-confirm`, `--motion-ready`, `--motion-door`, `--motion-door-delay`, `--motion-door-ease` | 160ms hover/press, 240ms entrance, 1.8s activity dots and ready pulse, 380ms pairing check, 1100ms door opening after 80ms on `cubic-bezier(0.2, 0.7, 0.25, 1)` |

To change the theme, edit `tokens.css`; screens should not need to change. The E2E test "changing a design token updates the components" checks that a token change reaches the primary `Button`, and "the production build styles the primary action from the design tokens" checks the built CSS.

## The panel

`AppScreen` renders one `<article>` inside `<main>` (max width 500px, centred; 24px page padding, 16px at 760px and below). The panel is at least 720px tall (760px from 1200px wide), so actions sit at a steady place at the bottom. From top to bottom:

- **Header**: the "Doorstep practice" wordmark and, once paired, the `···` session menu.
- **Meta**: before practice, a label ("Before you begin", "Ready to practise") with "Speak · Listen · Connect". During practice, "Practising: <role>" (the short role name, "Mormon" or "Christian"), "N of 6 · Step" (Scene, Ready together, Opening, Questions, Response, Closing, then "Complete"), and a six-segment `progressbar`.
- **Content**: keyed by the shared step, so each new step replays the entrance motion and resets local state such as the selected question or a revealed answer. Waiting, paired, paused and completion screens use the centred `waiting` layout.
- **Note**, **status line** and **actions**.

### Session menu

A `<details>` disclosure labelled "Session controls" with: **Restart practice** (either person, while restarting is allowed; the partner confirms), **Pause motion** / **Resume motion**, and **Leave session**. It closes on Escape (focus returns to the `···` button) or a pointer press outside. All controls use the single teal colour; Leave is the only item in the danger colour.

## Primitives

Import primitives only from `src/components/ui` (or `./ui` from inside `src/components`).

### `Button`

```tsx
<Button onClick={start} loading={pending === 'start_practice'} disabled={!canAct}>Start practice</Button>
<Button variant="secondary" onClick={onDecline}>Not now</Button>
<Button variant="text" onClick={onBack}>Back</Button>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'text'` | Defaults to `primary` (teal fill). `secondary` is outlined; `text` is a teal text button. |
| `loading` | `boolean` | Disables the button and sets `aria-busy`. |
| `ref` | `Ref<HTMLButtonElement>` | Forwarded to the native button. |
| Native button attributes | | `type` defaults to `"button"`. ARIA attributes such as `aria-expanded` pass through. |

Buttons are at least 52px tall; labels wrap instead of clipping. Disabled buttons are 50% opacity.

### `TextInput`

```tsx
<TextInput ref={inputRef} label="Pairing code" hint="Six digits. Spaces are optional." error={error} />
```

A visible `<label>`, the input, the hint, then an always-mounted `role="alert"` error paragraph. The hint and error are linked through `aria-describedby`, and an error sets `aria-invalid`.

### `StatusMessage`

A persistent live region: `role="status"` for `neutral` and `role="alert"` for `error`. Keep it mounted and change its text so updates are announced. Heartbeats never write to it.

### `ConfirmDialog`

A native `<dialog>` opened with `showModal()`, so the page behind is inert. It shows a "SESSION CONTROLS" eyebrow, the title and description, then the safe action (**Keep practising** by default) and the confirm action. Focus starts on the safe action and returns to the opener; Escape and the backdrop cancel unless a request is pending. A failed or offline leave stays in the dialog and does not pretend the partner was notified.

## Screens

Before pairing, the screens follow who creates the practice rather than the role:

| Screen | Creator | Joiner |
| --- | --- | --- |
| Welcome | The doorway art, a "Conversation practice for Christians" chip, "Practice talking with Mormon missionaries.", two short paragraphs, **Start a practice** and **Join your partner** | Same |
| Role choice | "Which role will you practise?" with two radio cards titled with the short role names "Mormon" and "Christian" (Mormon selected by default), "This week’s scenario" with the scenario title, **Get a pairing code**, **Back** | Not shown; the joiner takes the other role |
| Pairing | "Good conversations start with two." with the six-digit code (`482 716`), both roles, waiting dots, **Change roles**, and **Get a new code** after expiry. Reopening the link in the creator's browser shows the same code with "You started this practice earlier in this browser." | "Find your practice partner." with the numeric code field, **Join practice**, **Back** |
| Paired | "You’re paired" summary, **Start practice** | The same summary; waits for the creator |

After pairing, the screens follow the role:

| Screen | Missionary | Christian |
| --- | --- | --- |
| Scene | Scene art (role image, else the doorway illustration when the scenario sets it), title, text, goal, **I’m ready** | Same |
| Ready together | Both roles marked Ready, **Begin conversation** | Waits for the hello |
| Opening | The opening line as a quote, **I’ve said it** | "Your partner’s turn" |
| Questions | Question cards (radio, topic, prompt); answered questions show a check, "Answered" and a struck-through prompt, and can't be chosen again; **I’ve asked it** once one is chosen; **Move to closing**, which becomes the only (primary) action once every question is answered | "Your partner’s turn" with activity dots; no preview of the questions |
| Response | "Make room to listen" | "Respond in your own words.", the asked question, the blurred example answer with **Reveal example answer**, **I’ve shared my thoughts** (returns both to Questions) |
| Closing | The closing line, **Finish practice** | "A moment to wrap up" |
| Complete | "Take a moment to reflect." with the scenario's reflection prompt, **Practise again** and **Switch roles** | The same, **Practise again**; accepts or declines a switch |

Other states: practice paused while the partner is offline (with **Leave session**), restart requests (the person who asked sees **Cancel request**; the partner confirms with **Start again** or **Keep practising**), and the ended screens.

### Example answer

The example answer is real text, blurred until revealed. The blurred copy is `aria-hidden`; the readable copy (and any scripture references) is `hidden` until **Reveal example answer** is pressed. The toggle has `aria-expanded` and `aria-controls`. A new question, a restart, a swap or a reload always starts concealed again, because the content is keyed by the shared step.

## Motion

Entrance (fade and rise), the pairing check, the ready pulse and the activity dots come from the reference. The doorway opens once when the Welcome or Scene screen appears: the door leaf (`.doorLeaf`) swings from a wider skew to its resting frame around its hinge, and the floor light (`.doorLight`) widens and brightens. It ends on the original artwork and does not replay when a player taps Ready. All of it stops under `prefers-reduced-motion` or when **Pause motion** is chosen in the session menu (saved in `localStorage` as `doorstep:motion-paused`, applied as the `motion-paused` class on `<html>` before the first render). Motion never delays focus or the committed session state, and it does not replay on heartbeats.

## Accessibility requirements

- One `h1` per screen. On the opening screen it is visually hidden ("Start with a hello") because the quote is the visible focus.
- A 3px `:focus-visible` ring in `--color-focus` with a 4px offset; radio cards draw the ring around the whole card. Focus moves to the new heading when the shared step changes, but not on the first render or on heartbeats. Programmatically focused headings show no ring.
- The pairing code is shown as `482 716`, announced digit by digit through visually hidden text, and marked `translate="no"`. The code field opens the numeric keypad.
- Status and error messages use live regions. Colour is never the only signal.
- Works at 320px wide and at 200% text size with no horizontal scrolling; controls stay reachable by normal page scrolling. Buttons are at least 44px tall (primary and secondary 52px).

## Checking changes

Run `npm run validate` and `npm run test:e2e`, then compare the screens with the reference at 390×844, 1280×1000 and 320px. The dev-only gallery at `/dev/preview?state=<name>` (`npm run dev`) renders every state without a backend.
