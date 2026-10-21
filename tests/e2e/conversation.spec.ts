import { mkdirSync } from 'node:fs'
import { expect, test, type Browser, type Page } from '@playwright/test'
import { closePair, heading, openPhone, readPairCode, type Pair } from './helpers'

/** Copy from content/scenarios/week-one-christians-too.v2.json, the published version. */
const PATH = '/s/week-one-christians-too'
const COPY = {
  title: 'Week 1 · We’re Christians too',
  roles: 'Who will you play?',
  opening: 'Hi! We’re missionaries from The Church of Jesus Christ of Latter-day Saints.',
  welcome: 'Sure, I have a few minutes. I’m a Christian myself.',
  christianity: 'We believe in Jesus Christ too.',
  god: 'One difference between our beliefs is how we understand the Father and Jesus.',
  godQuote: 'the only true God',
  godPassage: 'John 17:1–5',
  godPassageText: 'These words spake Jesus',
  godAnswer:
    'I agree that Jesus and the Father are distinct. The Trinity doesn’t mean Jesus is the Father. I believe the Father, Son, and Holy Spirit are distinct persons who share the one divine being.',
  closing: 'Thanks for taking the time to talk with me.',
  reflection: 'Which question was hardest to answer?',
} as const

const SHOTS = 'docs/screenshots/redesign'
mkdirSync(SHOTS, { recursive: true })

async function shot(page: Page, name: string) {
  // Lets a sheet or dialog finish its short entrance first.
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

function speakButton(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true })
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

