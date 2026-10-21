import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import pg from 'pg'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/**
 * Lesson 1 (Introduction & First Vision) on two phones, against temporary
 * copies of content/scenarios/lesson-one-first-vision.v1.json and .v2.json.
 * The copies are registered under their own ids with an old publication date,
 * so they are never the featured scenario, and they are deleted afterwards.
 */
const SCENARIO = `test-lesson-${randomUUID().slice(0, 8)}`
const PATH = `/s/${SCENARIO}`
const SCENARIO_V2 = `test-lesson-v2-${randomUUID().slice(0, 8)}`
const PATH_V2 = `/s/${SCENARIO_V2}`
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
  const client = db()
  await client.connect()
  for (const [id, path] of [
    [SCENARIO, 'content/scenarios/lesson-one-first-vision.v1.json'],
    [SCENARIO_V2, 'content/scenarios/lesson-one-first-vision.v2.json'],
  ]) {
    const { $schema: _schema, status: _status, ...content } = JSON.parse(readFileSync(path, 'utf8'))
    await client.query(
      `insert into public.scenario_registry
         (scenario_id, version, slug, prompt_count, status, content, active_for_new_sessions, published_at)
       values ($1, 1, $1, 5, 'published', $2, true, '2000-01-01')`,
      [id, { ...content, id, version: 1 }],
    )
  }
  await client.end()
})

test.afterAll(async () => {
  const client = db()
  await client.connect()
  for (const id of [SCENARIO, SCENARIO_V2]) {
    await client.query('delete from public.sessions where scenario_id = $1', [id])
    await client.query('delete from public.scenario_registry where scenario_id = $1', [id])
  }
  await client.end()
})

async function shot(page: Page, name: string) {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Scrolled back through the thread, messages pass beneath the sticky, frosted role strip; then back to the latest. */
async function expectFrostedStrip(page: Page, name: string) {
  const state = await page.evaluate(() => {
    const pane = document.querySelector('[aria-label="Conversation prompts"]')!.closest('main')!
    const strip = pane.querySelector<HTMLElement>('[class*="roleStrip"]')!
    pane.scrollTop = Math.max(0, pane.scrollHeight - pane.clientHeight - 150)
    const header = document.querySelector('header')!.getBoundingClientRect()
    const box = strip.getBoundingClientRect()
    const style = getComputedStyle(strip)
    const messages = [...pane.querySelectorAll('[aria-label="Conversation prompts"] > *')]
    return {
      scrolled: pane.scrollTop > 0,
      flushWithHeader: Math.round(box.top - header.bottom) === 0,
      position: getComputedStyle(strip.parentElement!).position,
      background: style.backgroundColor,
      blur: style.backdropFilter,
      opacity: style.opacity,
      messageBeneath: messages.some((message) => {
        const rect = message.getBoundingClientRect()
        return rect.top < box.bottom && rect.bottom > box.top
      }),
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
  expect(state).toMatchObject({
    scrolled: true,
    flushWithHeader: true,
    position: 'sticky',
    background: 'rgba(249, 250, 245, 0.58)',
    blur: 'blur(8px)',
    opacity: '1',
    messageBeneath: true,
  })
  expect(state.overflow).toBeLessThanOrEqual(0)
  await shot(page, name)
  await page.evaluate(() => {
    const pane = document.querySelector('[aria-label="Conversation prompts"]')!.closest('main')!
    pane.scrollTop = pane.scrollHeight
  })
}

const speakButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/** Pairs two phones, readies both with relaxed timing, and opens the door. */
async function toConversation(browser: Browser, width: number, height: number, path = PATH): Promise<Pair> {
  const missionary = await openPhone(browser, width, height, path)
  const christian = await openPhone(browser, width, height, path)
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
  await expectFrostedStrip(christian.page, '375-07b-history-beneath-strip')

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

test('Lesson 1 v2: the five worksheet questions follow the introduction, the long fourth answer reads on a 320px phone, and the goodbye completes', async ({
  browser,
}) => {
  test.setTimeout(180_000)
  const QUESTIONS = [
    'Why is the use or non-use of the word Mormon a good thing to bring up with your Mormon friend?',
    'How many different first vision accounts does the LDS church recognize and how do they defend the differing accounts?',
    'Suppose you were to share with your Mormon friend that there were multiple first vision accounts.',
    'Given the “typical” response to multiple versions, what would be the best rejoinder?',
    'How would you respond if your Mormon friend or neighbor was unaware that there were multiple first vision accounts?',
  ]
  const pair = await toConversation(browser, 320, 640, PATH_V2)
  const { missionary, christian } = pair
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })

  await speak(pair, 'Send introduction', COPY.opening)
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await help.getByRole('button', { name: COPY.welcome }).click()
  await speakButton(christian.page, 'Send response').click()

  for (const [i, question] of QUESTIONS.entries()) {
    await speak(pair, 'Send question', question)
    await expect(missionary.page.locator('main').getByText(`Lesson 1 · Question ${i + 1}`)).toBeVisible()
    if (i === 3) {
      // The lesson answer stays hidden until asked for, and the whole of it can be read without sideways scrolling.
      await christian.page.getByRole('button', { name: 'Need help?' }).click()
      await expect(help).not.toContainText('Use a question to help move your point.')
      await help.getByRole('button', { name: 'Hint' }).click()
      await expect(help).toContainText('Tap Suggested responses to see the lesson answer.')
      await help.getByRole('button', { name: 'Suggested responses' }).click()
      const answer = help.locator('button[class*="responseChoice"]')
      await expect(answer).toHaveCount(1)
      await expect(answer).toContainText('Use a question to help move your point.')
      await expect(answer).toContainText('guide them into discovering the problem for themselves.')
      await answer.scrollIntoViewIfNeeded()
      await expect(answer).toBeInViewport({ ratio: 0.99 })
      const overflow = await christian.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(0)
      await shot(christian.page, '320-02-v2-answer-four')
      await help.getByRole('button', { name: 'Close help' }).click()
    }
    await answerWithHelp(pair)
  }

  await expect(missionary.page.locator('section').getByText(COPY.closing)).toBeVisible()
  await speakButton(missionary.page, 'Send closing').click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Until next time')).toBeVisible()
  await closePair(pair)
})
