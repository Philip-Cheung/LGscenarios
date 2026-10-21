# LGscenarios: Doorstep Practice

A two-phone role-play app for practising doorstep conversations. One person plays a **Mormon missionary** and one the **Christian**. Each pair opens the same weekly link (for example `/s/who-is-god`) and pairs with a short code. The practice has six steps: both players read their scene and tap Ready, settle in together, the missionary says the opening line, asks questions one at a time, and closes the conversation. The Christian sees each question only after it has been asked, and can reveal an example answer on their own phone only.

Scenarios are reviewed JSON files in `content/scenarios/`, stored in Supabase as versioned rows. Publishing a new scenario is a database migration; the frontend doesn't change and doesn't need redeploying.

- Frontend: React 19, TypeScript, Vite and React Router, deployed on Vercel.
- Backend: Supabase (Postgres with row-level security and atomic RPCs, anonymous Auth, and Realtime Postgres Changes). Postgres is the source of truth; there is no simulated or offline mode.
- Design system: the Warm Coach design from the design handoff, as tokens and plain HTML primitives with CSS modules. See [docs/design-system.md](docs/design-system.md).

## 1. Requirements and local setup

- **Node 24 LTS** (`.nvmrc`; `engines` is `>=24 <25`) and npm 11. Run `nvm use` if you use nvm.
- Python 3 is needed only to run the UI UX Pro Max skill's search scripts. The app doesn't need it.

```bash
npm ci
cp .env.example .env.development.local   # then fill in the test project's VITE_* values (see section 4)
npx playwright install chromium          # browser for the E2E suite
npm run dev                              # http://localhost:5173/ opens the latest published scenario
```

Use `.env.development.local`, not `.env.local`: Vite loads `.env.local` for production builds too, and the test suites refuse to run when the test project looks like production.

Without valid `VITE_*` values the app shows "Practice is not set up yet" instead of starting. During development, `http://localhost:5173/dev/preview` shows every screen state from sample data without a backend. This page is removed from production builds.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run typecheck` | TypeScript project build check |
| `npm run lint` | oxlint plus the design-system import-boundary check |
| `npm run content:validate` | Validates every scenario file, checks the JSON Schema is current, and warns about long text or files without a migration |
| `npm test` | Unit and component tests (Vitest and Testing Library) |
| `npm run test:db` | Integration tests against the **test** Supabase project |
| `npm run test:e2e` | Playwright tests against a production build that uses the **test** project |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run validate` | typecheck, lint, content, unit tests and build |
| `npm run scenario:publish -- content/scenarios/<id>.v<N>.json` | Validates all scenario files and writes the migration that stores this one (as a draft or published, from its `status`) |
| `npm run scenario:schema` | Regenerates `content/scenario.schema.json` after a content schema change |
| `npm run db:push [-- --dry-run]` | Applies committed migrations to the database in `.env.test.local` |

## 2. Supabase setup

Use **two separate projects**: production, and a disposable test project for automated tests. The tests create users and rewrite timestamps, so never point them at production.

For each project:

1. **Create the project** in the Supabase dashboard.
2. **Enable anonymous sign-ins**: Authentication → Sign In / Providers → *Allow anonymous sign-ins*.
3. **Rate limits**: Authentication → Rate Limits → *Anonymous sign-ins*. The default is 30 per hour per IP address, and a group of 12 on one Wi-Fi network shares one IP.
   - **Production**: raise it enough for your group plus retries (for example 100 per hour), and rely on CAPTCHA for abuse protection.
   - **Test project**: raise it well above that (for example 1,000 per hour), because each `npm run test:db` creates 21 anonymous users and each `npm run test:e2e` creates about 40, and reruns within the hour add up. When the limit is hit, sign-ins fail with HTTP 429 and the app shows "Too many attempts".
