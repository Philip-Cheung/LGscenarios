import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const SCENARIO_PATH = '/s/sample-doorstep'
/** Copy from content/scenarios/sample-doorstep.v3.json, the published scenario the tests pair on. */
export const DOORSTEP = {
  missionaryScene: 'At a front door',
  christianScene: 'At home',
  initiatorPrompt: 'You have arrived at the front door.',
  initiatorAction: 'Knock on the door',
  receiverPrompt: 'Someone is knocking at your door.',
  receiverAction: 'Open the door',
  opening: 'Hello. May I ask you one short question?',
  questions: {
    hope: {
      title: 'What gives you hope?',
      script: 'What gives you hope when life is hard?',
      hint: 'Keep it short and personal.',
      answer: 'I would keep my answer short and clear.',
    },
    faith: {
      title: 'What does faith mean to you?',
      script: 'What does faith mean to you?',
      answer: 'I would answer in one or two sentences, in my own words.',
    },
  },
  followUp: {
    label: 'Ask them to add more',
    script: 'What would you add to that?',
    answer: 'I would add one personal example.',
  },
  closing: 'Thank you for your time. Have a good afternoon.',
} as const

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

/** Reads the pairing code shown on the missionary's phone, without logging it. */
export async function readPairCode(page: Page): Promise<string> {
  const visible = page.getByTestId('pair-code').locator('[aria-hidden="true"]')
  await expect(visible).toHaveText(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/)
  return (await visible.textContent()) ?? ''
}

export async function chooseMissionary(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Mormon missionary' }).click()
  await expect(page.getByRole('heading', { name: 'Share this code with your partner' })).toBeVisible()
  return readPairCode(page)
}

export async function joinAsChristian(page: Page, code: string) {
  await page.getByRole('button', { name: /^Christian/ }).click()
  await page.getByLabel('Pair code').fill(code)
  await page.getByRole('button', { name: 'Join' }).click()
}

export function heading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name })
}

/** Pairs two fresh phones on the scene screen, before either player is ready. */
export async function pairOnScene(
  browser: Browser,
  width = 375,
  height = 740,
  path = SCENARIO_PATH,
  scenes: { missionary: string; christian: string } = {
    missionary: DOORSTEP.missionaryScene,
    christian: DOORSTEP.christianScene,
  },
): Promise<Pair> {
  const missionary = await openPhone(browser, width, height, path)
  const christian = await openPhone(browser, width, height, path)
  const code = await chooseMissionary(missionary.page)
  await joinAsChristian(christian.page, code)
  await expect(heading(missionary.page, scenes.missionary)).toBeVisible()
  await expect(heading(christian.page, scenes.christian)).toBeVisible()
  return { missionary, christian }
}

/** Both players tap Ready. */
export async function bothReady(pair: Pair) {
  await pair.missionary.page.getByRole('button', { name: 'I’m ready' }).click()
  await expect(pair.missionary.page.getByText('Waiting for your partner to get ready…')).toBeVisible()
  await expect(pair.christian.page.getByText('Your partner is ready.')).toBeVisible()
  await pair.christian.page.getByRole('button', { name: 'I’m ready' }).click()
}

/** Pairs two fresh phones and brings both to the doorstep knock. */
export async function startPair(browser: Browser, width = 375, height = 740): Promise<Pair> {
  const pair = await pairOnScene(browser, width, height)
  await bothReady(pair)
  await expect(heading(pair.missionary.page, DOORSTEP.initiatorPrompt)).toBeVisible()
  await expect(heading(pair.christian.page, 'Waiting for your partner')).toBeVisible()
  return pair
}

/** Knock, open, and say the opening line; ends on question selection. */
export async function walkToQuestions(pair: Pair) {
  const { missionary, christian } = pair
  await missionary.page.getByRole('button', { name: DOORSTEP.initiatorAction }).click()
  await expect(heading(christian.page, DOORSTEP.receiverPrompt)).toBeVisible()
  await christian.page.getByRole('button', { name: DOORSTEP.receiverAction }).click()
  await expect(heading(missionary.page, DOORSTEP.opening)).toBeVisible()
  await expect(heading(christian.page, 'Listen to your partner')).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expectChoosing(pair)
}

export async function expectChoosing(pair: Pair) {
  await expect(heading(pair.missionary.page, 'Choose a question')).toBeVisible()
  await expect(heading(pair.christian.page, 'Your partner is choosing a question')).toBeVisible()
  for (const question of Object.values(DOORSTEP.questions)) {
    await expect(pair.christian.page.getByText(question.title)).toHaveCount(0)
  }
}

/** The missionary chooses and asks a question; the Christian sees it with the answer still concealed. */
export async function askQuestion(pair: Pair, key: QuestionKey) {
  const { missionary, christian } = pair
  const question = DOORSTEP.questions[key]
  await missionary.page.getByRole('button', { name: question.title }).click()
  await expect(heading(missionary.page, question.script)).toBeVisible()
  await expect(heading(christian.page, 'Listen for your partner’s question')).toBeVisible()
  await expect(christian.page.getByText(question.script)).toHaveCount(0)

  await missionary.page.getByRole('button', { name: 'Question asked' }).click()
  await expectDiscussion(pair, question.script, question.answer)
}

/** Shared discussion beat: only the Christian sees the help, and the answer is not in the page until revealed. */
export async function expectDiscussion(pair: Pair, script: string, answer: string) {
  await expect(heading(pair.missionary.page, 'Listen to their answer')).toBeVisible()
  await expect(heading(pair.christian.page, script)).toBeVisible()
  await expect(pair.christian.page.getByRole('button', { name: 'Reveal answer' })).toBeVisible()
  await expect(pair.christian.page.getByText(answer)).toHaveCount(0)
  await expect(pair.missionary.page.getByText(answer)).toHaveCount(0)
  await expect(pair.missionary.page.getByRole('button', { name: /answer|hint/i })).toHaveCount(0)
  await expect(pair.christian.page.getByRole('button', { name: /question asked|finish|choose/i })).toHaveCount(0)
}

export async function finishConversation(pair: Pair) {
  await pair.missionary.page.getByRole('button', { name: 'Finish conversation' }).click()
  await pair.missionary.page.getByRole('alertdialog').getByRole('button', { name: 'Finish', exact: true }).click()
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.getByRole('heading', { name: 'Conversation complete' })).toBeVisible()
  }
}

export async function closePair(pair: Pair) {
  await Promise.all([pair.missionary.context.close(), pair.christian.context.close()])
}