/** Like a messaging app: the frame stays still and only the thread scrolls. */
async function expectFrameStill(page: Page) {
  const overflow = await page.locator('header').evaluate((header) => {
    const frame = header.parentElement as HTMLElement
    return frame.scrollHeight - frame.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

/** Missionary taps their role card and gets a code; the Christian taps theirs and joins with it. */
async function pairUp(browser: Browser, width = 375, height = 740, shots?: string): Promise<Pair> {
  const missionary = await openPhone(browser, width, height, PATH)
  const christian = await openPhone(browser, width, height, PATH)
  await expect(heading(missionary.page, COPY.roles)).toBeVisible()
  if (shots) await shot(missionary.page, `${shots}-01-roles`)
  await missionary.page.getByRole('button', { name: /^Mormon missionary/ }).click()
  await expect(heading(missionary.page, 'Invite your partner')).toBeVisible()
  const code = await readPairCode(missionary.page)
  if (shots) await shot(missionary.page, `${shots}-02-invite`)

  await christian.page.getByRole('button', { name: /^Christian/ }).click()
  await expect(heading(christian.page, 'Join your partner')).toBeVisible()
  await christian.page.getByLabel('Pairing code').fill(code.replace(' ', ''))
  if (shots) await shot(christian.page, `${shots}-03-join`)
  await christian.page.getByRole('button', { name: 'Join pair' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Meet at the door')).toBeVisible()
  return { missionary, christian }
}

/** Both players tap Ready; the missionary starts the encounter. */
async function readyUp({ missionary, christian }: Pair, relaxed = false) {
  if (relaxed) await missionary.page.getByLabel('Relaxed timing — no countdown').check()
  await missionary.page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(missionary.page.getByText('You’re ready. Waiting for your partner.')).toBeVisible()
  await expect(christian.page.getByText('✓ Ready')).toBeVisible()
  await christian.page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(christian.page.getByText('Both ready. The missionary can start.')).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Start encounter' })).toHaveCount(0)
  await missionary.page.getByRole('button', { name: 'Start encounter' }).click()
}

/** The missionary knocks, the Christian opens, and both reach the conversation. */
async function openDoor({ missionary, christian }: Pair, shots?: string) {
  await expect(heading(missionary.page, 'Say “knock knock” and tap')).toBeVisible()
  await expect(heading(christian.page, 'Your visitor is at the door')).toBeVisible()
  await expect(christian.page.getByRole('button', { name: /^Knock on the door/ })).toBeDisabled()
  if (shots) await shot(missionary.page, `${shots}-05-knock`)
  await missionary.page.getByRole('button', { name: /^Knock on the door/ }).click()
  await expect(heading(christian.page, 'Open the door')).toBeVisible()
  await expect(heading(missionary.page, 'Wait for your neighbour')).toBeVisible()
  if (shots) await shot(christian.page, `${shots}-06-open`)
  await christian.page.getByRole('button', { name: /^Open the door/ }).click()
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByText('The door is open. Your conversation begins here.')).toBeVisible()
  }
}

/** The missionary speaks their current draft; it appears on both phones. */
async function speak(pair: Pair, label: string, text: string) {
  await speakButton(pair.missionary.page, label).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.locator('main').getByText(text).last()).toBeVisible()
  }
}

/** The Christian answers aloud in their own words: a neutral marker, never a transcript. */
async function answerAloud(pair: Pair) {
  const before = await pair.missionary.page.getByText('Answered aloud', { exact: true }).count()
  await speakButton(pair.christian.page, 'Send response').click()
  await expect(pair.missionary.page.getByText('Answered aloud', { exact: true })).toHaveCount(before + 1)
}

test('Conversation: two phones pair, meet at the door, talk, finish, then restart and switch roles by consent', async ({
  browser,
}) => {
  test.setTimeout(150_000)
  const pair = await pairUp(browser, 375, 740, '375')
  const { missionary, christian } = pair
  await expect(missionary.page).toHaveTitle(`${COPY.title} · Doorstep practice`)
  // Production builds have no preview switch or simulated disconnect.
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByRole('button', { name: /Disconnect|Preview|View Christian/ })).toHaveCount(0)
  }
  await shot(christian.page, '375-04-ready')
  await readyUp(pair)
  await openDoor(pair, '375')

  // Only the missionary has a draft; the Christian waits for the introduction.
  await expect(missionary.page.getByText('Your next line')).toBeVisible()
  await expect(christian.page.getByText('Your visitor will introduce themselves first…')).toBeVisible()
  await expect(speakButton(christian.page, 'Waiting for your partner')).toBeDisabled()
  await expect(christian.page.getByText(COPY.opening)).toHaveCount(0)
  await speak(pair, 'Send introduction', COPY.opening)
  await expect(speakButton(missionary.page, 'Waiting for Christian response')).toBeDisabled()

  // The Christian picks the suggested welcome, clears it, then answers in their own words.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  const help = christian.page.getByRole('dialog', { name: 'Help with your reply' })
  await expect(help).toContainText('Welcome your visitor in your own words, or use this reply.')
  await shot(christian.page, '375-08-help-welcome')
  await help.getByRole('button', { name: COPY.welcome }).click()
  await expect(help).toHaveCount(0)
  await expect(speakButton(christian.page, 'Send response')).toBeFocused()
  await expect(christian.page.locator('section').getByText(COPY.welcome)).toBeVisible()
  await expect(missionary.page.getByText(COPY.welcome)).toHaveCount(0)
  await christian.page.getByRole('button', { name: 'Clear draft' }).click()
  await expect(christian.page.getByText('Respond aloud in your own words…')).toBeVisible()
  await answerAloud(pair)
  await expect(missionary.page.getByText('Spoken response · not transcribed')).toBeVisible()

  // The choice card: the suggested question is selected, with a few other directions beside it.
  const card = missionary.page.getByRole('group', { name: 'What would you like to ask next?' })
  await expect(card.getByRole('button', { name: /^1\. Being Christian \(Recommended\)/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByRole('button', { name: /^\d\. / })).toHaveCount(3)
  await expect(missionary.page.locator('section').getByText(COPY.christianity)).toBeVisible()
  await expect(christian.page.getByRole('group', { name: 'What would you like to ask next?' })).toHaveCount(0)
  await shot(missionary.page, '375-09-choice-card')

  // More directions opens the full numbered list; Escape returns to the card.
  const more = missionary.page.getByRole('button', { name: 'More directions (2)' })
  await more.click()
  const questions = missionary.page.getByRole('dialog', { name: 'Choose your next question' })
  await expect(questions.getByRole('heading', { name: 'Choose a direction' })).toBeVisible()
  await shot(missionary.page, '375-09-questions')
  await missionary.page.keyboard.press('Escape')
  await expect(questions).toHaveCount(0)
  await expect(more).toBeFocused()

  // A number key picks a row while focus is in the card; the choice stays private until spoken.
  await card.getByRole('button', { name: /^1\. / }).focus()
  await missionary.page.keyboard.press('3')
  await expect(speakButton(missionary.page, 'Send question')).toBeFocused()
  await expect(card.getByRole('button', { name: /^3\. Godhead or Trinity\?/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(card.getByRole('button', { name: /^1\. Being Christian/ })).toHaveAttribute('aria-pressed', 'false')
  await expect(missionary.page.locator('section').getByText(COPY.god)).toBeVisible()
  await expect(christian.page.getByText(COPY.god)).toHaveCount(0)
  await speak(pair, 'Send question', COPY.god)
  await shot(missionary.page, '375-10-thread-missionary')

  // An inline KJV quotation opens the full passage; closing returns focus to the quotation.
  const quote = christian.page.getByRole('button', { name: `${COPY.godQuote} — read full KJV passage` }).last()
  await quote.click()
  const passage = christian.page.getByRole('dialog', { name: COPY.godPassage })
  await expect(passage).toContainText('King James Version')
  await expect(passage).toContainText(COPY.godPassageText)
  await shot(christian.page, '375-11-passage')
  await christian.page.keyboard.press('Escape')
  await expect(passage).toHaveCount(0)
  await expect(quote).toBeFocused()

  // A passage opened from help returns to help.
  await christian.page.getByRole('button', { name: 'Need help?' }).click()
  await expect(help.getByText('Start with a hint, or choose words you can say aloud.')).toBeVisible()
  await help.getByRole('button', { name: 'Hint' }).click()
  await expect(help.getByRole('heading', { name: 'A starting point' })).toBeVisible()
  await help.getByRole('button', { name: 'Explain the verse' }).click()
  await help.getByRole('button', { name: `${COPY.godPassage} · KJV` }).click()
  await expect(passage).toBeVisible()
  await passage.getByRole('button', { name: 'Close' }).click()
  await expect(passage).toHaveCount(0)
  await expect(help).toBeVisible()
  await expect(help.getByRole('button', { name: `${COPY.godPassage} · KJV` })).toBeFocused()
  await help.getByRole('button', { name: 'Suggested responses' }).click()
  await shot(christian.page, '375-12-help-responses')
  await help.getByRole('button', { name: COPY.godAnswer }).click()
  await speakButton(christian.page, 'Send response').click()
  await expect(missionary.page.getByText(COPY.godAnswer, { exact: true })).toBeVisible()
  await expect(missionary.page.getByText('Suggested response · confirmed aloud')).toBeVisible()
  await shot(christian.page, '375-13-thread-christian')

  // A reload returns both phones to the same conversation, without replaying the door.
  await Promise.all([missionary.page.reload(), christian.page.reload()])
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByText(COPY.godAnswer, { exact: true })).toBeVisible()
    await expect(phone.page.getByText('The door opens…')).toHaveCount(0)
  }

  // Options: prepared questions only, so no "Ask them to explain"; wrap up.
  await missionary.page.getByRole('button', { name: 'More conversation options' }).click()
  const options = missionary.page.getByRole('dialog', { name: 'Resources & options' })
  await expect(options.getByRole('link', { name: /Mormonism Chart, PDF, opens in a new tab/ })).toHaveAttribute(
    'target',
    '_blank',
  )
  await shot(missionary.page, '375-14-options')
  await expect(options.getByRole('button', { name: 'Ask them to explain' })).toHaveCount(0)
  await options.getByRole('button', { name: 'Wrap up conversation' }).click()
  await speakButton(missionary.page, 'Send closing').click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, 'Until next time')).toBeVisible()
  await shot(missionary.page, '375-15-outro')
  await missionary.page.getByRole('button', { name: 'Skip animation' }).click()
  // The Christian's goodbye plays to the end on its own.
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, 'Take a moment to reflect')).toBeVisible({ timeout: 12_000 })
    await expect(phone.page.getByText(COPY.reflection)).toBeVisible()
  }
  await shot(christian.page, '375-16-reflection')

  // Either player asks to play again; the partner must agree.
  await christian.page.getByRole('button', { name: 'Play again' }).click()
  await christian.page.getByRole('dialog', { name: 'Start another round?' }).getByRole('button', { name: 'Ask to restart' }).click()
  await expect(christian.page.getByRole('dialog', { name: 'Waiting for your partner' })).toBeVisible()
  const restart = missionary.page.getByRole('dialog', { name: 'Your partner wants to play again' })
  await expect(restart).toBeVisible()
  await shot(missionary.page, '375-17-restart-request')
  await restart.getByRole('button', { name: 'Accept and restart' }).click()
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, 'Meet at the door')).toBeVisible()
    await expect(phone.page.getByText('New round. Your roles are unchanged.')).toBeVisible()
  }

  // A fresh round, then a declined and an accepted role switch.
  await readyUp(pair, true)
  await openDoor(pair)
  await speak(pair, 'Send introduction', COPY.opening)
  await answerAloud(pair)
  await missionary.page.getByRole('button', { name: 'More conversation options' }).click()
  await options.getByRole('button', { name: 'Switch roles' }).click()
  await missionary.page.getByRole('dialog', { name: 'Switch roles?' }).getByRole('button', { name: 'Ask to switch' }).click()
  const swap = christian.page.getByRole('dialog', { name: 'Your partner wants to switch roles' })
  await expect(swap).toContainText('start at Ready as the missionary')
  await swap.getByRole('button', { name: 'Decline' }).click()
  await expect(missionary.page.getByText('Your partner declined. Continue where you left off.')).toBeVisible()
  await expect(speakButton(missionary.page, 'Send question')).toBeEnabled()

  await christian.page.getByRole('button', { name: 'More conversation options' }).click()
  await christian.page.getByRole('dialog', { name: 'Resources & options' }).getByRole('button', { name: 'Switch roles' }).click()
  await christian.page.getByRole('dialog', { name: 'Switch roles?' }).getByRole('button', { name: 'Ask to switch' }).click()
  const accept = missionary.page.getByRole('dialog', { name: 'Your partner wants to switch roles' })
  await expect(accept).toContainText('start at Ready as the Christian')
  await accept.getByRole('button', { name: 'Accept and switch' }).click()
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, 'Meet at the door')).toBeVisible()
    await expect(phone.page.getByText('Roles switched. Get ready for a new round.')).toBeVisible()
  }
  await expect(missionary.page.getByRole('banner').locator('..').getByText('Christian (You)').first()).toBeVisible()
  await expect(christian.page.getByText('Missionary (You)').first()).toBeVisible()
  await expect(missionary.page.getByText('Missionary (You)')).toHaveCount(0)
  await closePair(pair)
})

