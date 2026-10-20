# Doorstep Practice — Build Brief

## 1. Instructions to the implementing IDE agent

Build the application described below. This document is the implementation specification, not a request for another planning document. Start implementing after inspecting any existing repository and its instructions. Preserve unrelated work. Make routine implementation decisions independently and document them. Ask only if a genuine blocker requires user input.

Build and verify a working frontend, Supabase migrations and RPCs, automated tests for security and session behaviour, and deployment documentation. If remote credentials are unavailable, finish everything possible locally and clearly list the remaining setup steps. Never claim real synchronization works based on mock data. Do not silently fall back to a simulation in production.

Use three dummy prompts initially. Do not research or write substantive theological scenarios yet. No OpenAI API, AI chat, or ChatGPT account is needed. The intended host is Vercel, with Supabase as the backend. Do not use ChatGPT Sites hosting.

### 1.1 Install and use Cursor skills before implementation

The user authorizes the implementing agent to install the following project-scoped agent skills and required npm development tools. These instructions are for the AI working in Cursor; do the setup, verify it, and then continue building. Do not merely tell the user to run the commands. Reuse compatible existing installations. Do not install unrelated skill collections or modify global/system software settings.

| Skill | Official source | Project responsibility |
| --- | --- | --- |
| UI UX Pro Max | `nextlevelbuilder/ui-ux-pro-max-skill` | Refine the approved visual hierarchy, spacing, readability, and interaction states. |
| Supabase (`supabase`) | `supabase/agent-skills` | Guide Auth, Realtime, migrations, access control, and backend implementation. |
| Web Design Guidelines (`web-design-guidelines`) | `vercel-labs/agent-skills` | Audit accessibility, focus, forms, mobile interactions, and dark mode. |
| React Best Practices (`vercel-react-best-practices`) | `vercel-labs/agent-skills` | Review relevant React/Vite patterns, data fetching, and bundle performance. Ignore Next.js-only recommendations. |
| Playwright CLI (`playwright-cli`) | `microsoft/playwright-cli` | Inspect rendered screens, exercise flows, capture review evidence, and debug browser issues. |

#### Installation workflow

1. Inspect the existing repository and available tools first. Check Node/npm and Python 3. The current skills CLI documentation requires Node 22.20 or later; select a currently supported Node LTS compatible with the project and recheck upstream requirements. If a system runtime is absent, report the prerequisite and continue work that does not require it. Do not attempt an operating-system runtime installation or bypass permission controls.
2. If this is a new project, minimally scaffold the React/TypeScript/Vite package before installing development dependencies. Avoid overwriting existing files or scaffolding into a nonempty directory blindly.
3. Read each official source's current installation instructions. The commands below are the intended setup as reviewed when this brief was updated. Check CLI help if options or repository layout have changed; do not guess or switch to an unrelated fork.
4. Install tools locally as development dependencies and skills for Cursor in this project. Commands assume the repository root:

```bash
npm install --save-dev ui-ux-pro-max-cli @playwright/cli
npx uipro init --ai cursor
npx skills add supabase/agent-skills --skill supabase -a cursor
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a cursor
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices -a cursor
npx skills add microsoft/playwright-cli --skill playwright-cli -a cursor
npx playwright-cli --help
npx skills list
```

Use the installer-supported noninteractive option only after verifying it in `--help` if the agent cannot operate a selection prompt. Install only the named skills. Record resolved tool versions and skill provenance in the README/setup notes, and retain installer-generated lock/provenance files when applicable. If the Playwright skill has moved into Microsoft's main Playwright repository, follow the official documented migration and record the source used.

5. Locate the installed `SKILL.md` files and read them before their associated tasks. Confirm Cursor can discover them; do not assume files in another assistant's directory will load in Cursor. Inspect what the installers generated and preserve pre-existing rules. Document if a Cursor session reload is needed, while explicitly reading the skill files to continue the current build where possible.
6. Install the browser binaries needed by the project's Playwright test configuration using its documented setup, typically `npx playwright install chromium` after adding `@playwright/test`. The CLI tool and `@playwright/test` have different jobs. Do not replace the automated E2E suite with ad hoc CLI inspection or install a duplicate MCP server solely for this purpose.
7. If installation fails because of network, permissions, or missing prerequisites, record the exact blocker and continue feasible implementation. Do not falsely report the skills installed or claim a review was performed using an unavailable skill.

