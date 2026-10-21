import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import pg from 'pg'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/**
 * Missionary replies (schema 3.1), on two phones, against a temporary copy of
 * the draft content/scenarios/week-one-christians-too.v2.json. The copy is
 * registered under its own id with an old publication date, so it is never the
 * featured scenario, and it is deleted afterwards.
 */
const SCENARIO = `test-replies-${randomUUID().slice(0, 8)}`
const PATH = `/s/${SCENARIO}`
const COPY = {
  opening: 'Hi! We’re missionaries from The Church of Jesus Christ of Latter-day Saints.',
  christianity: 'We believe in Jesus Christ too.',
  eternalSon: 'Following Jesus is central to my faith too.',
  whoJesusIs: 'We believe Jesus Christ is the Son of God',
  callUsChristians: 'We believe in Jesus too. Would you consider us Christians?',
  clarify: 'Could you explain what you mean by that?',
} as const

const SHOTS = 'docs/screenshots/two-sided'
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
  return { missionary, christian }
}

/** The missionary speaks their current draft; it appears on both phones. */
async function speak(pair: Pair, label: string, text: string) {
  await speakButton(pair.missionary.page, label).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.locator('main').getByText(text).last()).toBeVisible()
  }
}

async function answerAloud(pair: Pair) {
  const before = await pair.missionary.page.getByText('Answered aloud', { exact: true }).count()
  await speakButton(pair.christian.page, 'Send response').click()
  await expect(pair.missionary.page.getByText('Answered aloud', { exact: true })).toHaveCount(before + 1)
}

/** Introduction, a free welcome, then the Being Christian question. */
async function askBeingChristian(pair: Pair) {
  await speak(pair, 'Send introduction', COPY.opening)
  await answerAloud(pair)
  await speak(pair, 'Send question', COPY.christianity)
}