test('Conversation: a missed knock keeps the pair, and either retry path continues', async ({ browser }) => {
  const pair = await pairUp(browser)
  const { missionary, christian } = pair
  await readyUp(pair)
  await expect(heading(missionary.page, 'Say “knock knock” and tap')).toBeVisible()
  await expect(missionary.page.getByRole('timer', { name: 'Seconds remaining' })).toBeVisible()
  await expect(heading(missionary.page, 'Missed it? Try again.')).toBeVisible({ timeout: 9_000 })
  await expect(christian.page.getByText('Waiting for Missionary to retry.')).toBeVisible()
  await shot(missionary.page, '375-07-missed')
  await missionary.page.getByRole('button', { name: 'Try without timer' }).click()
  await expect(missionary.page.getByRole('timer', { name: 'No time limit' })).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Knock on the door', exact: true }).click()
  await expect(christian.page.getByRole('timer', { name: 'No time limit' })).toBeVisible()
  await christian.page.getByRole('button', { name: 'Open the door', exact: true }).click()
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByText('The door is open. Your conversation begins here.')).toBeVisible()
  }
  await closePair(pair)
})

test('Conversation: leaving needs confirmation and ends the session for both players', async ({ browser }) => {
  const pair = await pairUp(browser)
  const { missionary, christian } = pair
  await christian.page.getByRole('button', { name: 'Leave', exact: true }).click()
  const confirm = christian.page.getByRole('dialog', { name: 'End this session?' })
  await expect(confirm).toContainText('This ends the session for both players and returns you to role selection.')
  await confirm.getByRole('button', { name: 'Keep playing' }).click()
  await expect(confirm).toHaveCount(0)
  await christian.page.getByRole('button', { name: 'Leave', exact: true }).click()
  await confirm.getByRole('button', { name: 'End session' }).click()
  await expect(heading(christian.page, COPY.roles)).toBeVisible()
  await expect(christian.page.getByText('Session ended for both players.')).toBeVisible()
  await expect(heading(missionary.page, COPY.roles)).toBeVisible()
  await expect(missionary.page.getByText('Your partner ended the session.')).toBeVisible()
  await closePair(pair)
})