#### How skills should be applied

This build brief and the approved UI are the source of truth. Skill recommendations are advisory within those requirements. They must not expand product scope, change the backend permission model, add a framework, or overwrite the app-owned design-system layer. Actual repository/user instructions and platform permissions remain in force.

- UI UX Pro Max: preserve the neutral dark card, system font, one prompt per screen, large tap targets, and hidden Christian answers. Do not generate a marketing page, extra navigation, gradients, decorative imagery, or a competing palette. If it generates design notes, reconcile relevant decisions into `docs/design-system.md`; `src/styles/tokens.css` remains the single canonical token source. Use its Python search only when a usable Python runtime is present.
- Supabase: apply during schema, Auth, RPC, RLS, and Realtime work. Independently verify access denial and concurrency with real database tests; a skill recommendation is not evidence that security is correct.
- React Best Practices: apply relevant client-rendered React/Vite guidance without speculative memoization or changing to Next.js.
- Web Design Guidelines: audit the implemented screens after the first working version; fix observed accessibility and interaction issues without redesigning the approved flow.
- Playwright CLI: inspect both roles at 320px, 375px, and 430px widths, plus desktop. Exercise pairing, hidden/revealed answers, waiting/reconnecting, and completion. Maintain separate browser identities for participants. Use only local/test environments for destructive scenarios, and keep tokens, codes, and browser auth-state files out of commits and review evidence.

Before handoff, report which skills were installed and actually used, observed issues fixed, and any unavailable checks. Keep security/database integration tests and the repeatable Playwright suite required in Section 13 even if all skill-guided reviews pass.

## 2. Purpose and scope

Friends practise a doorstep conversation in pairs. One role-plays a Mormon missionary; the other role-plays a Christian. The Christian practises responding and can reveal a suggested answer. Expect 5–6 simultaneous pairs (10–12 phones), each with completely independent progress.

Participants already know the activity from their group leader. They arrive through a WhatsApp link. Avoid onboarding essays, dashboards, scoring, timers, menus, archives, chat, audio, profiles, analytics, and participant registration.

Each week has a distinct permanent scenario URL, such as `/s/sample-doorstep`. Reuse the same application; add scenario data rather than rebuilding the product each week. Previous URLs continue to work.

## 3. Confirmed experience

1. Open a weekly link and see the scenario title plus two large role buttons: **Mormon missionary** and **Christian**. No question navigation yet.
2. Missionary creates a pair and sees a unique code. Christian enters that code on their own phone. Codes are scoped to the same scenario and version.
3. Once both seats are occupied, the missionary sees **Start**. Christian sees **Waiting for your partner to start**.
4. Show one short conversation prompt per screen on both phones. Opening lines and follow-ups count as prompts, using the same Next/Back mechanism as questions.
5. Only the current missionary has **Back** and **Next**. Their action synchronizes both phones. Disable Back on the first prompt. On the last prompt, use **Finish**.
6. Christian sees the same prompt and **Show answer**. Answer starts hidden, is local to that phone, and is never synchronized. Toggle label becomes **Hide answer**. Hide again whenever progress, round, or role changes, including navigating back and refreshing.
7. Missionary sees a short instruction: **Wait for your partner to answer.** Christian sees **Your partner controls next and back.**
8. Finish displays **Scenario complete**. Missionary can request **Switch roles**; Christian accepts or declines. Acceptance atomically swaps the roles and restarts at prompt one. The new missionary receives navigation control. Declining leaves both on the finish screen.

The initial role choice is a request, not an authorization mechanism. After pairing, render roles only from validated session state. Do not add a production role-preview switch or Reset toolbar. Those existed only in the earlier mockup.

## 4. Visual specification

Match a restrained, ChatGPT-like dark interface with a single scenario card, simplified from the user's reference. The accepted direction is a card containing role/progress metadata, scenario title, one step label, one large prompt, and navigation at the bottom. Do not recreate multiple expandable steps within one card.

Suggested tokens, adjustable slightly for accessibility:

| Element | Specification |
| --- | --- |
| Page | `#181818` |
| Card | `#222222`, 1px `#3e3e3e` border, 16–20px radius |
| Main text | `#ececec` |
| Secondary text | `#b5b5b5` |
| Primary button | Near-white background, near-black text |
| Typeface | System sans-serif; no external font request |
| Main prompt | 21–24px mobile, comfortable 1.5 line-height |
| Title | 27–30px, medium weight |
| Touch targets | At least 48px high |
| Content width | Maximum 680px; mobile side padding 16px |

Above the card: a quiet **Doorstep practice** label and scenario title where useful. Within the card, avoid redundant repetition of long titles. Top metadata: role on the left and **1 of 3** on the right. Avoid all-caps text except short metadata if desired. Use whitespace and subtle borders, not decorative icons, gradients, illustrations, or coloured badges.

Place navigation predictably at the card's bottom using layout/min-height, but allow normal page scrolling for large text and revealed answers. Never cover content with a fixed footer or force clipped screen heights. Respect mobile safe-area insets. On the Christian screen, reserve comparable space for the waiting message.

Provide visible keyboard focus, semantic buttons/headings, labelled code input, inline validation, accessible status messages, and `aria-expanded` on answer reveal. Move focus to the new prompt heading on deliberate navigation; do not announce heartbeats. Honour reduced motion and support 200% text zoom and 320px viewport widths. Check text contrast; do not rely on colour alone.

Use OpenAI's public `@openai/apps-sdk-ui` for suitable primitives and theme styling if compatible with a standalone Vite app. It must not introduce a ChatGPT runtime requirement. Check current exports and peer dependencies rather than inventing APIs. If it materially obstructs this simple standalone UI, use semantic HTML and local CSS matching these tokens, and document the fallback. The visual specification takes precedence over a library's default layout. Do not add a second design system.

### 4.1 Replaceable design-system layer (required)

Keep theme values and external UI dependencies behind a small, app-owned interface. This is an implementation requirement, not just documentation. The initial application still has one dark theme; do not add a theme picker or multiple libraries.

- **`src/styles/tokens.css`** is the canonical source for semantic CSS custom properties: page/surface backgrounds, text and muted text, borders, primary action colours, focus ring, error/status colours, font families/sizes/weights/line heights, spacing, radii, control heights, and content widths. Define the approved values here. Screens and UI styles consume tokens instead of repeating raw design values. Layout-only values such as `display: flex`, percentages, and safe-area calculations do not require artificial tokens.
- **`src/components/ui/`** owns only the primitives actually needed: Button, Card, TextInput, and shared status/text primitives where useful. Export them from `index.ts`. Screens import this app-owned module, never the external component library directly.
- Keep vendor component imports, vendor types, theme providers, and vendor-specific styling inside `src/components/ui/`. Put any required vendor global stylesheet import/theme mapping in a single `src/styles/vendor-theme.css`, loaded before the app's token overrides. App bootstrap may mount an app-owned `UIProvider`; vendor provider details remain inside the wrapper layer.
- Give wrappers small, stable, app-owned TypeScript APIs. For example, Button accepts semantic `variant: 'primary' | 'secondary'`, loading/disabled state, children, and appropriate native button attributes. Preserve native semantics, keyboard handling, refs where needed, and ARIA attributes. Do not expose vendor types or require consumers to know vendor class names or DOM structure.
- Wrappers may adapt external components or render native elements. Do not create a universal component factory, runtime library switch, or wrappers for unused components. Do not leak application/session logic into UI primitives.
- Keep scenario layout in feature components and game state in the session layer. Replacing a UI library must not require changes to role permissions, RPCs, synchronization, scenario data, or routing.
- **`docs/design-system.md`** must document the active library/version or native fallback, token names and intended uses, primitive APIs/states, accessibility requirements, stylesheet ordering, and the replacement procedure. Include short usage examples and the reason for any fallback from OpenAI UI.

Replacement procedure: update the dependency and wrapper implementations, replace vendor-theme mappings, preserve the app-owned APIs, then run component interaction and visual/accessibility checks across role selection, pairing, both player views, revealed answers, reconnecting, and completion. Theme-only changes should normally require editing tokens rather than screens. A library replacement is deliberately contained, but is not assumed to be automatic or test-free.

