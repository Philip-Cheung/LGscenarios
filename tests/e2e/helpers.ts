import { expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'

export const SCENARIO_PATH = '/s/sample-doorstep'
/** Copy from content/scenarios/sample-doorstep.v6.json, the published scenario the tests pair on. */
export const DOORSTEP = {
  sceneTitle: 'A Mormon missionary at your door',
  opening: 'Hello. May I ask you one short question?',
  questions: {
    hope: {
      prompt: 'What gives you hope?',
      answer:
        'My hope is rooted in Jesus. Prayer and the people in my church help me remember that difficult seasons aren’t the end of the story.',
    },
    faith: {
      prompt: 'What does faith mean to you?',
      answer:
        'For me, faith means trusting God even when I don’t have every answer. Following Jesus helps me put that trust into practice through how I treat other people.',
    },
  },
  closing: 'Thank you for sharing. I’m glad we had a chance to talk.',
  reflection: 'What helped you explain your beliefs clearly and keep the conversation respectful?',
} as const

/** Headings shared by every scenario. */
export const SCREENS = {
  welcome: 'Practice talking with Mormon missionaries.',
  chooseRole: 'Select a role',
  invite: 'Invite your partner',
  join: 'Find your practice partner.',
  paired: 'A little practice, together.',
  readyTogether: 'A moment to settle in.',
  opening: 'Start with a hello',
  partnerTurn: 'Your partner’s turn',
  questions: 'What would you like to ask?',
  response: 'Respond in your own words.',
  listening: 'Make room to listen',
  closing: 'End with a little kindness.',
  wrapUp: 'A moment to wrap up',
  complete: 'Take a moment to reflect.',
} as const

/** Accessible names of the role radios; each ends with the role's short name. */
export const ROLE_NAMES = {
  Missionary: /Mormon$/,
  Christian: /Christian$/,
} as const

export const PARTNER_CHOOSING = 'They’re choosing a question.'

export type QuestionKey = keyof typeof DOORSTEP.questions

export interface Phone {
  context: BrowserContext
  page: Page
}

export interface Pair {
  missionary: Phone
  christian: Phone
}

/** One isolated browser context per phone: separate storage, separate anonymous user. */
export async function openPhone(browser: Browser, width = 375, height = 740, path = SCENARIO_PATH): Promise<Phone> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(path)
  return { context, page }
}

/** Reads the pairing code shown on the creator's phone, without logging it. */
export async function readPairCode(page: Page): Promise<string> {
  const visible = page.getByTestId('pair-code')
  await expect(visible).toHaveText(/^[0-9]{3} [0-9]{3}$/)
  return (await visible.textContent()) ?? ''
}

/** From the welcome screen, creates a practice in the chosen role and returns its code. */
export async function createPractice(page: Page, role: 'Missionary' | 'Christian' = 'Missionary'): Promise<string> {
  await page.getByRole('button', { name: 'Create a room' }).click()
  await expect(heading(page, SCREENS.chooseRole)).toBeVisible()
  await page.getByRole('radio', { name: ROLE_NAMES[role] }).check()
  await page.getByRole('button', { name: 'Get a pairing code' }).click()
  await expect(heading(page, SCREENS.invite)).toBeVisible()
  return readPairCode(page)
}

/** From the welcome screen, or the code form after an error, joins with a code. */
export async function joinPractice(page: Page, code: string) {
  const join = page.getByRole('button', { name: 'Join your partner' })
  const field = page.getByLabel('Pairing code')
  await expect(join.or(field)).toBeVisible()
  if (await join.isVisible()) await join.click()
  await field.fill(code)
  await page.getByRole('button', { name: 'Join practice' }).click()
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name })
}

/** Opens the "···" menu and chooses one of its items. */
export async function chooseMenuItem(page: Page, item: 'Restart practice' | 'Leave session' | 'Pause motion') {
  await page.getByLabel('Session controls').click()
  await page.locator('details[open]').getByRole('button', { name: item }).click()
}

/** Pairs two fresh phones on the paired summary, before the missionary starts. */
export async function pairPhones(browser: Browser, width = 375, height = 740, path = SCENARIO_PATH): Promise<Pair> {
  const missionary = await openPhone(browser, width, height, path)
  const christian = await openPhone(browser, width, height, path)
  const code = await createPractice(missionary.page)
  await joinPractice(christian.page, code)
  for (const phone of [missionary, christian]) await expect(heading(phone.page, SCREENS.paired)).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Start practice' })).toHaveCount(0)
  return { missionary, christian }
}

/** The creator, here the missionary, taps Start practice; both phones show the scene. */
export async function startPractice(pair: Pair, sceneTitles: { missionary: string; christian: string }) {
  await pair.missionary.page.getByRole('button', { name: 'Start practice' }).click()
  await expect(heading(pair.missionary.page, sceneTitles.missionary)).toBeVisible()
  await expect(heading(pair.christian.page, sceneTitles.christian)).toBeVisible()
}