test('Conversation: Change roles closes an unused code and returns to the role cards', async ({ browser }) => {
  const phone = await openPhone(browser, 375, 740, PATH)
  await phone.page.getByRole('button', { name: /^Mormon missionary/ }).click()
  await expect(heading(phone.page, 'Invite your partner')).toBeVisible()
  await phone.page.getByRole('button', { name: 'Back' }).click()
  await expect(phone.page.getByRole('dialog', { name: 'End this session?' })).toContainText(
    'This closes your pairing code and returns you to role selection.',
  )
  await phone.page.getByRole('button', { name: 'Keep playing' }).click()
  await phone.page.getByRole('button', { name: 'Change roles' }).click()
  await expect(heading(phone.page, COPY.roles)).toBeVisible()
  await phone.context.close()
})

test('Conversation: six pairs run at once without crossing over', async ({ browser }) => {
  test.setTimeout(180_000)
  const runPair = async (index: number) => {
    const pair = await pairUp(browser, 375, 740)
    await readyUp(pair, true)
    await openDoor(pair)
    await speak(pair, 'Send introduction', COPY.opening)
    await answerAloud(pair)
    // Pairs choose different directions; each thread holds only its own.
    const direction = index % 2 === 0 ? /^1\. Being Christian/ : /^3\. Godhead or Trinity\?/
    await pair.missionary.page.getByRole('group', { name: 'What would you like to ask next?' }).getByRole('button', { name: direction }).click()
    await speak(pair, 'Send question', index % 2 === 0 ? COPY.christianity : COPY.god)
    await expect(pair.christian.page.getByText(index % 2 === 0 ? COPY.god : COPY.christianity)).toHaveCount(0)
    await answerAloud(pair)
    await pair.missionary.page.getByRole('button', { name: 'More conversation options' }).click()
    await pair.missionary.page.getByRole('dialog', { name: 'Resources & options' }).getByRole('button', { name: 'Wrap up conversation' }).click()
    await speakButton(pair.missionary.page, 'Send closing').click()
    for (const phone of [pair.missionary, pair.christian]) {
      await phone.page.getByRole('button', { name: 'Skip animation' }).click()
      await expect(heading(phone.page, 'Take a moment to reflect')).toBeVisible()
    }
    await closePair(pair)
  }
  await Promise.all([0, 1, 2, 3, 4, 5].map(runPair))
})

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 430, height: 900 },
  { width: 1280, height: 800 },
]