Add a lightweight import-boundary check to the normal validation command: reject external design-system imports outside the wrapper layer and the one vendor stylesheet integration file. Verify representative Button/TextInput behaviour and that changing a semantic token affects its consumers. Do not add a separate Storybook installation solely for this requirement.

## 5. Framework and project layout

- React + TypeScript + Vite, npm, and a committed lockfile.
- React Router for `/s/:slug`; unknown slugs get a friendly not-found view without creating a session.
- Supabase JavaScript client for anonymous authentication, RPCs, authorized reads, and Realtime Postgres Changes.
- CSS modules or a small local stylesheet; include Tailwind only if required by the selected UI package.
- Zod or an equivalent small schema validator for scenario files and external data.
- Vitest/React Testing Library for relevant behaviour and Playwright for multi-browser-context integration tests. Use database integration tests for actual authorization and concurrency.
- No custom Vercel server, websocket server, Next.js SSR, Redux, ORM, or CMS needed.
- Choose mutually compatible stable package versions at implementation time and record the Node version in `.nvmrc`/`engines`.

Suggested structure:

```text
src/
  app/                  # routes and providers
  components/           # role selection, pairing, prompt card, finish, status
    ui/                 # app-owned primitives; external UI imports confined here
      index.ts
  scenarios/            # typed immutable content files
  lib/                  # Supabase client and content validation
  sessions/             # API adapter, synchronization hook, reducer/state types
  styles/
    tokens.css          # canonical semantic design tokens
    vendor-theme.css    # optional isolated vendor stylesheet/theme integration
docs/
  design-system.md      # tokens, primitive APIs, accessibility, replacement guide
supabase/
  migrations/           # schema, grants, RLS, RPCs, publication and cleanup
  tests/                # authorization and transactional integration tests
scripts/                # validate content; generate scenario metadata migration
tests/e2e/
.env.example
vercel.json
README.md
```

Separate presentation, session transport, and scenario data. An explicit development-only demo mode is optional; production must require real configuration. Render a clear configuration error if it is missing.

## 6. Scenario content and versioning

Use an immutable identifier, slug, integer version, title, and ordered prompt array. Each prompt has stable `id`, `label`, `text`, `suggestedAnswer`, and optional `scriptureReference`. Plain text only; no raw HTML. The answer is a suggested response, not automatically a verbatim script or an assessment of the player.

Initial content:

| Step label | Prompt | Suggested answer |
| --- | --- | --- |
| Start the conversation | Hi! Could we ask you a question about your faith? | Sure. What would you like to talk about? |
| Ask a question | What gives you hope? | My faith gives me hope. It reminds me that I am loved. |
| Follow up | How does that help you in everyday life? | It helps me face difficult days with patience and hope. |

Title: **A conversation at the door**. Slug: `sample-doorstep`. Version: 1. Do not add scripture references to filler content.

Keep each prompt and answer to roughly one or two short sentences. Add validation for nonempty fields, unique IDs/slugs/versions, and at least one prompt. Warn on unexpectedly long content.

The database stores a trusted scenario registry with `(scenario_id, version, slug, prompt_count, active_for_new_sessions)`. Generate its migration from validated source data. Browsers may read published registry entries but may not write them. Server-side navigation must validate bounds using this registry, never a client-supplied count.

Pin each session to its content version. Retain old version files while sessions/URLs depend on them; do not replace a live version's prompt ordering. New weeks use new slugs. For revisions, add a version and retain the earlier one; the canonical slug opens the latest published version for new sessions, while resumed sessions load their pinned version. Deploy content support before enabling a new registry entry. Show a refresh/update message if a browser cannot load its session's version.

Answers in frontend scenario files are not confidential. Hiding them is a learning interaction, not secure secrecy against browser inspection. Real session records and navigation permissions must still be protected.

## 7. Backend model and authorization

Use a dedicated Supabase project/environment. Reuse a valid Supabase Auth session; otherwise create an anonymous identity when the user starts pairing. Anonymous Auth users are authenticated users with UUIDs; they are not the unauthenticated `anon` database role. Do not collect names, emails, passwords, or recordings.

Prefer a single session row with two seat columns, avoiding recursive membership RLS:

