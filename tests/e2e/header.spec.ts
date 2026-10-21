import { expect, test, type Page } from '@playwright/test'

const SHOTS = 'docs/screenshots/header'
const LESSON = '/s/lesson-one-first-vision'

async function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [1100, 800],
] as const) {
  test(`the masthead fits on one row at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 600, hasTouch: width < 600 })
    const page = await context.newPage()
    await page.goto(LESSON)
    await expect(page.getByRole('heading', { level: 1, name: 'Who will you play?' })).toBeVisible()

    const header = page.getByRole('banner')
    await expect(header).toContainText('Doorstep practice')
    await expect(header).toContainText('Introduction & First Vision')
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const box = await header.boundingBox()
    if (width === 390) expect(box?.height ?? 0).toBeLessThan(90)

    if (width === 1100) {
      // The wordmark lines up with the 860px conversation column.
      const mark = await header.locator('svg').boundingBox()
      expect(Math.round(mark?.x ?? 0)).toBe((width - 860) / 2)
    }
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/${width}-entry.png` })

    // The join screen puts Back in the right-hand slot, as a full-size target.
    await page.getByRole('button', { name: /^Christian/ }).click()
    const back = header.getByRole('button', { name: 'Back' })
    await expect(back).toBeVisible()
    expect((await back.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44)
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    // The partner strip below starts at the same left edge as the door mark.
    const strip = await page.locator('[class*="roleStrip"]').locator('[class*="portrait"]').boundingBox()
    const mark = await header.locator('svg').boundingBox()
    expect(Math.round(strip?.x ?? -1)).toBe(Math.round(mark?.x ?? 0))
    await context.close()
  })
}
