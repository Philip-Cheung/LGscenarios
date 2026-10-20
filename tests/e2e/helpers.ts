import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test'

export const SCENARIO_PATH = '/s/sample-doorstep'
export const PROMPTS = [
  { text: 'Hi! Could we ask you a question about your faith?', answer: 'Sure. What would you like to talk about?' },
  { text: 'What gives you hope?', answer: 'My faith gives me hope. It reminds me that I am loved.' },
  { text: 'How does that help you in everyday life?', answer: 'It helps me face difficult days with patience and hope.' },
]

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
  await page.getByRole('button', { name: 'Christian', exact: true }).click()
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

/** Both phones show the same prompt; only the Christian has the hidden answer. */
export async function expectPrompt(pair: Pair, index: number) {
  for (const phone of [pair.missionary, pair.christian]) {
    await expect(phone.page.getByRole('heading', { level: 2, name: PROMPTS[index].text })).toBeVisible()
    await expect(phone.page.getByText(`${index + 1} of ${PROMPTS.length}`)).toBeVisible()
  }
  await expect(pair.christian.page.getByRole('button', { name: 'Show answer' })).toHaveAttribute('aria-expanded', 'false')
  await expect(pair.christian.page.getByText(PROMPTS[index].answer)).toBeHidden()
  await expect(pair.missionary.page.getByRole('button', { name: /answer/i })).toHaveCount(0)
  await expect(pair.missionary.page.getByText(PROMPTS[index].answer)).toHaveCount(0)
}

export async function closePair(pair: Pair) {
  await Promise.all([pair.missionary.context.close(), pair.christian.context.close()])
}