4. **CAPTCHA (production)**: Authentication → Attack Protection → enable CAPTCHA with **Cloudflare Turnstile**. Paste the Turnstile **secret key** there only; it never goes in the frontend. Put the **site key** in `VITE_TURNSTILE_SITE_KEY`. The app shows the check only when a phone needs a new anonymous identity.
   - **Test project**: leave CAPTCHA off, or use Cloudflare's always-pass test keys: secret `1x0000000000000000000000000000000AA`, then set `TEST_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TEST_CAPTCHA_TOKEN=XXXX.DUMMY.TOKEN.XXXX`.
5. **Data API**: Settings → API → *Exposed schemas* must include `public` and must **not** include `app_private`. Every table and function grant is explicit in the migrations, so nothing depends on default exposure.

### Apply migrations

Migrations live in `supabase/migrations/` and are applied in timestamp order:

| Migration | Contents |
| --- | --- |
| `…_core_schema.sql` | Scenario registry, sessions, private tables (`app_private`), explicit grants, row-level security |
| `…_session_rpcs.sql` | `create_pair`, `join_pair`, `regenerate_pair_code`, `request_swap`, `respond_swap`, `heartbeat`, `get_session` (and the retired linear `start_pair`, `navigate`, `finish_pair`). All are `SECURITY DEFINER`, check the revision, and are executable by `authenticated` only. |
| `…_realtime_and_cleanup.sql` | Adds `public.sessions` (only) to the `supabase_realtime` publication; cleanup functions; `pg_cron` schedules |
| `…_registry_sample_doorstep_v1_publish.sql`, `…_v2_publish.sql` | Registry rows for the retired linear sample. They stay so old rows keep their history; their content is empty. |
| `…_phase2_exit_restart_branch.sql` | Adds `ended` and restart requests: `end_session`, `request_restart`, `respond_restart`, `cancel_restart` (plus the retired `select_branch`) |
| `…_phase2_branch_required_guard.sql` | Guard for the retired linear flow |
| `…_guided_flow.sql` | Stores scenario content and a `draft`/`published` status in `scenario_registry` (published rows are immutable; drafts are hidden by RLS), adds `featured_scenario()` for the site root, the public `scenario-images` storage bucket, the guided session columns, and `guided_event`, which validates every stage change against the role and ids in the pinned content. Restart and swap return the pair to the scene. Execute on the linear RPCs is revoked. |
| `…_warm_coach_flow.sql` | The six-step flow: stages `paired`, `scene_setup`, `ready_together`, `opening_dialogue`, `question_selection`, `response`, `closing`, `conclusion`, and `guided_event` events `start_practice`, `ready`, `begin`, `opening_complete`, `ask_question`, `share_complete`, `move_to_closing`, `finish`. Only the Christian sends `share_complete`; both send `ready`; the missionary sends the rest. Joining leads to the paired summary; restart returns the pair to the scene, and a role swap to the paired summary. Accepts content schema 2.0 only. |
| `…_reference_pairing.sql` | The creator chooses either role (`create_pair` takes `p_role`; new `creator_user_id` and `creator_role` columns). While waiting, the creator holds the missionary seat and sees their chosen role; if they chose the Christian, the seats swap when the partner joins. Pairing codes are six digits. Only the creator sends `start_practice` (also after a role swap). Either person can request a restart; only the other can accept or decline it. |
| `…_restart_by_either.sql` | Lets a restart request come from either seat |
| `…_answered_questions.sql` | Adds `answered_question_ids` to sessions, returned by `session_state` and sent over Realtime. A trigger adds the question when the Christian finishes sharing, and empties the list when a new round starts (restart or role swap). |
| `…_week_one_flow.sql` | Content schema 2.1. Adds `opening_question_asked` and `exchange` (`initial` or `follow_up`) to sessions, returned by `session_state` and sent over Realtime. New missionary events `ask_opening_question`, `ask_follow_up` and `next_topic`. With an opening question, `opening_complete` is refused: the missionary asks it and the Christian's `share_complete` opens the topics. After the Christian answers a topic that has a follow-up, the topic stays active in `question_selection` with `exchange = 'follow_up'` until the missionary asks it or skips it. A topic is answered when it stops being active back at the topic list (not when moving to closing). A new round resets all of it. Accepts content 2.0 and 2.1. |
| `…_scenario_schema_2_1.sql` | Lets registry content declare schema 2.1 |
| `…_join_inherits_scenario.sql` | A partner who joins by code takes the room's scenario and version, whichever scenario link they opened. Reversed by `…_join_requires_matching_scenario.sql`. |
| `…_follow_up_keeps_topic.sql` | Allows a topic to stay active at the topic list while its follow-up is pending |
| `…_swap_by_either.sql` | A role swap works like restart: either person asks, the other accepts or declines, the requester can cancel, and an unanswered request expires after 60 seconds. A swap may be asked for during a round as well as after it. |
| `…_conversation_flow.sql` | Content schema 3.0 (conversation scenarios). Readiness (`set_ready`, with optional relaxed timing), the knock/open encounter (`perform_encounter_action`, a five-second server deadline per action unless relaxed; a miss never ends the pair and the acting player can retry with or without the timer), and the spoken conversation (`commit_utterance`, which appends one beat id or response kind to the shared `history` and hands over the turn in one transaction; the closing line completes the round). Every command checks role, round, revision and pending requests, and a repeated command id returns the state it produced. History stores ids only, never free text. 2.x sessions keep using `guided_event`. |
| `…_join_requires_matching_scenario.sql` | A code only admits a partner who opened the same scenario link and version; otherwise `join_pair` fails with `scenario_mismatch` |
| `…_retire_week_one_first_vision.sql` | Week One · The First Vision stops opening for new pairs (its row stays; pinned sessions keep working) |
| `…_scenario_<id>_v<N>_publish.sql` / `…_draft.sql` | Generated by `npm run scenario:publish`: one scenario version, stored and verified |