```text
sessions
  id UUID primary key, server generated
  scenario_id, scenario_version -> trusted registry
  missionary_user_id UUID not null
  christian_user_id UUID nullable
  status: waiting | ready | active | completed | expired
  prompt_index integer default 0
  revision bigint default 0
  round integer default 1
  swap_requested_by UUID nullable
  created_at, updated_at, expires_at (server timestamps)
```

Enforce distinct user IDs when both seats exist. Exactly two seats; no spectators. `revision` increments for every semantic session change. Heartbeats do not increment it. Keep active pairing codes and abuse counters in a private, non-exposed schema. Do not include codes in Realtime session payloads.

Enable RLS on all exposed tables. Allow session SELECT only when `auth.uid()` equals either participant and the session is not expired. Deny all direct client INSERT/UPDATE/DELETE grants and policies on session/registry state. Realtime filters are not authorization: membership RLS must protect both reads and events. Avoid public session enumeration or participant lists. The URL's UUID is not a credential.

Use narrow RPC functions for state changes. Derive identity from `auth.uid()`; do not trust caller-supplied user IDs, role strings, auth user metadata, prompt counts, or timestamps. If privileged functions are needed to enforce these rules, use `SECURITY DEFINER`, empty/fixed safe `search_path`, fully qualified object names, and explicit validation. Revoke default execution from PUBLIC/anon; grant only intended entry points to authenticated. Private helpers must not be directly executable by clients. Keep grants and policies in migrations, not dashboard-only setup.

## 8. RPC contracts and atomicity

Implement equivalent functions with stable typed success/error responses:

| Operation | Rules |
| --- | --- |
| `create_pair(scenario_id, version, request_id)` | Published valid version; actor occupies missionary seat; cryptographic unique code; idempotent request retry returns same pair. |
| `join_pair(code, scenario_id, version, request_id)` | Validate code/expiry and scenario; lock row; reject creator self-join; claim empty Christian seat once; set ready. Same authenticated participant retry is safe. |
| `start_pair(session_id, expected_revision)` | Current missionary only; both present; ready -> active, index 0. |
| `navigate(session_id, direction, expected_revision)` | Current missionary only; active; direction is back/next; enforce registry bounds, never accept arbitrary state patches. |
| `finish_pair(session_id, expected_revision)` | Current missionary only, active, on last prompt -> completed. |
| `request_swap(session_id, expected_revision)` | Current missionary only, completed, no pending request. |
| `respond_swap(session_id, accept, expected_revision)` | Current Christian only, matching pending request. Accept atomically swaps IDs, increments round, resets index, clears request, sets active. Decline clears request only. |

Lock the session row and check expected revision within the same transaction for every state mutation. A duplicate/stale command must not apply twice. Return a conflict with current authorized state so clients can refresh; never automatically replay a stale navigation command. Store request IDs for creation/join retries with appropriate uniqueness. A failed response after a committed operation must be recoverable by reading authoritative state.

The original creator has no permanent navigation privilege: after swapping, permission follows the current missionary column. Do not allow replacing a filled seat by knowing the pairing code.

## 9. Pairing safety and lifecycle

- Use a cryptographically generated six-character uppercase code, excluding confusing characters, formatted for readability. This improves on the four-digit mockup; it is still easy to read aloud.
- Ensure uniqueness among valid codes using a database constraint and retry collisions. Accept case-insensitive input and strip spaces/hyphens; limit input length.
- Joining code expires after 15 minutes and is invalidated after a successful join. Missionary can regenerate an expired waiting code through an authorized, rate-limited RPC. Codes never go in URLs or logs.
- Sessions expire 12 hours after creation; enforce expiry in reads/mutations regardless of cleanup timing. Show **This session has ended. Start a new pair.** on expiry.
- Persist a scenario-to-session pointer locally, but always verify membership server-side before resuming. Handle expired/inaccessible pointers gracefully. Never use local storage as proof of membership.
- Browser refresh retains the Supabase identity and session pointer. Clearing storage or moving from WhatsApp's browser to another browser may lose identity: explain briefly that a new pair must then be created. No insecure seat takeover or recovery by code.
- Pair codes are invitations: anyone who obtains a valid unused code may claim the second seat. This is appropriate for an in-person group, not a high-assurance identity system.
- Rate-limit code attempts and creation server-side, not only through disabled buttons: start with 10 join attempts per identity per 10 minutes, 5 creations per identity per hour, and limits on regeneration. Record failed guesses without rolling back counters when returning an error. Test this explicitly. Use generic invalid/unavailable-code responses.
- Protect anonymous sign-up using Supabase's supported CAPTCHA integration and provider rate limits; configure a low-friction supported challenge for production. Account for 12 users sharing one Wi-Fi IP. Per-identity limits alone do not stop attackers creating fresh identities. Keep the CAPTCHA secret out of frontend configuration.
- Provide a scheduled trusted cleanup migration/job for expired app records, stale pairing codes, and rate-limit data, plus documented maintenance for unused anonymous Auth users. Retain app records no longer than 24 hours after expiry; purge abuse counters after their needed window. Auth-user removal must exclude active-session participants and use supported admin tooling outside the browser.

