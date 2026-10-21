import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import pg from 'pg'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/**
 * Lesson 1 (Introduction & First Vision) on two phones, against a temporary
 * copy of content/scenarios/lesson-one-first-vision.v1.json. The copy is
 * registered under its own id with an old publication date, so it is never the
 * featured scenario, and it is deleted afterwards.
 */
const SCENARIO = `test-lesson-${randomUUID().slice(0, 8)}`
const PATH = `/s/${SCENARIO}`
const COPY = {
  opening: 'Hi! We’re missionaries from The Church of Jesus Christ of Latter-day Saints. Do you have a few minutes to talk about our beliefs?',
  welcome: 'Sure, I have a few minutes. I’m a Christian myself.',
  churchName: 'You might know us as Mormons.',
  churchNameAnswer: 'I remember the Church promoting “I’m a Mormon.”',
  churchNameNote: 'The course uses this change to raise a question about guidance from Church leaders.',
  accounts: 'Joseph Smith said he prayed after reading James 1:5',
  gospels: 'The four Gospels don’t all include the same details about Jesus.',
  age: 'Joseph told the story at different times and to different people.',
  ageEvidence: 'A scribe added wording to the 1832 account placing Joseph in his “sixteenth year,” which means age 15.',
  unfamiliar: 'I know the usual First Vision story. I didn’t know there were other written accounts.',
  closing: 'Thanks for talking with me. I’ve enjoyed hearing what you think. Have a good evening!',
  reflection: 'Which course point do you feel more ready to explain now?',
  readingUrl: 'https://www.churchofjesuschrist.org/study/manual/gospel-topics-essays/first-vision-accounts?lang=eng',
} as const
const INSTRUCTIONS = {
  missionary: 'Read this to your partner. Then tap Speak aloud.',
  christianIntro: 'Answer in your own words. Tap Need help? if you’d like a suggested answer.',
  christianDraft: 'When you’ve answered, tap Speak aloud.',
  closing: 'Say goodbye to your partner. Then tap Speak aloud to finish.',
  cue: 'It’s your turn again. Your next line is ready below.',
  finishing: 'Your partner is finishing the conversation.',
} as const

const SHOTS = 'docs/screenshots/lesson-one'
mkdirSync(SHOTS, { recursive: true })

const db = () => new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  const file = JSON.parse(readFileSync('content/scenarios/lesson-one-first-vision.v1.json', 'utf8'))
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

/** The missionary confirms their draft; it then appears on both phones. */
async function speak(pair: Pair, label: string, text: string) {
  await expect(speakButton(pair.missionary.page, label)).toHaveText('Speak aloud')
  await speakButton(pair.missionary.page, label).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.locator('main').getByText(text).last()).toBeVisible()
  }
}

/** The Christian picks the one suggested answer privately, then confirms it. */
async function answerWithHelp({ missionary, christian }: Pair) {
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  const answers = help.locator('button[class*="responseChoice"]')
  await expect(answers).toHaveCount(1)
  await answers.first().click()
  await expect(christian.page.getByText(INSTRUCTIONS.christianDraft)).toBeVisible()
  await expect(speakButton(missionary.page, 'Waiting for Christian response')).toBeDisabled()
  await speakButton(christian.page, 'Send response').click()
  await expect(speakButton(christian.page, 'Waiting for your partner')).toBeDisabled()
}

