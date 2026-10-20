# Design system

Doorstep Practice has one light theme, adapted from Apple's Human Interface Guidelines for the web: a grouped gray page, white cards, the system font, one prompt per screen, and large tap targets. Phase 2 replaced the original dark theme. There is no theme switch and no automatic dark variant. Visual decisions live in tokens. Any external UI library sits behind a small layer the app owns, so the library can be swapped without touching screens, session logic, RPCs or routing.

The installed guidance is Wondel.ai's `ios-hig-design` skill (v1.5.1, source `wondelai/skills`, content hash `57f41a91308e10b3315ee2ddabea4e9254bf119dc0265d03b37c6afc88e1c009`), copied for Cursor at `~/.agents/skills/ios-hig-design`. It is a third-party reading of the HIG, not an Apple package. Native recommendations are translated to semantic HTML: system font stack instead of a San Francisco download, text labels instead of SF Symbols, buttons and dialogs instead of SwiftUI controls, and no haptics.

## Active library

| Item | Value |
| --- | --- |
| Library | [`@openai/apps-sdk-ui`](https://github.com/openai/apps-sdk-ui) `0.2.2` (pinned in `package-lock.json`) |
| Used for | `Button` and `Input` primitives, plus their theme variables |
| Required by the library | Tailwind CSS `4.3.3` via `@tailwindcss/vite` (the library's stylesheet is built on it) |
| ChatGPT runtime | Not required. The components are plain React and need no `AppsSDKUIProvider` for the features used here. |
| Native fallbacks | `Card` and `StatusMessage` are semantic HTML with local CSS, because the library has no suitable card or live-region primitive. |

No other design system is installed. The app uses no Tailwind utility classes; Tailwind is present only because the library's CSS needs it.

## Files and boundary

| File | Role |
| --- | --- |
| `src/styles/tokens.css` | **Canonical** semantic tokens (`--dp-*`). The only file allowed to contain raw colours. |
| `src/styles/vendor-theme.css` | The single vendor stylesheet integration point. Imports Tailwind and the library CSS and maps the library's variables (`--color-*`, `--font-sans`) to `--dp-*` tokens. |
| `src/components/ui/` | App-owned primitives (`Button`, `TextInput`, `Card`, `StatusMessage`) exported from `index.ts`. The only TypeScript allowed to import the library. |
| `src/styles/app.css` | App-wide globals (body, focus ring, reduced motion), using tokens only. |
| Feature CSS modules (`src/components/*.module.css`) | Screen layout using tokens only. |

`npm run lint` runs `scripts/check-ui-boundary.ts`. It fails when:

- any file outside `src/components/ui/` or `src/styles/vendor-theme.css` imports `@openai/apps-sdk-ui`, `tailwindcss`, `@tailwindcss/*`, `radix-ui` or `@radix-ui/*` (through JavaScript imports, CSS `@import` or `@source`), or
- any CSS file other than `tokens.css` contains a raw hex colour.

## Stylesheet ordering

`src/main.tsx` imports, in this order:

1. `styles/vendor-theme.css`: Tailwind, which declares the cascade layers `theme, base, components, utilities`, then the library CSS and the variable mapping.
2. `styles/tokens.css`: the canonical tokens.
3. `styles/app.css`: app globals.

Vendor CSS lives in cascade layers, while app CSS (tokens, wrapper modules, feature modules) is unlayered, so app rules always win over library defaults regardless of specificity.

**Constraint:** the library's component CSS must load *after* Tailwind declares its layer order. If the library's CSS ends up in an earlier stylesheet, `components` becomes the first-declared, lowest-priority layer, and Tailwind's base reset (`button { border-radius: 0; color: inherit }`) overrides the library's buttons. For that reason, `vite.config.ts` keeps `@openai/apps-sdk-ui` in the app chunk rather than the `vendor` chunk. The E2E test "the production build keeps the vendor component layer above the CSS reset" guards this against the built app.

**Constraint:** the library's CSS entry (`@openai/apps-sdk-ui/css`) also pulls in KaTeX styles, whose `@font-face` rules point at `cdn.openai.com`. The CSP blocks those requests and the E2E CSP test fails on the resulting violations. `vendor-theme.css` therefore imports the entry's other files directly from `node_modules/@openai/apps-sdk-ui/dist/es/styles/`, leaving out `katex.min.css`. When upgrading the library, compare its `dist/es/styles/index.css` with that list; a moved file fails the build.

## Tokens

All tokens are defined on `:root` in `tokens.css`. Screens and primitives use `var(--dp-…)` and never repeat values. Layout-only values such as `display: flex`, percentages and safe-area `env()` calculations don't need tokens.

| Group | Tokens | Intended use |
| --- | --- | --- |
| Surfaces | `--dp-color-page`, `--dp-color-surface`, `--dp-color-surface-raised`, `--dp-color-surface-hover`, `--dp-color-cue`, `--dp-color-scrim`, `--dp-color-selected` | Grouped page (`#F2F2F7`), white cards, answer panel, hover, cue chips, dialog scrim, selected branch |
| Text | `--dp-color-text`, `--dp-color-text-muted`, `--dp-color-text-placeholder` | Primary `#1C1C1E`, secondary `#51515A`, placeholders |
| Borders | `--dp-color-border`, `--dp-color-border-strong` | Decorative separators `#D8D8DF`; control outlines `#6E6E76` (≥ 3:1). A separator is never the only sign of a control |
| Actions | `--dp-color-action-primary-*`, `--dp-color-action-secondary-*`, `--dp-color-action-destructive-*`, `--dp-color-action-text`, `--dp-color-action-disabled-*` | Accent `#005BC4` with white text, red destructive `#B42318` with white text, accent text actions, solid disabled colours |
| Focus and status | `--dp-color-focus-ring`, `--dp-color-error`, `--dp-color-error-border`, `--dp-color-status` | Keyboard focus, error text (also described in words), neutral status text |
| Typography | `--dp-font-family`, `--dp-font-size-{meta,guidance,body,control,answer,choice,section,prompt,prompt-wide,title,code}`, `--dp-font-weight-{regular,medium,semibold,bold}`, `--dp-line-height-{tight,prompt,body}` | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. Scenario title 32px/700. Spoken prompt 28px (30px from 480px), weight 600, line-height 1.4. Body 17px. No webfont download |
| Spacing | `--dp-space-{1,2,3,4,5,6,8,10}` | 4/8/12/16/20/24/32/40px |
| Shape and sizing | `--dp-radius-{card,control,panel,cue}`, `--dp-control-height`, `--dp-control-height-primary`, `--dp-choice-min-height`, `--dp-content-max-width`, `--dp-page-gutter`, `--dp-page-gutter-regular`, `--dp-page-gutter-wide` | Cards 20px, controls 14px. Targets at least 48px; primary actions 52px. Role cards at least 140px and allowed to grow. Column 680px. Page padding 16px under 360px, 20px from 360px, 24px from 480px |
| Motion | `--dp-duration-{press,enter,answer,success,fast}`, `--dp-easing-standard`, `--dp-enter-distance` | Press 100ms scale 0.98, enter 160ms and 4px, answer 150ms, success mark 250ms. All durations and the travel distance are 0 under `prefers-reduced-motion` |

Measured contrast: primary text on white 17:1, secondary text on white 7.8:1 and on the page 7:1, white on accent 6.4:1, white on destructive 6.6:1, destructive text on white 6.6:1, placeholder on white 5.2:1, control outline on white 5:1 and on the page 4.5:1. Disabled controls use a solid gray fill and are not the only way to discover an action.

To change the theme, edit `tokens.css`. Screens should not need to change. The E2E test "changing a design token updates the wrapped components" checks that a token change reaches the vendor-backed `Button`.

## Primitives

Import primitives only from `src/components/ui` (or `./ui` from inside `src/components`).

### `Button`

```tsx
import { Button } from './ui'

<Button onClick={next} loading={pending === 'next'} disabled={!canAct}>Next</Button>
<Button variant="secondary" block onClick={onBack}>Choose a different role</Button>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `variant` | `'primary' \| 'secondary' \| 'destructive'` | Defaults to `primary` (accent fill, white text). `secondary` is outlined. `destructive` is a red fill with white text. |
| `loading` | `boolean` | Disables the button, shows the library's spinner and sets `aria-busy`. |
| `block` | `boolean` | Full width. |
| `ref` | `Ref<HTMLButtonElement>` | Forwarded to the native button. |
| Native button attributes | | `type` defaults to `"button"`. ARIA attributes such as `aria-expanded` pass through. |

States: rest, hover, active, `:focus-visible` ring, disabled (`--dp-color-action-disabled-opacity`) and loading. Labels wrap instead of clipping at large text sizes. Minimum height is `--dp-control-height`.

### `TextInput`

```tsx
<TextInput
  ref={inputRef}
  label="Pair code"
  hint="Your partner sees this code on their phone."
  error={error}
  value={value}
  onChange={(event) => setValue(event.target.value)}
/>
```

| Prop | Type | Notes |
| --- | --- | --- |
| `label` | `string` | Required. Rendered as a visible `<label htmlFor>`. |
| `hint` | `string` | Linked through `aria-describedby`. |
| `error` | `string \| null` | Shown inline with `role="alert"`, sets `aria-invalid`, and is added to `aria-describedby`. |
| `ref` | `Ref<HTMLInputElement>` | Forwarded to the native input. |
| Native input attributes | | Except `size`. |

### `Card`

```tsx
<Card aria-labelledby="role-heading">…</Card>
```

A bordered surface that renders a `<section>` by default (`element="div"` is also allowed). Layout inside the card belongs to feature components.

### `StatusMessage`

```tsx
<StatusMessage>{statusText}</StatusMessage>
<StatusMessage tone="error">{error}</StatusMessage>
```

A persistent live region: `role="status"` for `neutral` and `role="alert"` for `error`. Keep it mounted and change its text so updates are announced. It is one line high (`--dp-status-min-height`) when it has text and collapses when empty. Inside a card footer, the card's minimum height absorbs the change, so the navigation buttons stay put. Heartbeats never write to it.

## Accessibility requirements

- Semantic buttons and headings: one `h1` per page. On the starting screen that is the scenario title. During pairing and play it is the screen's main instruction or the spoken prompt, and the scenario title is a compact label. Error pages that have no scenario title use the app name.
- A visible `:focus-visible` ring everywhere (`--dp-color-focus-ring`). Focus moves to the new prompt heading on deliberate navigation, but not on the first render or on heartbeats.
- The pair code input is labelled, validated inline, and gets focus back after an error.
- The answer reveal uses `aria-expanded` and `aria-controls`. The hidden answer is removed from the accessibility tree with `hidden`.
- The pair code is shown visually as `ABC-DEF` and announced letter by letter through visually hidden text, and is marked `translate="no"`.
- Status and error messages use live regions. Colour is never the only signal.
- Honours `prefers-reduced-motion` with instant state changes and no translation or scaling. Motion never delays focus or the committed session state, and it does not replay on heartbeats.
- Works at 320px wide and at 200% text size, respects safe-area insets, and has no fixed footer covering content. Cards grow with their content.
- Touch targets are at least 48px tall with gaps of 8px or more.

## Replacement procedure

1. Install the new library (or remove the dependency and use native elements).
2. Re-implement `Button.tsx` and `TextInput.tsx` (and their `.module.css` variable mappings) behind the **same props**. Keep native semantics, ref forwarding, `aria-busy` while loading, and the label, hint and error wiring.
3. Replace the imports and variable mapping in `src/styles/vendor-theme.css`. Map the new library's variables to existing `--dp-*` tokens; don't add new raw values outside `tokens.css`.
4. Update `VENDOR_PACKAGES` in `scripts/ui-boundary.ts` if the new library has a different package name.
5. If the new library ships CSS, check the stylesheet-ordering constraint above and adjust `vite.config.ts` chunking if needed.
6. Run `npm run validate`, `npm run test:e2e`, and a manual pass over role selection, pairing (waiting, joining, errors), both player views, the revealed answer, reconnecting, completion and the role swap at 320, 375 and 430px and on desktop. The dev-only gallery at `/dev/preview?state=<name>` (`npm run dev`) renders every state without a backend.

Screens, session hooks, RPCs, scenario data and routing should not change when only the visual library changes. If they need to, the wrapper API is leaking and should be fixed instead.

## Phase 2 additions

### `CueTag`

A noninteractive stage direction (`SAY`, `WAIT`, `CHALLENGE`, `IF THEY SAY…`). The words carry the meaning. It is not a button, filter, or topic chip. Missionary prompts place a tag immediately before the line it describes. The Christian never sees tags, wait instructions, or unchosen branches.

### `ConfirmDialog`

An `alertdialog` portaled to `document.body`. Focus starts on **Keep playing**, Tab cycles inside the dialog, Escape and the backdrop cancel, and focus returns to the opener. The page root is `inert` while it is open. **End session** uses the destructive button. A failed or offline end stays in the dialog and does not pretend the partner was notified.

### Role cards

The starting screen is the scenario title (`h1`), one short description, then **Choose your role** and two native card buttons. Each card's name includes its subtitle. There is no extra Continue step.

### Session actions

**Exit** is in the session bar for both phones. **Restart** is a quieter text action for the current missionary during play and after completion. Restart needs the partner's confirmation and expires after 60 seconds on the server. Conditional prompts use real buttons, distinct from cue tags, and Next/Finish stay unavailable until one option is chosen.
