# LGscenarios: Doorstep Practice

A two-phone role-play app for practising doorstep conversations. One person plays the **Mormon missionary** and one the **Christian**. Each pair opens the same weekly link (for example `/s/sample-doorstep`) and pairs with a short code. The missionary controls the prompts, and the Christian can reveal a suggested answer on their own phone only.

- Frontend: React 19, TypeScript, Vite and React Router, deployed on Vercel.
- Backend: Supabase (Postgres with row-level security and atomic RPCs, anonymous Auth, and Realtime Postgres Changes). Postgres is the source of truth; there is no simulated or offline mode.
- Design system: tokens plus an app-owned wrapper layer around `@openai/apps-sdk-ui`. See [docs/design-system.md](docs/design-system.md).

## 1. Requirements and local setup

- **Node 24 LTS** (`.nvmrc`; `engines` is `>=24 <25`) and npm 11. Run `nvm use` if you use nvm.
- Python 3 is needed only to run the UI UX Pro Max skill's search scripts. The app doesn't need it.

```bash
npm ci
cp .env.example .env.local          # then fill in the VITE_* values (see section 4)
npx playwright install chromium     # browser for the E2E suite
npm run dev                         # http://localhost:5173/s/sample-doorstep
```

Without valid `VITE_*` values the app shows "Practice is not set up yet" instead of starting. During development, `http://localhost:5173/dev/preview` shows every screen state from sample data without a backend. This page is removed from production builds.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run typecheck` | TypeScript project build check |
| `npm run lint` | oxlint plus the design-system import-boundary check |
| `npm run content:validate` | Validates every scenario file and warns about overly long text |
| `npm test` | Unit and component tests (Vitest and Testing Library) |
| `npm run test:db` | Integration tests against the **test** Supabase project |
| `npm run test:e2e` | Playwright tests against a production build that uses the **test** project |
| `npm run build` | Typecheck and production build into `dist/` |
| `npm run validate` | typecheck, lint, content, unit tests and build |
| `npm run registry:generate -- <id> <version> [--publish]` | Writes a scenario registry migration |
| `npm run db:push [-- --dry-run]` | Applies committed migrations to the database in `.env.test.local` |

## 2. Supabase setup

Use **two separate projects**: production, and a disposable test project for automated tests. The tests create users and rewrite timestamps, so never point them at production.

For each project:

1. **Create the project** in the Supabase dashboard.
2. **Enable anonymous sign-ins**: Authentication → Sign In / Providers → *Allow anonymous sign-ins*.
3. **Rate limits**: Authentication → Rate Limits → *Anonymous sign-ins*. The default is 30 per hour per IP address, and a group of 12 on one Wi-Fi network shares one IP.
   - **Production**: raise it enough for your group plus retries (for example 100 per hour), and rely on CAPTCHA for abuse protection.
   - **Test project**: raise it well above that (for example 1,000 per hour), because each `npm run test:db` creates 21 anonymous users and each `npm run test:e2e` creates 29, and reruns within the hour add up. When the limit is hit, sign-ins fail with HTTP 429 and the app shows "Too many attempts".
4. **CAPTCHA (production)**: Authentication → Attack Protection → enable CAPTCHA with **Cloudflare Turnstile**. Paste the Turnstile **secret key** there only; it never goes in the frontend. Put the **site key** in `VITE_TURNSTILE_SITE_KEY`. The app shows the check only when a phone needs a new anonymous identity.
   - **Test project**: leave CAPTCHA off, or use Cloudflare's always-pass test keys: secret `1x0000000000000000000000000000000AA`, then set `TEST_TURNSTILE_SITE_KEY=1x00000000000000000000AA` and `TEST_CAPTCHA_TOKEN=XXXX.DUMMY.TOKEN.XXXX`.
5. **Data API**: Settings → API → *Exposed schemas* must include `public` and must **not** include `app_private`. Every table and function grant is explicit in the migrations, so nothing depends on default exposure.

### Apply migrations

Migrations live in `supabase/migrations/` and are applied in timestamp order:

| Migration | Contents |
| --- | --- |
| `…_core_schema.sql` | Scenario registry, sessions, private tables (`app_private`), explicit grants, row-level security |
| `…_session_rpcs.sql` | `create_pair`, `join_pair`, `regenerate_pair_code`, `start_pair`, `navigate`, `finish_pair`, `request_swap`, `respond_swap`, `heartbeat`, `get_session`. All are `SECURITY DEFINER`, check the revision, and are executable by `authenticated` only. |
| `…_realtime_and_cleanup.sql` | Adds `public.sessions` (only) to the `supabase_realtime` publication; cleanup functions; `pg_cron` schedules |
| `…_registry_sample_doorstep_v1_publish.sql` | Generated registry entry for the sample scenario, published |

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

- Table Editor → `scenario_registry` shows `sample-doorstep` v1 with `active_for_new_sessions = true`.

### Data retention and maintenance

- Sessions expire 12 hours after creation. Every RPC and read enforces expiry, whether or not cleanup has run.
- `app_private.cleanup_expired()` deletes expired pairing codes, marks expired sessions, and deletes them one hour after expiry (well within 24 hours). It also prunes heartbeats and request logs after 13 hours and rate-limit events after 2 hours.
- `app_private.cleanup_anonymous_users(interval default '2 days')` deletes anonymous Auth users older than the interval who aren't seated in an unexpired session. It refuses intervals under 13 hours. It runs daily through cron, and you can also run it manually in the SQL editor. Browsers can't execute it.

## 3. Realtime, RLS and grants

- Clients subscribe only to `UPDATE` events on their own `sessions` row. Realtime authorizes each event through the same row-level security policy as reads (participants of an unexpired session). Pairing codes, heartbeats and rate counters live in `app_private`, which is never published or exposed.
- Browsers can only `SELECT` from `sessions` (filtered by RLS) and from published `scenario_registry` rows. All changes go through the RPCs above.

## 4. Frontend environment variables

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | The **publishable** key (`sb_publishable_…`). The app refuses `sb_secret_…` and `service_role` keys. |
| `VITE_TURNSTILE_SITE_KEY` | The Turnstile site key (leave empty if CAPTCHA is off) |

Vite **bundles these values into the JavaScript at build time**, so every visitor can read them. Only public values belong here, and you must rebuild or redeploy after changing them. Server secrets (the Turnstile secret key, the database password, the service-role key) belong only in the Supabase dashboard or your local git-ignored env files.

The build also writes a Content-Security-Policy `<meta>` tag allowing only the exact Supabase origin (`https` and `wss`) and, if a site key is set, `challenges.cloudflare.com`.

## 5. Vercel deployment

1. In Vercel, **Add New → Project** and import this Git repository. The *Vite* preset is detected, and `vercel.json` sets the build command to `npm run build` and the output directory to `dist`.
2. Under Settings → Environment Variables, add the three `VITE_*` variables. Use the production Supabase values for **Production**. Preview deployments should use the test project values, or none at all.
3. Under Settings → General → Node.js Version, choose **24.x**.
4. Deploy, and redeploy after any change to environment variables.

## 6. Routing and headers

`vercel.json` rewrites every path except `/assets/*` and `/favicon.svg` to `index.html`, so direct loads and refreshes of `/s/sample-doorstep` work and asset requests still resolve. It also sends these headers:

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

The E2E suite runs six simultaneous pairs (12 isolated browser identities), and tests reconnecting and reloading, role swaps, CSP and headers, layouts at 320, 375 and 430px and desktop, 200% text size, and design-token propagation.

Manual check after each production deploy, using **two real phones**:

1. Share the link in WhatsApp and open it on both phones in WhatsApp's in-app browser.
2. Phone A taps **Mormon missionary**; phone B taps **Christian** and enters the code.
3. Start, then step forward and back. On phone B, check the answer is hidden until **Show answer** is tapped, and hidden again after each step.
4. Lock phone B for about a minute: phone A should show **Waiting for your partner to reconnect**. Unlock phone B and confirm both phones catch up.
5. Finish, switch roles, and confirm control moves to phone B.

## 9. Weekly workflow

Never edit a published scenario version. Each change is a new version.

1. Add `src/scenarios/<slug>.v<N>.ts`, with `scenarioId`, `slug`, `version` and `title`, and `prompts` entries that each have an `id`, `label`, `text` and `suggestedAnswer`. Register it in `src/scenarios/index.ts`. Keep older versions in place.
2. Run `npm run content:validate`.
3. Generate an **inactive** registry entry with `npm run registry:generate -- <scenarioId> <N>`.
4. Run `npm run validate` and `npm run test:e2e`.
5. Commit, push, and let Vercel deploy the frontend that knows about the new version. Then apply the migration with `npm run db:push` (test) or the production command above.
6. Publish it with `npm run registry:generate -- <scenarioId> <N> --publish`, then commit and push the migration. That migration is idempotent.
7. Open `https://<your-domain>/s/<slug>` on two phones, then share the link.

## 10. Rollback

- Keep every published scenario file and registry row. Sessions in progress keep the version they started with.
- To stop new sessions using a version, add a migration that sets `active_for_new_sessions = false` for that version (and `true` for the previous one). Don't delete registry rows or scenario files.
- Never activate a registry version before the deployed frontend includes its content file.
- Make schema changes additive; avoid destructive migrations. To roll back the frontend, promote a previous deployment in Vercel. That's safe as long as it still contains every active scenario version.

## Testing details

- **Unit and component tests** (`npm test`) cover snapshot merging by revision, validation of RPC and Realtime payloads, pair-code handling, content validation, config safety (secret keys are refused), the import-boundary checker, and the Button, TextInput, PromptCard and JoinForm behaviour.
- **Database tests** (`npm run test:db`, `supabase/tests/`) use real anonymous users with the publishable key, exactly like the browser. They also open a direct database connection, used only to move clocks, reset rate counters and clean up. Coverage:
  - six isolated pairs
  - a third entrant, self-joins, and concurrent joins
  - retries
  - scenario mismatch
  - code expiry and regeneration
  - join and create rate limits
  - signed-out and unrelated callers (RPCs, RLS reads, Realtime subscriptions)
  - direct table writes
  - private schema access
  - role permissions before and after swaps
  - concurrent Next
  - stale, invalid and out-of-range commands
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
| `@openai/apps-sdk-ui` / Tailwind CSS | 0.2.2 / 4.3.3 |
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
  components/     feature screens (role select, join, session, prompt card)
  components/ui/  app-owned design-system primitives (the only vendor imports)
  lib/            config, content schema, pair codes, Supabase client, Turnstile loader
  scenarios/      immutable scenario content files
  sessions/       RPC client, payload validation, snapshot merging, sync hook
  styles/         tokens.css (canonical), vendor-theme.css, app.css
supabase/
  migrations/     schema, RPCs, Realtime, cleanup, registry entries
  tests/          real-database integration tests
scripts/          content validation, registry generator, boundary check, db push
tests/e2e/        Playwright end-to-end tests
docs/             design-system.md
```