**Test project**: copy the commented `TEST_*` lines from `.env.example` into `.env.test.local` (git-ignored; a placeholder copy is already in your checkout) and fill them in:

```bash
TEST_SUPABASE_URL=https://<test-ref>.supabase.co
TEST_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
TEST_DATABASE_URL=postgresql://postgres.<test-ref>:<password>@<pooler-host>:5432/postgres
TEST_PROJECT_IS_DISPOSABLE=yes
```

Use the *Session pooler* connection string (Connect → Session pooler) and percent-encode the password. Then:

```bash
npm run db:push -- --dry-run   # shows pending migrations
npm run db:push
```

**Production**: put the production connection string in a git-ignored `.env.production.local` as `SUPABASE_DB_URL=…`, then run:

```bash
npm run db:push -- --env .env.production.local --var SUPABASE_DB_URL --dry-run
npm run db:push -- --env .env.production.local --var SUPABASE_DB_URL
```

Alternatively, use `npx supabase link --project-ref <ref>` followed by `npx supabase db push`.

### Verify after pushing

- Database → Publications → `supabase_realtime` lists only `sessions`.
- Integrations → Cron shows `doorstep-cleanup-expired` (every 15 minutes) and `doorstep-cleanup-anonymous-users` (daily at 03:41 UTC). If `pg_cron` wasn't available when you pushed, enable it under Database → Extensions and run, in the SQL editor:

  ```sql
  select cron.schedule('doorstep-cleanup-expired', '*/15 * * * *', 'select app_private.cleanup_expired()');
  select cron.schedule('doorstep-cleanup-anonymous-users', '41 3 * * *', 'select app_private.cleanup_anonymous_users()');
  ```

- Table Editor → `scenario_registry` shows `week-one-christians-too` v1, `sample-doorstep` v6 and `coffee-chat` v4 as `published` with `active_for_new_sessions = true`, `week-one-first-vision` v1 as `published` but inactive, and `who-is-god` v1 as `draft`. Older versions stay as inactive rows. Week 1 · We’re Christians too was published last, so the bare address opens it.
- Storage shows a public `scenario-images` bucket (JPEG, PNG or WebP, up to 2 MB each).