/** Pairs two fresh phones on the scene screen, before either player is ready. */
export async function pairOnScene(
  browser: Browser,
  width = 375,
  height = 740,
  path = SCENARIO_PATH,
  sceneTitles: { missionary: string; christian: string } = {
    missionary: DOORSTEP.sceneTitle,
    christian: DOORSTEP.sceneTitle,
  },
): Promise<Pair> {
  const pair = await pairPhones(browser, width, height, path)
  await startPractice(pair, sceneTitles)
  return pair
}

/** Both players tap Ready on the scene; both reach Ready together. */
export async function bothReady(pair: Pair) {
  await pair.missionary.page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(pair.missionary.page.getByRole('button', { name: 'You’re ready · Waiting for partner' })).toBeDisabled()
  await expect(pair.christian.page.getByText('Your partner is ready.')).toBeVisible()
  await pair.christian.page.getByRole('button', { name: 'I’m ready' }).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(heading(phone.page, SCREENS.readyTogether)).toBeVisible()
  }
}

/** Pairs two fresh phones and brings both to Ready together. */
export async function startPair(browser: Browser, width = 375, height = 740): Promise<Pair> {
  const pair = await pairOnScene(browser, width, height)
  await bothReady(pair)
  await expect(pair.christian.page.getByRole('button', { name: 'Begin conversation' })).toHaveCount(0)
  return pair
}

/** Begin, then say the opening line; ends on question selection. */
export async function walkToQuestions(pair: Pair, opening: string = DOORSTEP.opening) {
  const { missionary, christian } = pair
  await missionary.page.getByRole('button', { name: 'Begin conversation' }).click()
  await expect(heading(missionary.page, SCREENS.opening)).toBeVisible()
  await expect(missionary.page.getByText(opening)).toBeVisible()
  await expect(heading(christian.page, SCREENS.partnerTurn)).toBeVisible()
  await missionary.page.getByRole('button', { name: 'I’ve said it' }).click()
  await expectChoosing(pair)
}

/** The missionary sees the questions; the Christian sees none of them. */
export async function expectChoosing(pair: Pair) {
  await expect(heading(pair.missionary.page, SCREENS.questions)).toBeVisible()
  await expect(pair.christian.page.getByText(PARTNER_CHOOSING)).toBeVisible()
  for (const question of Object.values(DOORSTEP.questions)) {
    await expect(pair.christian.page.getByText(question.prompt)).toHaveCount(0)
  }
}

/** The example answer on the Christian's phone: the toggle and the readable copy it controls. */
export async function exampleAnswer(page: Page): Promise<{ toggle: Locator; readable: Locator }> {
  const toggle = page.getByRole('button', { name: /^(Reveal|Hide) example answer$/ })
  const id = await toggle.getAttribute('aria-controls')
  return { toggle, readable: page.locator(`[id="${id}"]`) }
}

/** The missionary chooses and asks a question; the Christian sees it with the example answer concealed. */
export async function askQuestion(pair: Pair, key: QuestionKey) {
  const { missionary } = pair
  const question = DOORSTEP.questions[key]
  await missionary.page.getByRole('radio', { name: new RegExp(escapeRegExp(question.prompt)) }).check()
  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await expectResponse(pair, question.prompt, question.answer)
}

/** Only the Christian has the example answer, and its readable copy is hidden until revealed. */
export async function expectResponse(pair: Pair, prompt: string, answer: string) {
  const { missionary, christian } = pair
  await expect(heading(missionary.page, SCREENS.listening)).toBeVisible()
  await expect(heading(christian.page, SCREENS.response)).toBeVisible()
  await expect(christian.page.getByText(prompt)).toBeVisible()
  const { toggle, readable } = await exampleAnswer(christian.page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(readable).toBeHidden()
  await expect(christian.page.locator('[aria-hidden="true"]').filter({ hasText: answer })).toBeVisible()
  await expect(missionary.page.getByText(answer)).toHaveCount(0)
  await expect(missionary.page.getByRole('button', { name: /example answer/i })).toHaveCount(0)
  await expect(christian.page.getByRole('button', { name: /asked it|closing|finish/i })).toHaveCount(0)
}

/** The Christian finishes sharing; both return to question selection. */
export async function shareComplete(pair: Pair) {
  await pair.christian.page.getByRole('button', { name: 'I’ve shared my thoughts' }).click()
  await expectChoosing(pair)
}

export async function finishConversation(pair: Pair, closing: string = DOORSTEP.closing) {
  const { missionary, christian } = pair
  await missionary.page.getByRole('button', { name: 'Move to closing' }).click()
  await expect(heading(missionary.page, SCREENS.closing)).toBeVisible()
  await expect(missionary.page.getByText(closing)).toBeVisible()
  await expect(heading(christian.page, SCREENS.wrapUp)).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Finish practice' }).click()
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, SCREENS.complete)).toBeVisible()
  }
}

export async function closePair(pair: Pair) {
  await Promise.all([pair.missionary.context.close(), pair.christian.context.close()])
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
