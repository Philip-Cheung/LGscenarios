import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import pg from 'pg'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/**
 * Prepared questions only, on two phones, against a temporary copy of the
 * draft content/scenarios/week-one-christians-too.v2.json. The copy is
 * registered under its own id with an old publication date, so it is never the
 * featured scenario, and it is deleted afterwards.
 */
const SCENARIO = `test-prepared-${randomUUID().slice(0, 8)}`
const PATH = `/s/${SCENARIO}`
const COPY = {
  opening: 'Hi! We’re missionaries from The Church of Jesus Christ of Latter-day Saints.',
  welcome: 'Sure, I have a few minutes. I’m a Christian myself.',
  christianity: 'We believe in Jesus Christ too.',
  christianityHint: 'Acknowledge the shared language, then explain who you believe Jesus is and what trusting him means.',
  christianityAnswer: 'For me, being a Christian means trusting Jesus Christ as my Saviour and following him. I believe he is the eternal Son of God who became human, died for our sins, and rose again.',
  passage: 'John 14:1–6',
  callUsChristians: 'We believe in Jesus too. Would you consider us Christians?',
  whyTrinity: 'Why is belief in the Trinity essential to how you understand Christianity?',
} as const
/** Removed in version 2; none of these may appear. */
const REMOVED = [
  /I’m not sure yet/,
  /read (that|the) passage together/i,
  /Help me clarify/,
  /Ask a clarifying question/,
  /Ask them to explain/,
  /What did your partner say\?/,
  /Respond to your partner/,
]

const SHOTS = 'docs/screenshots/prepared'
mkdirSync(SHOTS, { recursive: true })

const db = () => new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const file = JSON.parse(readFileSync('content/scenarios/week-one-christians-too.v2.json', 'utf8'))
  const { $schema: _schema, status: _status, ...content } = file
  const client = db()
  await client.connect()
  await client.query(
    `insert into public.scenario_registry
       (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
     values ($1, 1, $1, 5, 'published', $2, true, '2000-01-01')`,
    [SCENARIO, { ...content, id: SCENARIO, version: 1 }],
  )
  await client.end()
})

test.afterAll(async () => {
  const client = db()
  await client.connect()
  await client.query('delete from public.sessions where scenario_id = $1', [SCENARIO])
  await client.query('delete from public.scenario_registry where scenario_id = $1', [SCENARIO])
  await client.end()
})

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

const speakButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

async function expectNothingRemoved(page: Page) {
  for (const text of REMOVED) await expect(page.getByText(text)).toHaveCount(0)
}

