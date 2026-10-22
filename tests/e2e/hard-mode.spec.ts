import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import pg from 'pg'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/**
 * Hard mode on two phones: Lesson 1 to its reflection, a Hard mode request
 * accepted by the partner, the Hard mode intro in place of the door, then a two-sided exchange in the Hard mode
 * scenario and its own reflection. Runs against temporary copies of
 * content/scenarios/lesson-one-first-vision.v5.json and week-one-hard-mode.v2.json,
 * registered under their own ids with an old publication date so neither is
 * ever the featured scenario. Both are deleted afterwards.
 */
const SUFFIX = randomUUID().slice(0, 8)
const LESSON = `test-lesson-hard-${SUFFIX}`
const HARD = `test-hard-${SUFFIX}`

const hardFile = JSON.parse(readFileSync('content/scenarios/week-one-hard-mode.v2.json', 'utf8'))
const firstQuestion = hardFile.topics[0].question
const COPY = {
  lessonOpening: 'Hi! We’re missionaries from The Church of Jesus Christ of Latter-day Saints. Do you have a few minutes to talk about our beliefs?',
  lessonWelcome: 'Sure, I have a few minutes. I’m a Christian myself.',
  lessonClosing: 'Thanks for talking with me. I’ve enjoyed hearing what you think. Have a good evening!',
  hardOpening: hardFile.opening.text as string,
  question: 'What does being a Christian mean to you?',
  answer: firstQuestion.help.answers[0].text as string,
  reply: firstQuestion.respond.replies.find((reply: { id: string }) => reply.id === firstQuestion.help.answers[0].reply).text as string,
  replyLabel: firstQuestion.respond.replies.find((reply: { id: string }) => reply.id === firstQuestion.help.answers[0].reply).label as string,
  hardClosing: hardFile.closing.text as string,
  hardReflection: hardFile.reflection.prompts[0] as string,
} as const

const SHOTS = 'docs/screenshots/hard-mode'
mkdirSync(SHOTS, { recursive: true })

const db = () => new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })

function load(path: string, id: string, hardMode?: string) {
  const { $schema: _schema, status: _status, hardMode: _link, ...content } = JSON.parse(readFileSync(path, 'utf8'))
  return { ...content, id, version: 1, ...(hardMode ? { hardMode: { scenarioId: hardMode } } : {}) }
}

test.beforeAll(async () => {
  const client = db()
  await client.connect()
  for (const [id, content] of [
    [HARD, load('content/scenarios/week-one-hard-mode.v2.json', HARD)],
    [LESSON, load('content/scenarios/lesson-one-first-vision.v5.json', LESSON, HARD)],
  ] as const) {
    await client.query(
      `insert into public.scenario_registry
         (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
       values ($1, 1, $1, 5, 'published', $2, true, '2000-01-01')`,
      [id, content],
    )
  }
  await client.end()
})

test.afterAll(async () => {
  const client = db()
  await client.connect()
  await client.query('delete from public.sessions where scenario_id = any($1)', [[LESSON, HARD]])
  await client.query('delete from public.scenario_registry where scenario_id = any($1)', [[LESSON, HARD]])
  await client.end()
})

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Both phones ready with relaxed timing, then knock and open. */
async function openTheDoor({ missionary, christian }: Pair) {
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Meet at the door')).toBeVisible()
  await missionary.page.getByLabel('Relaxed timing — no countdown').check()
  await missionary.page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(christian.page.getByText('✓ Ready')).toBeVisible()
  await christian.page.getByRole('button', { name: 'I’m ready' }).click()
  await missionary.page.getByRole('button', { name: 'Start encounter' }).click()
  await missionary.page.getByRole('button', { name: /^Knock on the door/ }).click()
  await expect(heading(christian.page, 'Open the door')).toBeVisible()
  await christian.page.getByRole('button', { name: /^Open the door/ }).click()
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByText('The door is open. Your conversation begins here.')).toBeVisible()
  }
}

/** The missionary sends their prepared line; it then appears on both phones. */
async function send(pair: Pair, label: string, text: string) {
  await button(pair.missionary.page, label).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.locator('main').getByText(text).last()).toBeVisible()
  }
}

