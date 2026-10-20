# Design system

Doorstep Practice has one neutral dark theme: a centred card, the system font, one prompt per screen, and large tap targets. Visual decisions live in tokens. Any external UI library sits behind a small layer the app owns, so the library can be swapped without touching screens, session logic, RPCs or routing.

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
| Surfaces | `--dp-color-page`, `--dp-color-surface`, `--dp-color-surface-raised`, `--dp-color-surface-hover` | Page background, the card, the revealed answer panel, hover fills |
| Text | `--dp-color-text`, `--dp-color-text-muted`, `--dp-color-text-placeholder` | Primary copy, secondary copy and meta, input placeholders |
| Borders | `--dp-color-border`, `--dp-color-border-strong` | Decorative card and panel edges; control outlines (≥ 3:1 against page and surface) |
| Actions | `--dp-color-action-primary-{bg,bg-hover,text}`, `--dp-color-action-secondary-{bg,bg-hover,border,text}`, `--dp-color-action-disabled-opacity` | Primary and secondary buttons |
| Focus and status | `--dp-color-focus-ring`, `--dp-color-error`, `--dp-color-error-border`, `--dp-color-status` | Keyboard focus, error text, invalid field outline, neutral status text |
| Typography | `--dp-font-family`, `--dp-font-family-mono`, `--dp-font-size-{meta,body,control,prompt,prompt-wide,title,code}`, `--dp-font-weight-{regular,medium,semibold}`, `--dp-line-height-{tight,body}`, `--dp-letter-spacing-code` | System font stack; prompt headings use `prompt`, or `prompt-wide` from 480px up |
| Spacing | `--dp-space-{1,2,3,4,5,6,8,10}` | 4px-based spacing scale |
| Shape and sizing | `--dp-radius-{card,control,panel}`, `--dp-border-width`, `--dp-focus-ring-{width,offset}`, `--dp-control-height`, `--dp-content-max-width`, `--dp-page-gutter`, `--dp-page-gutter-wide`, `--dp-card-min-height`, `--dp-status-min-height` | 48px controls, a 680px column, and a card min-height that keeps navigation at the bottom |
| Motion | `--dp-duration-fast`, `--dp-easing-standard` | Short transitions; the duration is `0ms` under `prefers-reduced-motion` |

Measured contrast for the pairs in use: body text on surface is 13.5:1, muted text on surface 7.8:1, placeholder on page 5.5:1, error text on surface 7.8:1, primary button text 16.7:1, focus ring on surface 7.6:1, and control outlines 3.5:1 or more.

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
| `variant` | `'primary' \| 'secondary'` | Defaults to `primary` (filled). `secondary` is outlined. |
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

- Semantic buttons and headings: one `h1` per page (the scenario title, or the app name on error pages) and an `h2` per card.
- A visible `:focus-visible` ring everywhere (`--dp-color-focus-ring`). Focus moves to the new prompt heading on deliberate navigation, but not on the first render or on heartbeats.
- The pair code input is labelled, validated inline, and gets focus back after an error.
- The answer reveal uses `aria-expanded` and `aria-controls`. The hidden answer is removed from the accessibility tree with `hidden`.
- The pair code is shown visually as `ABC-DEF` and announced letter by letter through visually hidden text, and is marked `translate="no"`.
- Status and error messages use live regions. Colour is never the only signal.
- Honours `prefers-reduced-motion`, works at 320px wide and at 200% text size, respects safe-area insets, and has no fixed footer covering content.
- Touch targets are at least 48px tall with gaps of 8px or more.

## Replacement procedure

1. Install the new library (or remove the dependency and use native elements).
2. Re-implement `Button.tsx` and `TextInput.tsx` (and their `.module.css` variable mappings) behind the **same props**. Keep native semantics, ref forwarding, `aria-busy` while loading, and the label, hint and error wiring.
3. Replace the imports and variable mapping in `src/styles/vendor-theme.css`. Map the new library's variables to existing `--dp-*` tokens; don't add new raw values outside `tokens.css`.
4. Update `VENDOR_PACKAGES` in `scripts/ui-boundary.ts` if the new library has a different package name.
5. If the new library ships CSS, check the stylesheet-ordering constraint above and adjust `vite.config.ts` chunking if needed.
6. Run `npm run validate`, `npm run test:e2e`, and a manual pass over role selection, pairing (waiting, joining, errors), both player views, the revealed answer, reconnecting, completion and the role swap at 320, 375 and 430px and on desktop. The dev-only gallery at `/dev/preview?state=<name>` (`npm run dev`) renders every state without a backend.

Screens, session hooks, RPCs, scenario data and routing should not change. If they need to, the wrapper API is leaking and should be fixed instead.