/** Pairs two phones, readies both with relaxed timing, and opens the door. */
async function toConversation(browser: Browser, width: number, height: number): Promise<Pair> {
  const missionary = await openPhone(browser, width, height, PATH)
  const christian = await openPhone(browser, width, height, PATH)
  await missionary.page.getByRole('button', { name: /^Mormon missionary/ }).click()
  const code = await readPairCode(missionary.page)
  await christian.page.getByRole('button', { name: /^Christian/ }).click()
  await christian.page.getByLabel('Pairing code').fill(code.replace(' ', ''))
  await christian.page.getByRole('button', { name: 'Join pair' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Meet at the door')).toBeVisible()
  await readyAndOpen({ missionary, christian })
  return { missionary, christian }
}

async function readyAndOpen({ missionary, christian }: Pair) {
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

/** The missionary sends their current draft; it appears on both phones. */
async function speak(pair: Pair, label: string, text: string) {
  await speakButton(pair.missionary.page, label).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.locator('main').getByText(text).last()).toBeVisible()
  }
}

test('Prepared questions: the Christian answers, and the missionary goes straight on to the next prepared question', async ({ browser }) => {
  test.setTimeout(150_000)
  const pair = await toConversation(browser, 375, 740)
  const { missionary, christian } = pair
  const card = missionary.page.getByRole('group', { name: 'What would you like to ask next?' })
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })

  await speak(pair, 'Send introduction', COPY.opening)
  // The welcome is a short acknowledgment, with nothing appended.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await expect(help.getByRole('button', { name: COPY.welcome })).toBeVisible()
  await expectNothingRemoved(christian.page)
  await help.getByRole('button', { name: COPY.welcome }).click()
  await speakButton(christian.page, 'Send response').click()
  for (const phone of [missionary, christian]) await expect(phone.page.locator('main').getByText(COPY.welcome, { exact: true })).toBeVisible()

  // The first prepared question is the missionary's private draft until sent.
  await expect(card.getByRole('button', { name: /^1\. Being Christian \(Recommended\)/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(christian.page.getByText(COPY.christianity)).toHaveCount(0)
  await speak(pair, 'Send question', COPY.christianity)

  // Help stays private: a hint, the verse, and one suggested answer, with nothing sent.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: 'Hint' }).click()
  await expect(help).toContainText(COPY.christianityHint)
  await help.getByRole('button', { name: 'Explain the verse' }).click()
  await help.getByRole('button', { name: `${COPY.passage} · KJV` }).click()
  const passage = christian.page.getByRole('dialog', { name: COPY.passage })
  await expect(passage).toContainText('King James Version')
  await passage.getByRole('button', { name: 'Close' }).click()
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  const answers = help.locator('button[class*="responseChoice"]')
  await expect(answers).toHaveCount(1)
  await expect(answers.first()).toContainText(COPY.christianityAnswer)
  await expectNothingRemoved(christian.page)
  await shot(christian.page, '375-01-one-answer')
  await answers.first().click()
  await expect(christian.page.locator('section').getByText(COPY.christianityAnswer)).toBeVisible()
  // Choosing an answer has not sent it: the missionary is still waiting.
  await expect(speakButton(missionary.page, 'Waiting for Christian response')).toBeDisabled()
  await expect(missionary.page.getByText(COPY.christianityAnswer)).toHaveCount(0)

  await speakButton(christian.page, 'Send response').click()
  await expect(missionary.page.locator('main').getByText(COPY.christianityAnswer, { exact: true })).toBeVisible()

  // Straight back to the missionary, with the next prepared question ready and private.
  await expect(card.getByRole('button', { name: /^1\. Would you call us Christians\? \(Recommended\)/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(missionary.page.locator('section').getByText(COPY.callUsChristians)).toBeVisible()
  await expect(christian.page.getByText('Your partner is choosing what to ask next…')).toBeVisible()
  await expect(christian.page.getByText(COPY.callUsChristians)).toHaveCount(0)
  await expectNothingRemoved(missionary.page)
  await shot(missionary.page, '375-02-next-question')

  // The options menu has no clarification; the chooser still offers every prepared direction.
  await missionary.page.getByRole('button', { name: 'More conversation options' }).click()
  const options = missionary.page.getByRole('dialog', { name: 'Resources & options' })
  await expect(options.getByRole('button', { name: 'Wrap up conversation' })).toBeVisible()
  await expectNothingRemoved(missionary.page)
  await missionary.page.keyboard.press('Escape')
  await missionary.page.getByRole('button', { name: /^More directions/ }).click()
  const questions = missionary.page.getByRole('dialog', { name: 'Choose your next question' })
  await expect(questions.getByRole('button', { name: /^\d\. / })).toHaveCount(6)
  await missionary.page.keyboard.press('Escape')

  await speak(pair, 'Send question', COPY.callUsChristians)
  await speakButton(christian.page, 'Send response').click()
  for (const phone of [missionary, christian]) await expect(phone.page.getByText('Answered aloud', { exact: true })).toBeVisible()
  await expect(card.getByRole('button', { name: /^1\. Why does the Trinity matter\? \(Recommended\)/ })).toHaveAttribute('aria-pressed', 'true')

  // A refresh restores the committed turn on both phones.
  await Promise.all([missionary.page.reload(), christian.page.reload()])
  await expect(christian.page.getByText('Your partner is choosing what to ask next…')).toBeVisible()
  await expect(card.getByRole('button', { name: /^1\. Why does the Trinity matter\?/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(christian.page.getByText(COPY.whyTrinity)).toHaveCount(0)
  await closePair(pair)
})

test('Prepared questions: a restart clears an answer the Christian chose but did not send', async ({ browser }) => {
  test.setTimeout(120_000)
  const pair = await toConversation(browser, 375, 740)
  const { missionary, christian } = pair
  await speak(pair, 'Send introduction', COPY.opening)
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await christian.page.getByRole('dialog', { name: 'Help with your reply' }).getByRole('button', { name: COPY.welcome }).click()
  await expect(christian.page.locator('section').getByText(COPY.welcome)).toBeVisible()

  await christian.page.getByRole('button', { name: 'More conversation options' }).click()
  await christian.page.getByRole('dialog', { name: 'Resources & options' }).getByRole('button', { name: 'Restart round' }).click()
  await christian.page.getByRole('dialog', { name: 'Start another round?' }).getByRole('button', { name: 'Ask to restart' }).click()
  await missionary.page.getByRole('dialog', { name: 'Your partner wants to play again' }).getByRole('button', { name: 'Accept and restart' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Meet at the door')).toBeVisible()

  await readyAndOpen(pair)
  await speak(pair, 'Send introduction', COPY.opening)
  await expect(christian.page.getByText('Respond aloud in your own words…')).toBeVisible()
  await expect(christian.page.locator('section').getByText(COPY.welcome)).toHaveCount(0)
  await closePair(pair)
})
