import { expect, test } from '@playwright/test'
import {
  chooseMissionary,
  closePair,
  expectPrompt,
  joinAsChristian,
  openPhone,
  PROMPTS,
  SCENARIO_PATH,
  startPair,
} from './helpers'

test('a pair completes a round, keeps answers hidden, and swaps roles', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  // Reveal on the Christian's phone only.
  await christian.page.getByRole('button', { name: 'Show answer' }).click()
  await expect(christian.page.getByRole('button', { name: 'Hide answer' })).toHaveAttribute('aria-expanded', 'true')
  await expect(christian.page.getByText(PROMPTS[0].answer)).toBeVisible()
  await expect(missionary.page.getByText(PROMPTS[0].answer)).toHaveCount(0)
  await expect(christian.page.getByRole('button', { name: /next|back|finish/i })).toHaveCount(0)

  // Next syncs both phones and hides the answer again.
  await missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectPrompt(pair, 1)
  await missionary.page.getByRole('button', { name: 'Back', exact: true }).click()
  await expectPrompt(pair, 0)
  await missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectPrompt(pair, 1)
  await missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
  await expectPrompt(pair, 2)

  await missionary.page.getByRole('button', { name: 'Finish' }).click()
  for (const phone of [missionary, christian]) {
    await expect(phone.page.getByRole('heading', { name: 'Scenario complete' })).toBeVisible()
  }

  await missionary.page.getByRole('button', { name: 'Switch roles' }).click()
  await christian.page.getByRole('button', { name: 'Accept' }).click()

  // The phones have traded roles: control moves to the former Christian.
  await expect(christian.page.getByRole('button', { name: 'Next', exact: true })).toBeVisible()
  await expect(christian.page.getByText('Mormon missionary')).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: 'Show answer' })).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: 'Next', exact: true })).toHaveCount(0)
  await expect(missionary.page.getByText(PROMPTS[0].answer)).toBeHidden()

  await closePair(pair)
})

test('six pairs practise at the same time without affecting each other', async ({ browser }) => {
  test.setTimeout(180_000)
  const pairs = await Promise.all(Array.from({ length: 6 }, () => startPair(browser)))

  // Pair i moves forward i % 3 prompts.
  await Promise.all(
    pairs.map(async (pair, i) => {
      for (let step = 1; step <= i % 3; step += 1) {
        await pair.missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
        await expect(pair.christian.page.getByText(`${step + 1} of ${PROMPTS.length}`)).toBeVisible()
      }
    }),
  )
  for (const [i, pair] of pairs.entries()) await expectPrompt(pair, i % 3)

  await Promise.all(pairs.map(closePair))
})

test('a phone that reloads or loses its connection catches up', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  await christian.page.reload()
  await expect(christian.page.getByRole('heading', { level: 2, name: PROMPTS[0].text })).toBeVisible()

  // A live update proves the reloaded phone is subscribed again, not just showing fetched state.
  await missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(christian.page.getByRole('heading', { level: 2, name: PROMPTS[1].text })).toBeVisible()

  await christian.context.setOffline(true)
  await missionary.page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(missionary.page.getByText('3 of 3')).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeVisible()

  await christian.context.setOffline(false)
  await expect(christian.page.getByRole('heading', { level: 2, name: PROMPTS[2].text })).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeHidden()

  await closePair(pair)
})

test('a third phone cannot join a full pair, and wrong codes are explained', async ({ browser }) => {
  const missionary = await openPhone(browser)
  const christian = await openPhone(browser)
  const third = await openPhone(browser)
  const code = await chooseMissionary(missionary.page)

  await joinAsChristian(third.page, 'ZZZ-ZZZ')
  await expect(third.page.getByRole('alert')).toContainText('not valid')
  await expect(third.page.getByLabel('Pair code')).toHaveValue('ZZZ-ZZZ')

  await joinAsChristian(christian.page, code)
  await expect(christian.page.getByRole('heading', { name: 'Waiting for your partner to start' })).toBeVisible()

  await third.page.goto(SCENARIO_PATH)
  await joinAsChristian(third.page, code)
  await expect(third.page.getByRole('alert')).toContainText('not valid')

  await Promise.all([missionary, christian, third].map((phone) => phone.context.close()))
})