for (const viewport of VIEWPORTS) {
  test(`Conversation screens fit a ${viewport.width}px wide screen`, async ({ browser }) => {
    test.setTimeout(120_000)
    const name = String(viewport.width)
    const pair = await pairUp(browser, viewport.width, viewport.height, name)
    const { missionary, christian } = pair
    for (const page of [missionary.page, christian.page]) await expectNoHorizontalOverflow(page)
    await shot(christian.page, `${name}-04-ready`)
    await readyUp(pair)
    await openDoor(pair, name)
    await speak(pair, 'Send introduction', COPY.opening)
    await answerAloud(pair)
    await shot(missionary.page, `${name}-10-thread-missionary`)
    for (const page of [missionary.page, christian.page]) {
      await expectNoHorizontalOverflow(page)
      await expectFrameStill(page)
      // Controls only; inline KJV quotations are part of the running text.
      const heights = await page
        .locator('section button:not([aria-label$="read full KJV passage"])')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height).filter((height) => height > 0))
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(36)
      // The send control stays compact and right-aligned.
      const send = await page.locator('button[class*="composeSend"]').evaluate((el) => {
        const box = el.getBoundingClientRect()
        const composer = el.closest('[class*="composeBox"]')?.getBoundingClientRect()
        return { width: box.width, gapToComposerEdge: composer ? composer.right - box.right : Infinity }
      })
      expect(send.width).toBeLessThan(Math.min(240, viewport.width * 0.6))
      expect(send.gapToComposerEdge).toBeLessThan(24)
    }
    await expect(missionary.page.locator('button[class*="composeSend"]')).toHaveText('Ask question')
    await expect(christian.page.locator('button[class*="composeSend"]')).toHaveText('Answer question')
    // The send button stays reachable beside the choice card.
    await expect(speakButton(missionary.page, 'Send question')).toBeInViewport()
    await missionary.page.getByRole('button', { name: /^More directions/ }).click()
    await expectNoHorizontalOverflow(missionary.page)
    await shot(missionary.page, `${name}-09-questions`)
    await closePair(pair)
  })
}

test('Conversation stays usable at 200% text size on a 320px screen', async ({ browser }) => {
  const pair = await pairUp(browser, 320, 640)
  const { missionary, christian } = pair
  for (const page of [missionary.page, christian.page]) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
  }
  await shot(missionary.page, '320-200pct-04-ready')
  await readyUp(pair, true)
  await openDoor(pair)
  await speak(pair, 'Send introduction', COPY.opening)
  await shot(christian.page, '320-200pct-10-thread-christian')
  for (const page of [missionary.page, christian.page]) await expectNoHorizontalOverflow(page)
  const send = speakButton(christian.page, 'Send response')
  await send.scrollIntoViewIfNeeded()
  await send.click()
  await expect(missionary.page.getByText('Answered aloud', { exact: true })).toBeVisible()
  // With large text the frame scrolls; the choice card and Speak aloud stay reachable.
  await expect(missionary.page.getByRole('group', { name: 'What would you like to ask next?' })).toBeVisible()
  const ask = speakButton(missionary.page, 'Send question')
  await ask.scrollIntoViewIfNeeded()
  await expect(ask).toBeInViewport()
  await expectNoHorizontalOverflow(missionary.page)
  await shot(missionary.page, '320-200pct-09-choice-card')
  await closePair(pair)
})
