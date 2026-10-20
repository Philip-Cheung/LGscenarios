import { expect, test, type Page } from '@playwright/test'
import { closePair, SCENARIO_PATH, startPair } from './helpers'

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 375, height: 740 },
  { width: 430, height: 900 },
  { width: 1280, height: 800 },
]

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

for (const viewport of VIEWPORTS) {
  test(`prompt screens fit a ${viewport.width}px wide screen`, async ({ browser }) => {
    const pair = await startPair(browser, viewport.width, viewport.height)
    const { missionary, christian } = pair

    await christian.page.getByRole('button', { name: 'Show answer' }).click()
    for (const page of [missionary.page, christian.page]) {
      await expectNoHorizontalOverflow(page)
      const controls = page.locator('main button')
      for (const box of await controls.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
        expect(box).toBeGreaterThanOrEqual(44)
      }
    }

    // The card keeps its shape when the answer is hidden again.
    const before = await christian.page.getByText('Your partner controls next and back.').boundingBox()
    await christian.page.getByRole('button', { name: 'Hide answer' }).click()
    const after = await christian.page.getByText('Your partner controls next and back.').boundingBox()
    expect(after?.y).toBeLessThanOrEqual(before?.y ?? 0)

    await closePair(pair)
  })
}

test('prompt screens stay usable at 200% text size on a 320px screen', async ({ browser }) => {
  const pair = await startPair(browser, 320, 640)
  const { missionary, christian } = pair
  for (const page of [missionary.page, christian.page]) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
  }

  await christian.page.getByRole('button', { name: 'Show answer' }).click()
  await expectNoHorizontalOverflow(christian.page)
  await expectNoHorizontalOverflow(missionary.page)

  // Navigation remains reachable by normal page scrolling and still works.
  const next = missionary.page.getByRole('button', { name: 'Next', exact: true })
  await next.scrollIntoViewIfNeeded()
  await next.click()
  await expect(christian.page.getByText('2 of 3')).toBeVisible()

  await closePair(pair)
})

test('the role screen is keyboard reachable with a visible focus indicator', async ({ page }) => {
  await page.goto(SCENARIO_PATH)
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus-visible')
  await expect(focused).toHaveAccessibleName('Mormon missionary')
  const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle)
  const shadow = await focused.evaluate((el) => getComputedStyle(el).boxShadow)
  expect(outline !== 'none' || shadow !== 'none').toBe(true)
})

test('the production build keeps the vendor component layer above the CSS reset', async ({ page }) => {
  // Guards against chunking that loads library CSS before the cascade layer order is declared.
  await page.goto(SCENARIO_PATH)
  const button = page.getByRole('button', { name: 'Mormon missionary' })
  const styles = await button.evaluate((el) => ({
    radius: getComputedStyle(el, '::before').borderRadius,
    text: getComputedStyle(el).color,
    fill: getComputedStyle(el, '::before').backgroundColor,
  }))
  expect(styles.radius).not.toBe('0px')
  expect(styles.text).not.toBe(styles.fill)
})

test('changing a design token updates the wrapped components', async ({ page }) => {
  await page.goto(SCENARIO_PATH)
  const button = page.getByRole('button', { name: 'Mormon missionary' })
  // The vendor button paints its fill on ::before.
  const fill = () => button.evaluate((el) => getComputedStyle(el, '::before').backgroundColor)
  const before = await fill()

  // CSSOM changes are allowed by the CSP (unlike injected <style> tags).
  await page.evaluate(() => document.documentElement.style.setProperty('--dp-color-action-primary-bg', 'rgb(1, 2, 3)'))
  await expect.poll(fill).toBe('rgb(1, 2, 3)')
  expect(before).not.toBe('rgb(1, 2, 3)')
})
