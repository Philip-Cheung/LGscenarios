import { expect, test } from '@playwright/test'

const SHOTS = 'docs/screenshots/unavailable'
const HEADING = 'We couldn’t find this scenario.'

for (const [width, height] of [
  [320, 568],
  [390, 844],
] as const) {
  test(`a bad scenario link shows the recovery page at ${width}px, and its link opens Lesson 1`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    await page.goto('/s/not-a-real-scenario')

    await expect(page.getByRole('heading', { level: 1, name: HEADING })).toBeVisible()
    await expect(page).toHaveTitle('Scenario not found · Doorstep practice')
    await expect(page).toHaveURL(/\/s\/not-a-real-scenario$/)
    await expect(page.getByRole('button')).toHaveCount(0)

    const cta = page.getByRole('link', { name: 'Go to Lesson 1' })
    await expect(cta).toBeVisible()
    const box = await cta.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(54)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}/${width}-unavailable.png`, fullPage: true })

    // Keyboard: the link is the first stop and opens Lesson 1's normal role choice.
    await page.keyboard.press('Tab')
    await expect(cta).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/s\/lesson-one-first-vision$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Who will you play?' })).toBeVisible()
    await context.close()
  })
}