### Data retention and maintenance

- Sessions expire 12 hours after creation. Every RPC and read enforces expiry, whether or not cleanup has run.
- `app_private.cleanup_expired()` deletes expired pairing codes, marks expired sessions, and deletes them one hour after expiry (well within 24 hours). It also prunes heartbeats and request logs after 13 hours and rate-limit events after 2 hours.
- `app_private.cleanup_anonymous_users(interval default '2 days')` deletes anonymous Auth users older than the interval who aren't seated in an unexpired session. It refuses intervals under 13 hours. It runs daily through cron, and you can also run it manually in the SQL editor. Browsers can't execute it.

## 3. Realtime, RLS and grants

- Clients subscribe only to `UPDATE` events on their own `sessions` row. Realtime authorizes each event through the same row-level security policy as reads (participants of an unexpired session). Pairing codes, heartbeats and rate counters live in `app_private`, which is never published or exposed.
- Browsers can only `SELECT` from `sessions` (filtered by RLS) and from `scenario_registry` rows whose `status` is `published`. Drafts are invisible to every browser, signed in or not. All changes go through the RPCs above.
- The example answer is part of the published content, so a determined participant could read it from the network response or the page. It's concealed in the interface only (blurred and hidden from assistive technology until Reveal), which is enough for practice between friends.

## 4. Frontend environment variables

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable** key (`sb_publishable_…`). The app refuses `sb_secret_…` and `service_role` keys. |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile site key (leave empty if CAPTCHA is off) |

Vite **bundles these values into the JavaScript at build time**, so every visitor can read them. Only public values belong here, and you must rebuild or redeploy after changing them. Server secrets (the Turnstile secret key, the database password, the service-role key) belong only in the Supabase dashboard or your local git-ignored env files.

The build also writes a Content-Security-Policy `<meta>` tag allowing only the exact Supabase origin (`https` and `wss`, and for images from the `scenario-images` bucket) and, if a site key is set, `challenges.cloudflare.com`.

## 5. Vercel deployment

1. In Vercel, **Add New → Project** and import this Git repository. The *Vite* preset is detected, and `vercel.json` sets the build command to `npm run build` and the output directory to `dist`.
2. Under Settings → Environment Variables, add the three `VITE_*` variables. Use the production Supabase values for **Production**. Preview deployments should use the test project values, or none at all.
3. Under Settings → General → Node.js Version, choose **24.x**.
4. Deploy, and redeploy after any change to environment variables.

## 6. Routing and headers

`vercel.json` rewrites every path except `/assets/*` and `/favicon.svg` to `index.html`, so direct loads and refreshes of `/s/<slug>` work and asset requests still resolve. The bare address (`/`) asks the database for the most recently published active scenario (`featured_scenario()`) and redirects there, so it follows each week's publish automatically. A slug with no published scenario shows "This scenario is not available"; other unknown paths show the not-found page. It also sends these headers:

- `Content-Security-Policy` with `frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`, which complements the build-time `<meta>` policy
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `X-Frame-Options: DENY`
- a restrictive `Permissions-Policy`
- long-lived immutable caching for `/assets/*`

`npm run preview` applies the same headers locally.

## 7. Public access

Check Settings → Deployment Protection. Visitors to the **production** link must need neither a Vercel nor a ChatGPT account, so production must not require Vercel Authentication. Vercel's default *Standard Protection* restricts preview deployments only, which is what you want. Keep previews restricted.

Check your Vercel and Supabase plan limits before relying on the app: in particular, Auth rate limits on shared Wi-Fi, and whether an inactive Supabase project gets paused.

## 8. Production verification

Automated (against the test project):

```bash
npm run validate
npm run test:db
npm run test:e2e   # builds into dist-e2e with TEST_* values and serves it with production headers
```

