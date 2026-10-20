import { expect, test, type Page } from '@playwright/test'
import { askQuestion, closePair, exampleAnswer, heading, SCENARIO_PATH, SCREENS, startPair, walkToQuestions } from './helpers'

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
  test(`guided screens fit a ${viewport.width}px wide screen`, async ({ browser }) => {
    const pair = await startPair(browser, viewport.width, viewport.height)
    const { missionary, christian } = pair
    await walkToQuestions(pair)
    await askQuestion(pair, 'hope')

    const { toggle } = await exampleAnswer(christian.page)
    await toggle.click()
    for (const page of [missionary.page, christian.page]) {
      await expectNoHorizontalOverflow(page)
      // Rendered buttons only; the closed menu's items have no box.
      const heights = await page
        .locator('main button')
        .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height).filter((height) => height > 0))
      for (const height of heights) expect(height).toBeGreaterThanOrEqual(44)
      // The session menu stays on screen beside the wordmark.
      const menu = await page.getByLabel('Session controls').boundingBox()
      expect((menu?.x ?? 0) + (menu?.width ?? 0)).toBeLessThanOrEqual(viewport.width)
      await expect(page.getByText('5 of 6 · Response')).toBeVisible()
    }

    // Hiding the example answer again does not move the heading.
    const title = heading(christian.page, SCREENS.response)
    const before = await title.boundingBox()
    await christian.page.getByRole('button', { name: 'Hide example answer' }).click()
    const after = await title.boundingBox()
    expect(after?.y).toBe(before?.y)

    await closePair(pair)
  })
}

test('guided screens stay usable at 200% text size on a 320px screen', async ({ browser }) => {
  const pair = await startPair(browser, 320, 640)
  const { missionary, christian } = pair
  for (const page of [missionary.page, christian.page]) {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })
  }
  await walkToQuestions(pair)
  await askQuestion(pair, 'hope')

  await (await exampleAnswer(christian.page)).toggle.click()
  await expectNoHorizontalOverflow(christian.page)
  await expectNoHorizontalOverflow(missionary.page)

  // Controls remain reachable by normal page scrolling and still work.
  const shared = christian.page.getByRole('button', { name: 'I’ve shared my thoughts' })
  await shared.scrollIntoViewIfNeeded()
  await shared.click()
  await expect(heading(missionary.page, SCREENS.questions)).toBeVisible()

  await closePair(pair)
})

test('the role screen is keyboard reachable with a visible focus indicator', async ({ page }) => {
  await page.goto(SCENARIO_PATH)
  await page.getByRole('button', { name: 'Create a room' }).click()
  await expect(page.getByRole('radio', { name: /Mormon$/ })).toBeChecked()
  await page.keyboard.press('Tab')
  const focused = page.locator(':focus-visible')
  await expect(focused).toHaveAccessibleName(/Mormon$/)
  // The radio's card draws the ring around the whole choice.
  const outline = await focused.evaluate((el) => getComputedStyle(el.closest('label') ?? el).outlineStyle)
  expect(outline).not.toBe('none')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('radio', { name: /Christian$/ })).toBeChecked()
  await expect(page.getByRole('button', { name: 'Get a pairing code' })).toBeVisible()
})

test('the production build styles the primary action from the design tokens', async ({ page }) => {
  // Guards against chunking that drops or reorders the token and component CSS.
  await page.goto(SCENARIO_PATH)
  const button = page.getByRole('button', { name: 'Create a room' })
  const styles = await button.evaluate((el) => ({
    radius: getComputedStyle(el).borderTopLeftRadius,
    text: getComputedStyle(el).color,
    fill: getComputedStyle(el).backgroundColor,
    height: el.getBoundingClientRect().height,
  }))
  expect(styles.radius).toBe('14px')
  expect(styles.fill).toBe('rgb(32, 92, 80)')
  expect(styles.text).not.toBe(styles.fill)
  expect(styles.height).toBeGreaterThanOrEqual(52)
})

test('changing a design token updates the components', async ({ page }) => {
  await page.goto(SCENARIO_PATH)
  const button = page.getByRole('button', { name: 'Create a room' })
  const fill = () => button.evaluate((el) => getComputedStyle(el).backgroundColor)
  const before = await fill()

  // CSSOM changes are allowed by the CSP (unlike injected <style> tags).
  await page.evaluate(() => document.documentElement.style.setProperty('--color-teal', 'rgb(1, 2, 3)'))
  await expect.poll(fill).toBe('rgb(1, 2, 3)')
  expect(before).not.toBe('rgb(1, 2, 3)')
})

test('the doorway opens once, settles on the original frame, and stays still when motion is off', async ({ page }) => {
  const doorLeaf = page.getByRole('img', { name: /open green door/ }).locator('g').first()
  const timings = () =>
    doorLeaf.evaluate((el) =>
      el.getAnimations().map((animation) => {
        const timing = animation.effect?.getTiming()
        return { duration: timing?.duration, delay: timing?.delay, iterations: timing?.iterations }
      }),
    )

  await page.goto(SCENARIO_PATH)
  expect(await timings()).toEqual([{ duration: 1100, delay: 80, iterations: 1 }])
  await expect.poll(() => doorLeaf.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)')

  // The saved Pause motion preference applies before the first render.
  await page.evaluate(() => window.localStorage.setItem('doorstep:motion-paused', '1'))
  await page.reload()
  await expect(heading(page, SCREENS.welcome)).toBeVisible()
  expect(await timings()).toEqual([])
  expect(await doorLeaf.evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(1, 0, 0, 1, 0, 0)')

  await page.evaluate(() => window.localStorage.removeItem('doorstep:motion-paused'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload()
  await expect(heading(page, SCREENS.welcome)).toBeVisible()
  expect(await timings()).toEqual([])
  const light = page.getByRole('img', { name: /open green door/ }).locator('path[fill="#f9edce"]')
  expect(await light.evaluate((el) => [el.getAnimations().length, getComputedStyle(el).opacity])).toEqual([0, '1'])
})