/** The Christian picks the welcome reply from help and sends it. */
async function welcome({ christian }: Pair, text: string) {
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await christian.page.getByRole('dialog', { name: 'Help with your reply' }).getByRole('button', { name: text }).click()
  await button(christian.page, 'Send response').click()
}

/** From the missionary's turn: wrap up from the options sheet, say goodbye, and wait for reflection on both phones. */
async function wrapUp(pair: Pair, closing: string) {
  await pair.missionary.page.getByRole('button', { name: 'More conversation options' }).click()
  await pair.missionary.page.getByRole('dialog', { name: 'Resources & options' }).getByRole('button', { name: 'Wrap up conversation' }).click()
  await expect(pair.missionary.page.locator('section').getByText(closing)).toBeVisible()
  await button(pair.missionary.page, 'Send closing').click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(heading(phone.page, 'Take a moment to reflect')).toBeVisible({ timeout: 15_000 })
  }
}

test('Hard mode: its own address starts nothing; new practices begin at Lesson 1', async ({ browser }) => {
  const phone = await openPhone(browser, 375, 740, `/s/${HARD}`)
  await expect(phone.page).toHaveURL(new RegExp(`/s/${LESSON}$`))
  await expect(phone.page).toHaveTitle('Introduction & First Vision · Doorstep practice')
  await expect(phone.page.getByRole('button', { name: /^LDS Missionary/ })).toBeVisible()
  await phone.context.close()
})