## 10. Synchronization and recovery

Postgres is the source of truth. Subscribe only to UPDATE events for the selected session row via Supabase Realtime Postgres Changes with membership RLS. Publish only the tables needed. Use RPC responses and authorized reads for initial state; do not rely on receiving an event to know an action succeeded.

Subscribe, wait for successful subscription, then fetch current state. Accept only snapshots with newer revisions (or the same revision for initial reconciliation). This prevents an older fetch overwriting a newer event. Re-fetch after reconnect, focus return, and token refresh. Tear down listeners on session/identity changes. Do not use unauthenticated broadcasts or localStorage events as cross-phone synchronization.

Disable controls while a mutation is in flight. Show pending state and wait for server acknowledgement. No queued offline navigation. On local connection loss show **Reconnecting…**, keep the last prompt visible, and disable mutations until subscription and authoritative state recover.

For partner availability, use a small member-only heartbeat table with a narrow heartbeat RPC and server timestamps (approximately every 15 seconds while visible). A seat is stale after approximately 45 seconds. Both clients use a lightweight periodic authorized read to assess partner freshness and restore authoritative state. When the partner is stale, pause advancement and show **Waiting for your partner to reconnect**. Enforce the freshness check in progress-changing RPCs too. Do not expose heartbeat records across pairs or increment session revision on every heartbeat. Mobile browsers may suspend tabs; this behaviour is expected. Do not promise instantaneous disconnect detection.

On wake, refresh auth, renew own heartbeat, re-fetch session, restore subscription, and then re-enable controls. Rejoining an existing session requires identity, not a reused pairing code. Two tabs with the same identity are the same seat; revision checks prevent double advancement. Closing one tab must not explicitly sign out the other.

Use clear error states for invalid code, full/unavailable pair, scenario mismatch, expired session, throttling, auth failure, and unavailable backend. Preserve user input where useful. Do not expose raw SQL errors or internal IDs.

## 11. Security boundaries

- Browser config may contain Supabase URL and publishable key; never a service-role/secret key or database password. RLS and function authorization provide protection, not hiding the public key.
- `.env.example` contains placeholders only; ignore local secret files. Never log tokens, codes, or credentials.
- Render content as text; no `dangerouslySetInnerHTML`. Validate lengths, enums, UUIDs, and scenario identities at trust boundaries.
- Configure a production CSP allowing only required assets, Supabase HTTPS/WSS, and the chosen CAPTCHA origins. Avoid unsafe-eval and broad wildcards. Include `X-Content-Type-Options: nosniff`, a restrictive referrer policy, and frame protection. Test the actual compiled app with these headers.
- Separate preview/testing and production data. Do not point automated destructive tests at production.
- No claim of protected answers, end-to-end encryption, or anonymity from infrastructure providers. Collect no unnecessary participant data.

## 12. Vercel and Supabase deployment

Deliver a precise README with:

1. Supported Node version, `npm ci`, environment setup, and `npm run dev`.
2. Supabase project/local CLI setup; apply committed migrations and the generated sample registry entry; enable anonymous Auth and configure CAPTCHA/rate limits.
3. Required Realtime publication setup, RLS/grants, and cleanup scheduling. Verify actual migrations on a clean database.
4. Public frontend variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_TURNSTILE_SITE_KEY` if Turnstile is selected. Explain that Vite variables are bundled at build time. Server secrets stay in provider/admin configuration.
5. Vercel import of the Git repository with Vite preset; build command `npm run build`, output directory `dist`; add variables for correct environments and redeploy after changes.
6. SPA deep-link routing in `vercel.json`, including direct loads/refreshes of `/s/sample-doorstep`. Ensure asset requests still resolve correctly. Configure security headers without breaking CAPTCHA or Realtime.
7. Public access for the production participant link; check deployment protection settings so visitors need neither Vercel nor ChatGPT accounts. Keep development previews appropriately restricted.
8. Production verification using two actual phones from WhatsApp, plus six isolated pairs in automated tests.
9. Weekly workflow: add a validated immutable scenario file; generate registry migration; build/test; deploy frontend support; publish registry entry; verify and share the new slug URL. Never overwrite a live scenario version.
10. Rollback notes: retain existing versions and avoid destructive schema changes. Do not activate content before compatible frontend support exists.

Do not promise a particular free-tier entitlement or uptime. Verify provider limits before deployment, especially Auth limits on shared Wi-Fi and backend availability after inactivity. No automatic paid upgrades.

## 13. Acceptance tests and definition of done

Run meaningful tests against the real local/test Supabase backend, not only mocked client calls:

- Six pairs / twelve isolated browser identities progress independently. One pair's navigation or role swap cannot affect another pair.
- Third entrant and self-join fail. Concurrent claims for the second seat yield exactly one winner. Retrying a successful join is safe.
- Unauthenticated and unrelated authenticated callers cannot read, subscribe to, or mutate a session. Test direct database API writes and RPC invocation, not only hidden UI controls.
- Christian cannot navigate by calling an RPC. After a swap, the former missionary loses that permission. Registry, private codes, and counters cannot be modified/read by ordinary clients.
- Concurrent Next requests with one revision advance once. Stale requests, invalid directions, out-of-range progress, premature finish, and unauthorized swap acceptance fail safely.
- Christian sees the same prompt, controls answer visibility locally, and resets visibility on progress/round/role changes. Reveal does not change shared revision.
- Refresh, transient disconnect, delayed/out-of-order events, token refresh, and phone sleep restore current server state. Offline taps are not replayed. Partner heartbeat expiry pauses progression and recovery resumes it.
- Expired codes/sessions fail even before cleanup. Failed guesses still count toward throttling. Same code for a different scenario/version does not join.
- Mobile layout at 320/375/430px, keyboard operation, text zoom, long answer, and readable contrast pass. Production has no preview toolbar.
- Direct weekly URL loads and refreshes work on Vercel; missing config and unknown scenarios show understandable errors. The built bundle contains no secrets.

Provide runnable scripts for typecheck, content validation, test, backend integration tests, E2E, and production build. Report what actually passed and any environment-dependent checks left undone. Mock-only tests do not verify authorization, pair isolation, or synchronization.

## 14. Implementation sequence

1. Scaffold the token file and app-owned UI wrappers, then reproduce the accepted dark card layout with the three dummy prompts. Document the design system and enforce its import boundary.
2. Add typed content registry/validation, routes, and error states.
3. Implement schema, grants/RLS, atomic RPCs, rate limits, and database tests.
4. Connect anonymous identity, pairing, synchronization, heartbeat recovery, and role swapping.
5. Add deployment configuration and setup/weekly maintenance documentation.
6. Run security/concurrency tests, multi-context UI tests, typecheck, and build. Fix failures before handoff.

The final handoff should identify completed features, exact commands tested, remaining external setup, and how to run/deploy. Do not present the earlier prototype's simulated pairing as a finished backend.

## 15. Official references

Reviewed while preparing this brief on 2026-10-20 UTC. Recheck current APIs during implementation; these links support platform choices, while the requirements above are this project's design decisions.

- OpenAI UI components: https://github.com/openai/apps-sdk-ui
- Anonymous Auth: https://supabase.com/docs/guides/auth/auth-anonymous
- Database RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Database functions/grants: https://supabase.com/docs/guides/database/functions
- Realtime Postgres Changes: https://supabase.com/docs/guides/realtime/postgres-changes
- Vite deployment and SPA routing: https://vercel.com/docs/frameworks/frontend/vite

Important distinction: Postgres Changes authorization uses the source table's RLS. Policies on `realtime.messages` concern Broadcast/Presence and are not a substitute for source-table RLS in this design.