`tests/e2e/conversation.spec.ts` covers the featured conversation scenario with two browsers per pair: role cards (the missionary gets a code straight away, the Christian joins by code), readiness with relaxed timing, the knock and open (including a missed knock and both retry paths), the spoken thread (private drafts, **Speak aloud** committing once, the Christian's free reply shown as "Answered aloud", suggested and not-sure replies), the numbered **Take another direction** sheet, inline KJV quotations and passages opened from help returning to help, reload, **Ask them to explain**, wrap-up, the outro and reflection, restart and role swap by consent (accepted and declined), leaving for both, **Change roles**, six simultaneous pairs, layouts at 320, 375, 430 and 1280px and 200% text. It saves screenshots to `docs/screenshots/redesign/`.

The other specs run six simultaneous pairs (12 isolated browser identities) on the guided (2.x) flow, and test the full guided round (paired summary, scene, ready together, opening, the question loop, closing, completion), example answers staying concealed until Reveal, the welcome screen, creators in either role (the partner always joins through code entry and takes the other role, also after **Change roles**), the creator's own browser reopening its code and being refused as its own partner, digit codes, restart from either side with the partner's consent, a second scenario at its own link, leaving from the session menu, reconnecting and reloading, role swaps, draft links, CSP and headers, layouts at 320, 375 and 430px and desktop, 200% text size, keyboard focus, the doorway animation (once, then still under Pause motion and reduced motion), and design-token propagation.

Manual check after each production deploy, using **two real phones**:

1. Share the link in WhatsApp and open it on both phones in WhatsApp's in-app browser.
2. Phone A taps **Mormon missionary** and gets a six-digit code; phone B taps **Christian** and enters it. Both see **Meet at the door**.
3. Both tap **I’m ready**; phone A taps **Start encounter**, then **Knock** within five seconds, and phone B taps **Open door**. Let one knock run out once and check **Try again** and **Try without timer**.
4. Phone A taps **Speak aloud** for the introduction. Phone B taps **Speak aloud** with an empty draft: phone A should see "Answered aloud". Use **Take another direction**, tap a quotation to read the passage, and on phone B open **Need help?** and choose a suggested reply.
5. Lock phone B for about a minute: phone A should show that the partner's connection dropped. Unlock phone B and confirm both phones catch up.
6. On phone A open **+** → **Wrap up conversation**. Watch the goodbye, then on the reflection tap **Switch roles** and accept on phone B; confirm the roles changed. Tap **Leave**, confirm, and check both phones leave.

## 9. Weekly workflow

Publishing a scenario changes only the database. There's no frontend build or Vercel deploy, and pairs already practising keep the version they started with.

1. **Write** `content/scenarios/<id>.v<N>.json` with `"status": "draft"`. Start from an existing file. The `$schema` line gives editor autocomplete and checks against `content/scenario.schema.json`. A scenario has:
   - `"schemaVersion": "2.0"` (or `"2.1"` for the fields marked 2.1 below), `title`, and optionally `subtitle`, `estimatedMinutes`, `difficulty` and `"illustration": "doorway"` (the built-in door art on the scene screen).
   - `roles.missionary` and `roles.christian`: `label`, `sceneTitle`, `sceneText`, `goal`, and an optional `image` (`path` inside the `scenario-images` bucket, plus `alt` text). A role image replaces the illustration.
   - `openingDialogue`: the missionary's opening `script`, and an optional `listenerPrompt` for the Christian. 2.1: an optional `scriptNote` under the line, and an optional required opening `question` (`prompt`, `missionaryNote`, `exampleAnswer`, `moreHelp`, and the `acknowledgment` shown on the first topic list).
   - `questions` (1 to 12): each has an `id`, a `topic`, an optional `icon` (`chat`, `leaf` or `book`), the `prompt` the missionary asks, the `exampleAnswer` for the Christian, and up to 6 optional `scriptures`. 2.1: optional `moreHelp` (1 to 8 sections of `heading` and `text`) and a `followUp` (`prompt`, `missionaryNote`, `missionaryHelp`, `exampleAnswer`, `moreHelp`).
   - `conclusion`: the `closingPrompt` and an optional `reflectionPrompt`. 2.1: an optional `listenerReply` for the Christian and a second `reflectionFollowUp`.
   - 2.1: `bible`, the bundled passage text: `translation`, an optional `source` note, `chapters` (`id`, `book`, `chapter`, `verses` of `number` and `text`) and `references` (`id`, the exact `label`, `chapter`, `start`, `end`, and an optional `context` range for **Read surrounding verses**). Use verified text only; validation checks every range is present.
   - `sourceNotes`: authoring notes and provenance. Never shown to participants.
   Ids are lowercase words joined by hyphens. Everything is plain text, except that 2.1 prompts, examples and help may contain `[label](ref:<reference-id>)` (opens the passage) and `[label](https://www.churchofjesuschrist.org/…)` (an external source link). Every `ref:` must exist in `bible.references`.
2. **Images** (optional): upload them to the `scenario-images` bucket (Storage in the dashboard) and reference their paths. A missing image just leaves the text.
3. **Check** with `npm run content:validate`, then preview it: `npm run scenario:publish -- content/scenarios/<id>.v<N>.json` writes a draft migration. Apply it to the test project with `npm run db:push`. Drafts can't be opened by participants.
4. **Review** the text with whoever owns the content. Edit the JSON and repeat step 3 as often as needed: a draft row is replaced each time.
5. **Publish**: change `"status"` to `"published"`, run `npm run scenario:publish -- content/scenarios/<id>.v<N>.json` again, commit the JSON and the new migration, then apply it to production with the production `db:push` command in section 2. Publishing freezes that version, makes it active for new pairs, deactivates the scenario's older versions, and makes it the scenario the bare site address opens.
6. Open `https://<your-domain>/s/<id>` on two phones, then share the link.

Never edit a published file. To fix a published scenario, copy it to `<id>.v<N+1>.json`, bump `version`, and publish that; the database refuses changes to published rows.

**Conversation scenarios** (`"schemaVersion": "3.0"`) are a spoken doorstep conversation instead of a guided question list. The file has `intro` (the role choice screen), `roles` (`label`, `speaker`, `description`), `resources` (the weekly reading links), the `opening` line with the Christian's welcome replies, 1 to 8 `topics` (each a `question` beat plus up to 4 `followUps` with a `title` and `summary`), the `clarification` beat ("Ask them to explain"), `notSureAnswer`, the `closing` line, `reflection.prompts`, and the bundled KJV `passages` (`id`, exact `label`, reading `context`, `verses`). Every beat has the spoken `text`, a `caption`, and Christian `help` (`hint`, 1 to 4 suggested `answers`, an optional `clarify` question, `context` and `passages`). Spoken text may contain `[quoted words](ref:<passage-id>)`, shown as a tappable quotation. The server stores beat ids only, so beat ids must be unique; validation checks that and every passage reference. Publish it exactly like a 2.x scenario.

`week-one-christians-too.v1.json` (**Week 1 · We’re Christians too**, at `/s/week-one-christians-too`) is published and is the featured scenario. Its copy and passages are taken verbatim from the design prototype (v24). It replaces `week-one-first-vision.v1.json`, which stays published but no longer opens for new pairs.

The current `who-is-god.v1.json` is a **draft**. Its roles, opening, and first two questions come from the brief; the other four questions and the closing line are placeholders marked in `sourceNotes`, to be reviewed before publishing.

## 10. Rollback

- Keep every scenario file and registry row. Sessions in progress keep the version they started with.
- To stop new pairs using a version, add a migration that sets `active_for_new_sessions = false` for that version (and `true` for the previous published one). Pairs with a link to a scenario that has no active version see "This scenario is not available".
- To change which scenario the bare address opens, publish (or republish as a new version) the one you want; it follows the latest `published_at` among active rows.
- Make schema changes additive; avoid destructive migrations. The frontend can be rolled back by promoting a previous Vercel deployment, but only to one that understands the six-step flow (this release or later).
- **Deploying the conversation redesign**: apply `…_swap_by_either.sql`, `…_conversation_flow.sql`, `…_join_requires_matching_scenario.sql`, `…_retire_week_one_first_vision.sql` and `…_scenario_week_one_christians_too_v1_publish.sql` in timestamp order, then deploy the frontend straight away. The previous frontend can't show a 3.0 scenario, so the bare address would open a scenario it can't play until the new frontend is live. Guided (2.x) scenarios keep working on both. To roll back, add a migration that sets `active_for_new_sessions = false` on `week-one-christians-too` v1 and `true` on `week-one-first-vision` v1 (its original `published_at` is newer than the other active scenarios, so the bare address opens it again), then promote the previous Vercel deployment. Pairs already in a 3.0 session must start again.
- **Deploying Week One**: apply `…_week_one_flow.sql`, `…_scenario_schema_2_1.sql`, `…_scenario_week_one_first_vision_v1_publish.sql`, `…_join_inherits_scenario.sql` and `…_follow_up_keeps_topic.sql` in timestamp order, then deploy the frontend straight away. The previous frontend can't show the opening question or follow-ups, so a Week One pair on an old frontend would stall at the opening; the existing 2.0 scenarios keep working on both.
- **Deploying the six-step release**: apply `…_warm_coach_flow.sql`, the scenario migrations, `…_reference_pairing.sql`, `…_restart_by_either.sql`, `…_answered_questions.sql` and the scenario migrations `…_scenario_coffee_chat_v3_publish.sql`, `…_scenario_sample_doorstep_v5_publish.sql`, `…_scenario_who_is_god_v1_draft.sql`, `…_scenario_coffee_chat_v4_publish.sql`, `…_scenario_sample_doorstep_v6_publish.sql` and the second `…_scenario_who_is_god_v1_draft.sql` (published in timestamp order so the bare address opens `sample-doorstep`) at a quiet time, then deploy the frontend straight away. The database and frontend must change together: the previous frontend doesn't understand the new stages or calls `create_pair` without a role, and pairs that started on the previous flow can't continue and must start a new practice. Unused letter codes are deleted by the migration.

## Testing details

- **Unit and component tests** (`npm test`) cover snapshot merging by revision, validation of RPC and Realtime payloads, pair-code handling, content validation, config safety (secret keys are refused), the import-boundary checker, the session screens (who sees what at each stage, the question hidden until asked, the example answer concealed until revealed and again on a new question or round, the session menu, restart and swap requests from either side, the paused and completion screens), and the Button, TextInput, ConfirmDialog, Welcome, RoleSelect and JoinForm behaviour.
- **Database tests** (`npm run test:db`, `supabase/tests/`) use real anonymous users with the publishable key, exactly like the browser. They also open a direct database connection, used only to move clocks, reset rate counters and clean up. Coverage:
  - six isolated pairs
  - a third entrant, self-joins, and concurrent joins
  - retries
  - joining a room from another scenario's link (the room's scenario wins)
  - code expiry and regeneration
  - join and create rate limits
  - signed-out and unrelated callers (RPCs, RLS reads, Realtime subscriptions)
  - direct table writes
  - private schema access
  - drafts hidden from every browser, the featured scenario, and the retired linear RPCs refused
  - a creator who chooses the Christian: their role while waiting, the seat swap on join, and digit-only codes
  - the paired summary only the creator can start (also after a role swap), and both players ready before the conversation (a repeated Ready is harmless)
  - restart requested by either person, answered only by the other, and cancelled only by the person who asked
  - role permissions (the missionary leads; only the Christian finishes sharing), before and after swaps
  - concurrent question choices and the question loop through to closing
  - stale revisions, steps out of order, unknown and retired events, and question ids not in the pinned content
  - restart during a response clearing the question
  - Week One (schema 2.1): the required opening question, each topic's follow-up, skipping, closing during a pending follow-up, duplicate taps, all four topics in another order, creator as Christian, and restart, declined restart and role switch resetting the new state
  - partner staleness
  - expiry and cleanup