test('Hard mode: from Lesson 1’s reflection, both phones move into the two-sided scenario with the same roles', async ({ browser }) => {
  test.setTimeout(180_000)
  const missionary = await openPhone(browser, 375, 740, `/s/${LESSON}`)
  const christian = await openPhone(browser, 375, 740, `/s/${LESSON}`)
  const pair: Pair = { missionary, christian }
  await missionary.page.getByRole('button', { name: /^LDS Missionary/ }).click()
  const code = await readPairCode(missionary.page)
  await christian.page.getByRole('button', { name: /^Christian/ }).click()
  await christian.page.getByLabel('Pairing code').fill(code.replace(' ', ''))
  await christian.page.getByRole('button', { name: 'Join pair' }).click()
  await openTheDoor(pair)

  // A short Lesson 1: the introduction, the welcome, then the goodbye.
  await expect(missionary.page).toHaveTitle('Introduction & First Vision · Doorstep practice')
  await send(pair, 'Send introduction', COPY.lessonOpening)
  await welcome(pair, COPY.lessonWelcome)
  await expect(missionary.page.getByText('It’s your turn again. Your next line is ready below.')).toBeVisible()
  await wrapUp(pair, COPY.lessonClosing)

  // Reflection offers Hard mode beside the usual choices; the partner must agree.
  for (const phone of [missionary, christian]) await expect(button(phone.page, 'Hard mode')).toBeVisible()
  await shot(christian.page, '375-01-reflection-hard-mode')
  await button(christian.page, 'Hard mode').click()
  const confirm = christian.page.getByRole('dialog', { name: 'Try Hard mode?' })
  await expect(confirm).toContainText('You both move to Hard mode and return to Ready with the same roles.')
  await confirm.getByRole('button', { name: 'Ask to start' }).click()
  await expect(christian.page.getByRole('dialog', { name: 'Waiting for your partner' })).toContainText('You asked to try Hard mode.')
  const prompt = missionary.page.getByRole('dialog', { name: 'Your partner wants to try Hard mode' })
  await expect(prompt).toContainText('This time the LDS Missionary responds to what the Christian says.')
  await shot(missionary.page, '375-02-partner-asks')

  // A decline keeps both on the lesson’s reflection.
  await prompt.getByRole('button', { name: 'Decline' }).click()
  await expect(christian.page.getByText('Your partner declined. Continue where you left off.')).toBeVisible()
  await expect(heading(missionary.page, 'Take a moment to reflect')).toBeVisible()

  // Asked again and accepted: both phones play the Hard mode intro instead of the door.
  await button(missionary.page, 'Hard mode').click()
  await missionary.page.getByRole('dialog', { name: 'Try Hard mode?' }).getByRole('button', { name: 'Ask to start' }).click()
  await christian.page.getByRole('dialog', { name: 'Your partner wants to try Hard mode' }).getByRole('button', { name: 'Accept and start' }).click()
  const intro = (page: Page) => page.getByRole('dialog', { name: 'Hard mode. Tougher questions. Stay curious.' })
  for (const phone of [missionary, christian]) await expect(intro(phone.page)).toBeVisible()
  await missionary.page.waitForTimeout(1200)
  await missionary.page.screenshot({ path: `${SHOTS}/375-03-intro.png` })
  // Skip ends it early on one phone; the other plays through and fades by itself.
  await intro(christian.page).getByRole('button', { name: 'Skip animation' }).click()
  for (const phone of [missionary, christian]) {
    await expect(intro(phone.page)).toHaveCount(0, { timeout: 8_000 })
    await expect(phone.page).toHaveURL(new RegExp(`/s/${HARD}$`))
    await expect(phone.page).toHaveTitle('Hard mode · Doorstep practice')
    await expect(phone.page.getByText('The door is open. Your conversation begins here.')).toBeVisible()
    await expect(heading(phone.page, 'Meet at the door')).toHaveCount(0)
    await expect(phone.page.getByRole('heading', { name: 'Conversation', level: 1 })).toBeFocused()
  }
  // A refresh resumes the same pair in the Hard mode conversation, without replaying the intro.
  await christian.page.reload()
  await expect(christian.page.getByText('Your visitor will introduce themselves first…')).toBeVisible()
  await expect(intro(christian.page)).toHaveCount(0)
  await expect(christian.page).toHaveURL(new RegExp(`/s/${HARD}$`))

  // Two-sided: the Christian’s chosen answer gets a matched, suggested missionary reply.
  await send(pair, 'Send introduction', COPY.hardOpening)
  await welcome(pair, COPY.lessonWelcome)
  await send(pair, 'Send question', COPY.question)
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  await help.locator('button[class*="responseChoice"]').filter({ hasText: COPY.answer }).click()
  await button(christian.page, 'Send response').click()
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByRole('region', { name: 'Conversation prompts' }).getByText(COPY.answer)).toBeVisible()
  }

  const card = missionary.page.getByRole('group', { name: 'Respond to your partner' })
  await expect(card.getByRole('button', { name: new RegExp(`^1\\. ${COPY.replyLabel} \\(Suggested\\)`) })).toHaveAttribute('aria-pressed', 'true')
  await expect(christian.page.getByText('Your partner is responding to you…')).toBeVisible()
  await shot(missionary.page, '375-04-hard-mode-reply')
  await send(pair, 'Send reply', COPY.reply)
  await expect(christian.page.getByText('Your partner is choosing how to continue…')).toBeVisible()

  // Hard mode ends on its own reflection, with no further Hard mode button.
  await wrapUp(pair, COPY.hardClosing)
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByText(COPY.hardReflection)).toBeVisible()
    await expect(button(phone.page, 'Hard mode')).toHaveCount(0)
    await expect(button(phone.page, 'Play again')).toBeVisible()
  }
  await shot(christian.page, '375-05-hard-mode-reflection')

  // Ending the session sends both players back to Lesson 1's role choice.
  await missionary.page.getByRole('button', { name: 'Leave', exact: true }).click()
  await missionary.page.getByRole('dialog', { name: 'End this session?' }).getByRole('button', { name: 'End session' }).click()
  for (const [phone, notice] of [
    [missionary, 'Session ended for both players.'],
    [christian, 'Your partner ended the session.'],
  ] as const) {
    await expect(phone.page).toHaveURL(new RegExp(`/s/${LESSON}$`))
    await expect(phone.page).toHaveTitle('Introduction & First Vision · Doorstep practice')
    await expect(phone.page.getByText(notice)).toBeVisible()
    await expect(phone.page.getByRole('button', { name: /^LDS Missionary/ })).toBeVisible()
  }
  await missionary.page.reload()
  await expect(missionary.page.getByRole('button', { name: /^LDS Missionary/ })).toBeVisible()
  await expect(missionary.page.getByText('Session ended for both players.')).toHaveCount(0)
  await closePair(pair)
})
