import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const SCENARIO_PATH = '/s/sample-doorstep'
export const PROMPTS = [
  {
    text: 'Hello. May I ask you one short question?',
    answer: 'Yes. Go ahead.',
    wait: 'Stop and allow them to respond.',
  },
  {
    text: 'What would you add to that?',
    answer: 'I would keep my answer short and clear.',
  },
  {
    choosing: 'Your partner is choosing a follow-up.',
    branchLabel: 'They agree',
    response: 'Thank you. I will keep this short.',
    answer: 'That sounds fine.',
    unused: 'Thank you for telling me. I will pause here.',
  },
] as const

export interface Phone {
  context: BrowserContext
  page: Page
}

export interface Pair {
  missionary: Phone
  christian: Phone
}

/** One isolated browser context per phone: separate storage, separate anonymous user. */
export async function openPhone(browser: Browser, width = 375, height = 740): Promise<Phone> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(SCENARIO_PATH)
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

/** Pairs two fresh phones and starts the scenario. */
export async function startPair(browser: Browser, width = 375, height = 740): Promise<Pair> {
  const missionary = await openPhone(browser, width, height)
  const christian = await openPhone(browser, width, height)
  const code = await chooseMissionary(missionary.page)
  await joinAsChristian(christian.page, code)

  await expect(christian.page.getByRole('heading', { name: 'Waiting for your partner to start' })).toBeVisible()
  await expect(missionary.page.getByRole('heading', { name: 'Your partner has joined' })).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Start', exact: true }).click()
  await expectPrompt({ missionary, christian }, 0)
  return { missionary, christian }
}

/** Both phones show the same beat; only the Christian has the hidden answer. */
export async function expectPrompt(pair: Pair, index: number) {
  const prompt = PROMPTS[index]
  await expect(pair.missionary.page.getByText(`${index + 1} of ${PROMPTS.length}`)).toBeVisible()
  await expect(pair.christian.page.getByText(`${index + 1} of ${PROMPTS.length}`)).toBeVisible()
  if ('text' in prompt) {
    for (const phone of [pair.missionary, pair.christian]) {
      await expect(phone.page.getByRole('heading', { level: 1, name: prompt.text })).toBeVisible()
    }
    await expect(pair.christian.page.getByRole('button', { name: 'Show answer' })).toHaveAttribute('aria-expanded', 'false')
    await expect(pair.christian.page.getByText(prompt.answer)).toBeHidden()
    await expect(pair.missionary.page.getByText(prompt.answer)).toHaveCount(0)
    if ('wait' in prompt) {
      await expect(pair.missionary.page.getByText(prompt.wait)).toBeVisible()
      await expect(pair.christian.page.getByText(prompt.wait)).toHaveCount(0)
    }
  } else {
    await expect(pair.missionary.page.getByRole('heading', { level: 1, name: 'Choose the matching response.' })).toBeVisible()
    await expect(pair.christian.page.getByRole('heading', { level: 1, name: prompt.choosing })).toBeVisible()
    await expect(pair.christian.page.getByRole('button', { name: prompt.branchLabel })).toHaveCount(0)
    await expect(pair.missionary.page.getByText(prompt.response)).toHaveCount(0)
    await expect(pair.christian.page.getByText(prompt.unused)).toHaveCount(0)
    await expect(pair.missionary.page.getByText(prompt.unused)).toHaveCount(0)
  }
  await expect(pair.missionary.page.getByRole('button', { name: /answer/i })).toHaveCount(0)
}

export async function closePair(pair: Pair) {
  await Promise.all([pair.missionary.context.close(), pair.christian.context.close()])
}