- **Safety guard**: the database and E2E suites refuse to run unless `TEST_PROJECT_IS_DISPOSABLE=yes` is set, `TEST_SUPABASE_URL` and `TEST_DATABASE_URL` point at the same project, and the URL differs from any production `VITE_SUPABASE_URL` in `.env.production[.local]`.

## Security notes

- The browser receives only the Supabase URL, the publishable key, and the optional Turnstile site key. Protection comes from row-level security and RPC authorization, not from hiding the key.
- All content renders as text; there is no `dangerouslySetInnerHTML`. Scenario files are validated (plain text only, length limits, unique IDs).
- Pair codes are invitations: anyone holding a valid unused code can take the second seat. That's appropriate for an in-person group, not for high-assurance identity. Codes never appear in URLs or logs.
- If browser storage is cleared, or someone moves from WhatsApp's browser to another browser, that phone loses its identity and must start a new pair. There is deliberately no recovery by code.
- The app collects no names or contact details.

## Tools and skill provenance

Resolved versions at implementation time (exact versions are in `package-lock.json`):

| Tool | Version |
| --- | --- |
| Node / npm | 24.22.0 / 11.19.1 |
| React / React DOM | 19.3.1 |
| Vite | 8.3.4 |
| TypeScript | 6.0.3 |
| React Router | 8.5.0 |
| `@supabase/supabase-js` | 2.118.0 |
| Supabase CLI (`supabase`, dev dependency) | 2.121.0 |
| Zod | 4.6.7 (the browser uses `zod/mini`) |
| Vitest / Testing Library React | 5.0.5 / 16.3.3 |
| `@playwright/test` / `@playwright/cli` | 1.64.1 / 0.1.22 |
| oxlint | 1.89.0 |
| skills CLI (`npx skills`) | 1.7.4 |
| `ui-ux-pro-max-cli` | 2.15.0 |