test('Replies: the missionary answers what the Christian said before choosing what to ask next', async ({ browser }) => {
  test.setTimeout(150_000)
  const pair = await toConversation(browser, 375, 740)
  const { missionary, christian } = pair
  await askBeingChristian(pair)

  // The Christian picks an authored answer that asks a question back.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  await help.getByRole('button', { name: new RegExp(`^${COPY.eternalSon}`) }).click()
  await speakButton(christian.page, 'Send response').click()

  // The missionary gets the matched reply, privately; the Christian is told they are being answered.
  const respond = missionary.page.getByRole('group', { name: 'Respond to your partner' })
  await expect(respond.getByRole('button', { name: /^1\. Explain who Jesus is to us \(Suggested\)/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(missionary.page.locator('section').getByText(COPY.whoJesusIs)).toBeVisible()
  await expect(missionary.page.getByRole('group', { name: 'What would you like to ask next?' })).toHaveCount(0)
  await expect(christian.page.getByText('Your partner is responding to you…')).toBeVisible()
  await expect(christian.page.getByText(COPY.whoJesusIs)).toHaveCount(0)
  await shot(missionary.page, '375-01-respond-matched')
  await shot(christian.page, '375-02-christian-responding')

  // "They said something else" asks what they heard; focus moves into the new list.
  await missionary.page.getByRole('button', { name: 'They said something else' }).click()
  const heard = missionary.page.getByRole('group', { name: 'What did your partner say?' })
  await expect(heard.getByRole('button', { name: /^\d\. / })).toHaveCount(5)
  await expect(heard.getByRole('button', { name: /^1\. Asked what we believe about Jesus/ })).toBeFocused()
  await expect(speakButton(missionary.page, 'Choose how to reply')).toBeDisabled()
  await shot(missionary.page, '375-03-what-did-they-say')
  await missionary.page.keyboard.press('2')
  await expect(heard.getByRole('button', { name: /^2\. Wanted to compare what we each mean/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(speakButton(missionary.page, 'Send reply')).toBeFocused()
  await expect(speakButton(missionary.page, 'Send reply')).toHaveText('Reply')

  // Back to the suggested reply, and speak it.
  await missionary.page.getByRole('button', { name: 'Use the suggested reply' }).click()
  await expect(respond.getByRole('button', { name: /^1\. Explain who Jesus is to us/ })).toHaveAttribute('aria-pressed', 'true')
  await speak(pair, 'Send reply', COPY.whoJesusIs)
  await expect(christian.page.getByText('Reply · Being Christian')).toBeVisible()
  await expect(christian.page.getByText('Your partner is choosing how to continue…')).toBeVisible()
  await shot(christian.page, '375-04-christian-sees-reply')

  // The missionary continues with the topic's follow-up, not an unrelated topic.
  const next = missionary.page.getByRole('group', { name: 'What would you like to ask next?' })
  await expect(next.getByRole('button', { name: /^1\. Would you call us Christians\? \(Recommended\)/ })).toHaveAttribute('aria-pressed', 'true')
  await shot(missionary.page, '375-05-continue')
  await expect(speakButton(missionary.page, 'Send question')).toHaveText('Ask question')
  await speak(pair, 'Send question', COPY.callUsChristians)

  // A free answer: what did they say? The clarification hands the turn back, then returns here without itself.
  await answerAloud(pair)
  await expect(heard.getByRole('button', { name: /^4\. Something else \/ help me clarify/ })).toBeVisible()
  await heard.getByRole('button', { name: /^4\. / }).click()
  await speak(pair, 'Send question', COPY.clarify)
  await answerAloud(pair)
  await expect(heard.getByRole('button', { name: /^\d\. / })).toHaveCount(4)
  await expect(heard.getByRole('button', { name: /help me clarify/ })).toHaveCount(0)

  // Replying in their own words leaves a neutral marker on both phones.
  await heard.getByRole('button', { name: /^4\. I responded in my own words/ }).click()
  await expect(missionary.page.getByText('Reply aloud in your own words, then tap Reply.')).toBeVisible()
  await speakButton(missionary.page, 'Confirm you replied aloud').click()
  for (const phone of [missionary, christian]) await expect(phone.page.getByText('Responded aloud', { exact: true })).toBeVisible()
  await expect(next).toBeVisible()
  await shot(missionary.page, '375-06-own-words')

  // Like a messaging app: every message stays in the thread, the newest in view, and only the thread scrolls.
  for (const phone of [missionary, christian]) {
    const { page } = phone
    await expect(page.getByText(/^Earlier messages/)).toHaveCount(0)
    await expect(page.locator('main').getByText(COPY.opening)).toHaveCount(1)
    await expect(page.getByText('Responded aloud', { exact: true })).toBeInViewport()
    await expect(page.locator('header')).toBeInViewport()
    const frame = await page.locator('header').evaluate((header) => {
      const app = header.parentElement as HTMLElement
      return { overflow: app.scrollHeight - app.clientHeight }
    })
    expect(frame.overflow).toBeLessThanOrEqual(1)
    const thread = await page.locator('main').evaluate((main) => main.scrollHeight > main.clientHeight)
    expect(thread).toBe(true)
  }

  // Refreshing keeps the committed reply and the turn.
  await christian.page.reload()
  await expect(christian.page.getByText('Responded aloud', { exact: true })).toBeVisible()
  await expect(christian.page.getByText('Your partner is choosing how to continue…')).toBeVisible()

  await closePair(pair)
})

test('Replies: the reply card fits a 320px screen with Speak aloud in reach', async ({ browser }) => {
  test.setTimeout(120_000)
  const pair = await toConversation(browser, 320, 640)
  await askBeingChristian(pair)
  await answerAloud(pair)
  const { page } = pair.missionary
  await expect(page.getByRole('group', { name: 'What did your partner say?' })).toBeVisible()
  await page.getByRole('button', { name: /^1\. Asked what we believe about Jesus/ }).click()
  const send = speakButton(page, 'Send reply')
  await expect(send).toBeInViewport()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await shot(page, '320-01-what-did-they-say')
  await closePair(pair)
})
