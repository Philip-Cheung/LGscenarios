# Design system

Doorstep Practice uses the palette of the approved **conversation prototype** (`doorstep-prototype.html`, v24) app-wide: quiet white surfaces, near-black ink, system type and one muted green accent. Conversation scenarios (schema 3.0) reproduce the prototype's screens; see [Conversation screens](#conversation-screens). Guided (2.x) scenarios keep the **Warm Coach** panel layout described below, now in the prototype palette. The Warm Coach source was the design handoff (`ai-developer-handoff/reference/`). Neither the prototype's preview controls nor its simulated disconnect are shipped.

There is one light theme, no theme switch and no automatic dark variant. No external UI library or Tailwind is installed; the primitives are plain HTML elements styled with CSS modules.

## Files and boundary

| File | Role |
| --- | --- |
| `src/styles/tokens.css` | **Canonical** tokens, taken from the prototype. The only file allowed to contain raw colours. |
| `src/components/conversation/` | The conversation screens and their stylesheet `conversation.module.css` (tokens only), plus `Sheet` and `SessionDialog`. |
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

All tokens are defined on `:root` in `tokens.css`. The accent keeps the older token name `--color-teal` so the guided screens didn't need to change. Screens use `var(--…)` and never repeat colour values.

| Group | Tokens | Values |
| --- | --- | --- |
| Colour | `--color-canvas`, `--color-surface`, `--color-ink`, `--color-muted`, `--color-teal`, `--color-teal-hover`, `--color-sage`, `--color-peach`, `--color-line`, `--color-line-strong`, `--color-danger`, `--color-focus`, `--color-backdrop` | Canvas `#fafbf8`, surface `#ffffff`, ink `#252a25`, muted `#687166`, accent `#3f513b` (hover `#354634`), sage `#eef2e8`, peach `#f0e7d7`, line `#e3e7de` (strong `#cfd8c9` for fields), danger `#9b5845`, focus `#49765b`, backdrop ink at 40% |
| Conversation colour | `--color-surface-quiet`, `--color-bubble`, `--color-bubble-mine`, `--color-bubble-speaking(-line)`, `--color-chip(-ink)`, `--color-selected(-line)`, `--color-notice(-line)`, `--color-sheet-shadow`, `--color-fade`, `--color-scene`, `--color-timer-track`, `--color-timer`, `--color-timer-relaxed`, `--color-tap-shadow`, `--color-tap-idle(-ink)` | The prototype's composer, bubbles, chips, selected rows, notices, sheet shadow, the black fade into the conversation, the doorstep scene, the countdown ring and the knock/open button |
| Type | `--font-body`, `--font-heading`, `--text-small`, `--text-body`, `--text-title` | The system sans for everything (headings included). 13px small, 16px body, titles `clamp(1.625rem, 2.5vw, 1.75rem)`. No webfont download |
| Spacing | `--space-1` … `--space-7` | 4, 8, 12, 16, 24, 32, 48px |
| Shape | `--radius-control`, `--radius-surface`, `--radius-sheet` | Controls 12px, surfaces 16px, sheets 24px |
| Motion | `--motion-fast`, `--motion-enter`, `--motion-activity`, `--motion-confirm`, `--motion-ready`, `--motion-door`, `--motion-door-delay`, `--motion-door-ease`, `--motion-sheet`, `--motion-knock`, `--motion-fade`, `--motion-outro` | 160ms hover/press, 240ms entrance, 1.8s activity dots and ready pulse, 380ms pairing check, 1100ms door opening after 80ms on `cubic-bezier(0.2, 0.7, 0.25, 1)`, 180ms sheet entrance, 1300ms knock, 480ms fade, 5200ms outro |

To change the theme, edit `tokens.css`; screens should not need to change. The E2E test "changing a design token updates the components" checks that a token change reaches the primary `Button`, and "the production build styles the primary action from the design tokens" checks the built CSS.

## The panel

`AppScreen` renders one `<article>` inside `<main>` (max width 500px, centred; 24px page padding, 16px at 760px and below). The panel is at least 720px tall (760px from 1200px wide), so actions sit at a steady place at the bottom. From top to bottom:

- **Header**: the "Doorstep practice" wordmark and, once paired, the `···` session menu.
- **Meta**: none before the practice starts; the header leads straight into the content. During practice, "Practising: <role>" (the short role name, "Mormon" or "Christian"), "N of 6 · Step" (Scene, Ready together, Opening, Questions, Response, Closing, then "Complete"), and a six-segment `progressbar`.
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
| Welcome | The doorway art, a "Conversation practice for Christians" chip, "Practice talking with Mormon missionaries.", two short paragraphs, **Create a room** and **Join your partner** | Same |
| Role choice | "Select a role" with two radio cards titled with the short role names "Mormon" and "Christian" (Mormon selected by default), "This week’s scenario" with the scenario title, **Get a pairing code**, **Back** | Not shown; the joiner takes the other role |
| Pairing | The "Invite your partner" chip (the `h1` "Invite your partner" is visually hidden), the six-digit code (`482 716`), both roles, waiting dots, **Change roles**, and **Get a new code** after expiry ("This code has expired." becomes the visible heading). Reopening the link in the creator's browser shows the same code and asks for the partner to join "on their own phone". | "Find your practice partner." with the numeric code field, **Join practice**, **Back** |
| Paired | "You’re paired" summary, **Start practice** | The same summary; waits for the creator |

After pairing, the screens follow the role:

| Screen | Missionary | Christian |
| --- | --- | --- |
| Scene | Scene art (role image, else the doorway illustration when the scenario sets it), title, text, goal, **I’m ready** | Same |
| Ready together | Both roles marked Ready, **Begin conversation** | Waits for the hello |
| Opening | The opening line as a quote, **I’ve said it**. With an opening question (schema 2.1): the line, an optional script note, the question, and **I’ve asked it**; then "Make room to listen" | "Your partner’s turn"; after the question is asked, "A little about you" with the question, the hidden example (with More help) and **I’ve shared my thoughts**, which opens the topics |
| Questions | Question cards (radio, topic, prompt); answered questions show a check, "Answered" and a struck-through prompt, and can't be chosen again; **I’ve asked it** once one is chosen; **Move to closing**, which becomes the only (primary) action once every question is answered. After an opening question, the first topic list also shows the acknowledgment to adapt. A Bible reference in the chosen prompt appears as a button below the cards | "Your partner’s turn" with activity dots; no preview of the questions |
| Questions · Follow-up | "Ask a follow-up", "Use what your partner actually said. Adapt the wording if needed.", the suggested follow-up, optional missionary note and More help; **I’ve asked it**, **Next topic** (skips the follow-up and marks the topic Answered), **Move to closing** | "Your partner’s turn": "Listen for their follow-up question." with no preview |
| Response | "Make room to listen" | "Respond in your own words.", the asked question, the blurred example answer with **Reveal example answer**, **I’ve shared my thoughts**. If the topic has a follow-up this returns the missionary to the follow-up; otherwise both return to Questions |
| Response · Follow-up | "Make room to listen" | "Respond to the follow-up", the follow-up, a fresh hidden example with More help, **I’ve shared my thoughts** (marks the topic Answered) |
| Closing | The closing line, **Finish practice** | "A moment to wrap up", with the scenario's optional suggested reply |
| Complete | "Take a moment to reflect." with the scenario's reflection prompt (and optional second question), **Practise again** and **Switch roles** | The same, **Practise again**; accepts or declines a switch |

The progress row keeps six steps; a follow-up adds the sublabel "Follow-up" (for example "4 of 6 · Questions · Follow-up").

Other states: practice paused while the partner is offline (with **Leave session**), restart requests (the person who asked sees **Cancel request**; the partner confirms with **Start again** or **Keep practising**), and the ended screens.

### Example answer

The example answer is real text, blurred until revealed. The blurred copy is plain text and `aria-hidden`; the readable copy (with its Bible reference buttons, scripture references and a collapsed **More help** `<details>`) is `hidden` until **Reveal example answer** is pressed. The toggle has `aria-expanded` and `aria-controls`. A new question, a follow-up, a restart, a swap or a reload always starts concealed again with More help collapsed, because the content is keyed by the shared step.

### Bible passages and source links