Project-scoped agent skills:

| Skill | Location | Source |
| --- | --- | --- |
| UI UX Pro Max | `.cursor/skills/ui-ux-pro-max/` | `ui-ux-pro-max-cli` 2.15.0 (`uipro init --ai cursor`). The installer also added six unrelated skills, which were removed. |
| supabase | `.agents/skills/supabase/` | `supabase/agent-skills`, recorded in `skills-lock.json` |
| web-design-guidelines | `.agents/skills/web-design-guidelines/` | `vercel-labs/agent-skills`, recorded in `skills-lock.json` |
| vercel-react-best-practices | `.agents/skills/vercel-react-best-practices/` | `vercel-labs/agent-skills` (`skills/react-best-practices`), recorded in `skills-lock.json` |
| playwright-cli | `.agents/skills/playwright-cli/` | `microsoft/playwright-cli`, recorded in `skills-lock.json` |

Cursor loads skills from `.cursor/skills/` and `.agents/skills/` in the workspace. Reload the Cursor window if newly installed skills don't appear.

## Project layout

```
src/
  app/            routes, pages (not found, config error), dev-only preview gallery
  components/     feature screens (panel frame, role choice, join, session, guided stages, illustrations)
  components/ui/  app-owned design-system primitives
  lib/            config, content schema, pair codes, Supabase client, Turnstile loader
  scenarios/      scenario lookup from Supabase; JSON fixtures for tests and the preview
  sessions/       RPC client, payload validation, snapshot merging, sync hook
  assets/         illustrations from the design handoff
  styles/         tokens.css (canonical), app.css
content/
  scenarios/      reviewed scenario JSON, one file per version
  scenario.schema.json  generated JSON Schema for editors
supabase/
  migrations/     schema, RPCs, Realtime, cleanup, registry entries
  tests/          real-database integration tests
scripts/          content validation, scenario publishing, JSON Schema, boundary check, db push
tests/e2e/        Playwright end-to-end tests
docs/             design-system.md
```