test('Lesson 1: the introduction teaches the controls, five exchanges follow in order, and the goodbye completes for both', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const pair = await toConversation(browser, 375, 740)
  const { missionary, christian } = pair
  const card = missionary.page.getByRole('group', { name: 'What would you like to say next?' })
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })
  await expect(missionary.page).toHaveTitle('Introduction & First Vision · Doorstep practice')

  // The introduction is the missionary's private draft, with the instruction to read it, then tap Speak aloud.
  await expect(missionary.page.locator('section').getByText(COPY.opening)).toBeVisible()
  await expect(missionary.page.getByText(INSTRUCTIONS.missionary)).toBeVisible()
  await expect(christian.page.getByText(COPY.opening)).toHaveCount(0)
  await expect(christian.page.getByText('Your visitor will introduce themselves first…')).toBeVisible()
  await shot(missionary.page, '375-01-introduction')
  await speak(pair, 'Send introduction', COPY.opening)

  // The Christian is told how to answer and where help is; a chosen answer stays private until confirmed.
  await expect(christian.page.getByText(INSTRUCTIONS.christianIntro)).toBeVisible()
  await expect(speakButton(christian.page, 'Send response')).toHaveText('Speak aloud')
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: COPY.welcome }).click()
  await expect(christian.page.getByText(INSTRUCTIONS.christianDraft)).toBeVisible()
  await expect(missionary.page.getByText(COPY.welcome)).toHaveCount(0)
  await shot(christian.page, '375-02-christian-answer-ready')
  await speakButton(christian.page, 'Send response').click()

  // A one-time cue: the turn is back, and the first exchange is ready and private.
  await expect(missionary.page.getByText(INSTRUCTIONS.cue)).toBeVisible()
  await expect(card.getByRole('button', { name: /^1\. Why did the naming guidance change\? \(Recommended\)/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(missionary.page.getByText(INSTRUCTIONS.missionary)).toBeVisible()
  await expect(christian.page.getByText(COPY.churchName)).toHaveCount(0)
  await expect(christian.page.getByText('Your partner is choosing what to say next…')).toBeVisible()
  await shot(missionary.page, '375-03-first-exchange-ready')
  await speak(pair, 'Send question', COPY.churchName)
  await expect(missionary.page.getByText(INSTRUCTIONS.cue)).toHaveCount(0)

  // The caption opens the Book of Mormon passage, labelled as such.
  await christian.page.getByRole('button', { name: '3 Nephi 27:7–8 · Book of Mormon — read the passage' }).click()
  const nephi = christian.page.getByRole('dialog', { name: '3 Nephi 27:7–8' })
  await expect(nephi).toContainText('Book of Mormon')
  await expect(nephi).not.toContainText('King James')
  await expect(nephi).toContainText('ye shall call the church in my name')
  await nephi.getByRole('button', { name: 'Close' }).click()

  // Help is private and hidden until asked for: hint, one answer, the learning note, and the KJV support passage.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: 'Hint' }).click()
  await expect(help).toContainText('Remember the earlier “I’m a Mormon” campaign.')
  await expect(help).not.toContainText(COPY.churchNameNote)
  await help.getByRole('button', { name: 'Learning note' }).click()
  await expect(help).toContainText(COPY.churchNameNote)
  await shot(christian.page, '375-04-learning-note')
  await help.getByRole('button', { name: 'Explain the verse' }).click()
  await expect(help.getByRole('button', { name: '1 Peter 3:13–16 · KJV' })).toBeVisible()
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  await expect(help.locator('button[class*="responseChoice"]')).toContainText(COPY.churchNameAnswer)
  // Closing help without choosing keeps the turn as it was.
  await help.getByRole('button', { name: 'Close help' }).click()
  await expect(help).toHaveCount(0)
  await expect(christian.page.getByText('Respond aloud in your own words…')).toBeVisible()
  await expect(speakButton(missionary.page, 'Waiting for Christian response')).toBeDisabled()
  await answerWithHelp(pair)

  // Exchange 2: the quoted James 1:5 opens James 1:2–6 in the KJV. The Christian answers in their own words.
  await expect(card.getByRole('button', { name: /^1\. How many First Vision accounts are there\? \(Recommended\)/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await speak(pair, 'Send question', COPY.accounts)
  await christian.page.getByRole('button', { name: 'If any of you lack wisdom, let him ask of God. — read full KJV passage' }).click()
  const james = christian.page.getByRole('dialog', { name: 'James 1:2–6' })
  await expect(james).toContainText('King James Version')
  await james.getByRole('button', { name: 'Close' }).click()
  await speakButton(christian.page, 'Send response').click()
  for (const phone of [missionary, christian]) await expect(phone.page.getByText('Answered aloud', { exact: true })).toBeVisible()

  // Exchange 3: Luke 1:1–4 is open to both roles from the caption.
  await speak(pair, 'Send question', COPY.gospels)
  await missionary.page.getByRole('button', { name: 'Luke 1:1–4 · KJV — read the passage' }).click()
  await expect(missionary.page.getByRole('dialog', { name: 'Luke 1:1–4' })).toContainText('most excellent Theophilus')
  await missionary.page.getByRole('dialog', { name: 'Luke 1:1–4' }).getByRole('button', { name: 'Close' }).click()
  await answerWithHelp(pair)

  // Exchange 4: the evidence panel states the age wording accurately.
  await speak(pair, 'Send question', COPY.age)
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: 'Hint' }).click()
  await help.getByRole('button', { name: 'What do the accounts say?' }).click()
  await expect(help).toContainText(COPY.ageEvidence)
  await shot(christian.page, '375-05-evidence')
  await help.getByRole('button', { name: 'Close help' }).click()
  await answerWithHelp(pair)

  // Exchange 5: the reading link points to the Church’s own accounts.
  await speak(pair, 'Send question', COPY.unfamiliar)
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: 'Hint' }).click()
  await expect(help.getByRole('link', { name: 'Read the accounts and the Church’s explanation, opens in a new tab' })).toHaveAttribute(
    'href',
    COPY.readingUrl,
  )
  await help.getByRole('button', { name: 'Close help' }).click()
  await answerWithHelp(pair)

  // After the fifth exchange, the wrap-up is prepared automatically, with no menu visit or extra button.
  await expect(card).toHaveCount(0)
  await expect(missionary.page.locator('section').getByText(COPY.closing)).toBeVisible()
  await expect(missionary.page.getByText(INSTRUCTIONS.closing)).toBeVisible()
  await expect(christian.page.getByText(INSTRUCTIONS.finishing)).toBeVisible()
  await expect(christian.page.getByText(COPY.closing)).toHaveCount(0)
  await shot(missionary.page, '375-06-wrap-up')
  await shot(christian.page, '375-07-partner-finishing')

  // A refresh keeps the prepared wrap-up.
  await Promise.all([missionary.page.reload(), christian.page.reload()])
  await expect(missionary.page.locator('section').getByText(COPY.closing)).toBeVisible()
  await expect(christian.page.getByText(INSTRUCTIONS.finishing)).toBeVisible()

  // The goodbye completes the session for both, and a refresh mid-animation still reaches the reflection.
  await expect(speakButton(missionary.page, 'Send closing')).toHaveText('Speak aloud')
  await speakButton(missionary.page, 'Send closing').click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Until next time')).toBeVisible()
  await christian.page.reload()
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, 'Take a moment to reflect')).toBeVisible({ timeout: 15_000 })
    await expect(phone.page.getByText(COPY.reflection)).toBeVisible()
  }
  await shot(christian.page, '375-08-reflection')
  await closePair(pair)
})

test('Lesson 1: the instructions fit a 320px screen without sideways scrolling', async ({ browser }) => {
  test.setTimeout(120_000)
  const pair = await toConversation(browser, 320, 640)
  const { missionary, christian } = pair
  await expect(missionary.page.getByText(INSTRUCTIONS.missionary)).toBeVisible()
  await speak(pair, 'Send introduction', COPY.opening)
  await expect(christian.page.getByText(INSTRUCTIONS.christianIntro)).toBeVisible()
  await shot(christian.page, '320-01-christian-instruction')
  for (const phone of [missionary, christian]) {
    const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  }
  await closePair(pair)
})