Scenario text marks Bible references as `[James 1:5](ref:james-1-5)` and historical sources as `[label](https://www.churchofjesuschrist.org/…)`. A reference renders as an inline text button that opens the passage reader; a source renders as a link with "↗" and visually hidden "(external source, opens in a new tab)".

The passage reader is a native modal `<dialog>`: a bottom sheet on phones and a centred dialog from 761px. It shows the exact reference as its heading, the translation label, the bundled verses with verse numbers, **Read surrounding verses** / **Show selected verses** when the reference has a context range (selected verses keep a sage background and teal edge, plus visually hidden "Selected verse"), and **Close**. The page behind is inert; Escape and the backdrop close it; focus returns to the reference without scrolling the page. Long passages scroll inside the reader while the actions stay pinned, with the safe-area inset below them. It lives inside the screen's keyed content, so a new shared step, restart request, pause or end closes it. An unknown reference shows "Passage unavailable" and never another passage. The sheet's entrance stops under reduced motion and **Pause motion**.

## Conversation screens

Conversation scenarios use a full-height frame instead of the panel: a header ("Doorstep practice", the scenario title, and **Leave**, or **Back** before pairing) and a role strip (portrait, "{Role} (You)", and the partner's connection). Copy is the prototype's, verbatim.

| Screen | Missionary | Christian |
| --- | --- | --- |
| Who will you play? | Role cards with large portraits, and "This week's reading". Tapping **Mormon missionary** creates the pair at once | Tapping **Christian** opens the join form |
| Pairing | "Invite your partner": the six-digit code with **Copy**, "Waiting for your partner to join…", both roles, **Change roles**; **Get a new code** after expiry | "Join your partner": the code field and **Join pair** |
| Meet at the door | Both players' ready state, **Relaxed timing — no countdown**, **I'm ready**, then **Start encounter** | **I'm ready**; waits for the missionary |
| Encounter | The doorstep scene, a countdown ring and **Knock** (five seconds unless relaxed); after a miss, **Try again** or **Try without timer** | **Open door** after the knock; the door swings open, then the screen fades into the conversation |
| Conversation | The shared thread and a private composer with the suggested next line; **Take another direction** (a sheet of numbered rows: "Continue this topic", "Other directions"), **End the conversation** once every topic is used, and **+** for resources, **Ask them to explain**, topic background, **Restart round**, **Switch roles** and **Wrap up conversation** | The thread and a composer: an empty draft commits "Answered aloud" (nothing is transcribed); **Need help?** opens a starting point, suggested responses, the topic's passages, **Explain the verse** and **Help me clarify**; **Clear draft** |
| Outro and reflection | A 5.2-second goodbye with **Skip animation**, then "Take a moment to reflect": the last line, numbered prompts, **Switch roles**, **Play again**, **Leave session** and "Review your conversation" | Same |

**Speak aloud** is the only way to commit a line. It is compact and right-aligned in the composer, disabled while a commit is in flight or when it's not your turn, and its accessible name says what it sends ("Send question", "Send response", "Waiting for your partner"). Drafts stay on the phone until committed.

Spoken KJV quotations render as inline text with a dotted underline. They are `span role="button"` elements (focusable, Enter and Space open the passage) rather than `<button>`s, because a button is laid out as an inline block and a long quotation would not wrap with its sentence. A passage opened from **Need help?** returns to help when closed.

**Sheets** (`Sheet.tsx`) are native modal dialogs: one at a time, a labelled close button, Escape and backdrop dismissal, and focus returned to the opener. A session interruption (offline, a request, the end of a round) closes any open sheet. **Session dialogs** (`SessionDialog.tsx`) handle leave confirmation and restart or swap requests: the requester sees **Cancel request**, the partner **Decline** or **Accept and restart** / **Accept and switch**, and a request expires after 60 seconds.

The thread doesn't scroll a reader away from older messages: it follows new lines only when you're already near the bottom. Going offline shows a non-modal banner ("Your place and conversation are saved…") and pauses actions; a partner's dropped connection shows its own banner. Layout respects safe-area insets, works from 320px and at 200% text (the frame scrolls rather than squeezing the thread), and from 900px centres the thread and composer at 860px.

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
