import { expect, test } from '@playwright/test'
import {
  askQuestion,
  bothReady,
  chooseMenuItem,
  closePair,
  createPractice,
  DOORSTEP,
  exampleAnswer,
  expectChoosing,
  finishConversation,
  heading,
  joinPractice,
  openPhone,
  PARTNER_CHOOSING,
  pairOnScene,
  pairPhones,
  SCENARIO_PATH,
  SCREENS,
  shareComplete,
  startPair,
  walkToQuestions,
} from './helpers'

test('a pair completes a guided round, keeps answers concealed until revealed, and swaps roles', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair
  await walkToQuestions(pair)
  await askQuestion(pair, 'hope')

  // The readable example answer appears on the Christian's phone only, and only on request.
  const { toggle, readable } = await exampleAnswer(christian.page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(readable).toContainText(DOORSTEP.questions.hope.answer)
  await expect(readable).toBeVisible()
  await expect(missionary.page.getByText(DOORSTEP.questions.hope.answer)).toHaveCount(0)

  // Sharing returns both phones to the questions, and the next answer starts concealed again.
  await shareComplete(pair)
  await expect(missionary.page.getByRole('radio', { name: /Answered.*What gives you hope\?/ })).toBeDisabled()
  await askQuestion(pair, 'faith')
  await shareComplete(pair)
  // With every question answered, closing is the only way forward.
  await expect(missionary.page.getByRole('button', { name: 'I’ve asked it' })).toHaveCount(0)
  await finishConversation(pair)
  await expect(missionary.page.getByText(DOORSTEP.reflection)).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Practise again' })).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Switch roles' })).toHaveCount(0)

  await missionary.page.getByRole('button', { name: 'Switch roles' }).click()
  await expect(missionary.page.getByText('Waiting for your partner to accept the switch.')).toBeVisible()
  await christian.page.getByRole('button', { name: 'Switch roles' }).click()

  // The phones have traded roles and both return to the paired summary; the creator still starts.
  for (const phone of [missionary, christian]) await expect(heading(phone.page, SCREENS.paired)).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Start practice' })).toHaveCount(0)
  await missionary.page.getByRole('button', { name: 'Start practice' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, DOORSTEP.sceneTitle)).toBeVisible()
  const swapped = { missionary: christian, christian: missionary }
  await bothReady(swapped)
  await expect(christian.page.getByRole('button', { name: 'Begin conversation' })).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: 'Begin conversation' })).toHaveCount(0)

  await closePair(pair)
})

test('either person can ask to restart, and a declined restart keeps the place', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair
  await expect(christian.page.getByLabel('Session controls')).toBeVisible()

  await chooseMenuItem(missionary.page, 'Restart practice')
  const dialog = missionary.page.getByRole('dialog', { name: 'Start again?' })
  await dialog.getByRole('button', { name: 'Start again' }).click()
  await expect(heading(missionary.page, 'Waiting for your partner')).toBeVisible()
  await expect(heading(christian.page, 'Start again?')).toBeVisible()
  await christian.page.getByRole('button', { name: 'Keep practising' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, SCREENS.readyTogether)).toBeVisible()

  // The Christian can ask too; the missionary answers.
  await chooseMenuItem(christian.page, 'Restart practice')
  await christian.page.getByRole('dialog', { name: 'Start again?' }).getByRole('button', { name: 'Start again' }).click()
  await expect(heading(christian.page, 'Waiting for your partner')).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Start again' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, DOORSTEP.sceneTitle)).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: 'I’m ready' })).toBeVisible()

  await closePair(pair)
})

test('six pairs practise at the same time without affecting each other', async ({ browser }) => {
  test.setTimeout(180_000)
  const pairs = await Promise.all(Array.from({ length: 6 }, () => startPair(browser)))

  // Pair i walks i % 3 steps: stay at Ready together, begin, or reach the questions.
  await Promise.all(
    pairs.map(async (pair, i) => {
      if (i % 3 === 1) {
        await pair.missionary.page.getByRole('button', { name: 'Begin conversation' }).click()
        await expect(heading(pair.christian.page, SCREENS.partnerTurn)).toBeVisible()
      }
      if (i % 3 === 2) await walkToQuestions(pair)
    }),
  )
  for (const [i, pair] of pairs.entries()) {
    if (i % 3 === 0) {
      await expect(heading(pair.missionary.page, SCREENS.readyTogether)).toBeVisible()
      await expect(heading(pair.christian.page, SCREENS.readyTogether)).toBeVisible()
    }
    if (i % 3 === 1) await expect(heading(pair.missionary.page, SCREENS.opening)).toBeVisible()
    if (i % 3 === 2) await expectChoosing(pair)
  }

  await Promise.all(pairs.map(closePair))
})

test('a phone that reloads or loses its connection catches up, and a reload conceals the answer', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  await christian.page.reload()
  await expect(heading(christian.page, SCREENS.readyTogether)).toBeVisible()

  // A live update proves the reloaded phone is subscribed again, not just showing fetched state.
  await missionary.page.getByRole('button', { name: 'Begin conversation' }).click()
  await expect(heading(christian.page, SCREENS.partnerTurn)).toBeVisible()

  await christian.context.setOffline(true)
  await missionary.page.getByRole('button', { name: 'I’ve said it' }).click()
  await expect(heading(missionary.page, SCREENS.questions)).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeVisible()

  await christian.context.setOffline(false)
  await expect(christian.page.getByText(PARTNER_CHOOSING)).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeHidden()

  await askQuestion(pair, 'hope')
  const before = await exampleAnswer(christian.page)
  await before.toggle.click()
  await expect(before.readable).toBeVisible()
  await christian.page.reload()
  await expect(heading(christian.page, SCREENS.response)).toBeVisible()
  const after = await exampleAnswer(christian.page)
  await expect(after.toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(after.readable).toBeHidden()

  await closePair(pair)
})

test('a second published scenario plays from its own link with its own content', async ({ browser }) => {
  const pair = await pairOnScene(browser, 375, 740, '/s/coffee-chat', {
    missionary: 'A café downtown',
    christian: 'A café downtown',
  })
  const { missionary, christian } = pair
  await bothReady(pair)
  await walkToQuestions(pair, 'Thanks for meeting me! I’ve been looking forward to catching up.')
  await expect(missionary.page.getByRole('radio', { name: /Why is going to church important to you\?/ })).toBeVisible()
  await expect(christian.page.getByText('Why is going to church important to you?')).toHaveCount(0)

  await closePair(pair)
})

test('leaving from the session menu ends the session for both phones after confirmation', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  const menu = christian.page.getByLabel('Session controls')
  const box = await menu.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)

  await chooseMenuItem(christian.page, 'Leave session')
  const dialog = christian.page.getByRole('dialog', { name: 'Leave this session?' })
  await dialog.getByRole('button', { name: 'Keep practising' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(heading(christian.page, SCREENS.readyTogether)).toBeVisible()

  await chooseMenuItem(christian.page, 'Leave session')
  await dialog.getByRole('button', { name: 'Leave session' }).click()
  await expect(heading(christian.page, 'You’ve left the practice.')).toBeVisible()
  await expect(heading(missionary.page, 'Your partner ended the practice.')).toBeVisible()
  await christian.page.getByRole('button', { name: 'Start a new practice' }).click()
  await expect(heading(christian.page, SCREENS.welcome)).toBeVisible()

  await closePair(pair)
})

test('a third phone cannot join a full pair, and wrong codes are explained', async ({ browser }) => {
  const missionary = await openPhone(browser)
  const christian = await openPhone(browser)
  const third = await openPhone(browser)
  const code = await createPractice(missionary.page)

  // A short code is explained on the phone; letters never reach the field.
  await joinPractice(third.page, '48a2')
  await expect(third.page.getByRole('alert')).toContainText('Enter all six digits')
  await expect(third.page.getByLabel('Pairing code')).toHaveValue('482')

  const wrong = code.startsWith('0') ? '111 111' : '000 000'
  await joinPractice(third.page, wrong)
  await expect(third.page.getByRole('alert')).toContainText('doesn’t match')
  await expect(third.page.getByLabel('Pairing code')).toHaveValue(wrong)

  await joinPractice(christian.page, code)
  await expect(heading(christian.page, SCREENS.paired)).toBeVisible()

  await third.page.goto(SCENARIO_PATH)
  await joinPractice(third.page, code)
  await expect(third.page.getByRole('alert')).toContainText('doesn’t match')

  await Promise.all([missionary, christian, third].map((phone) => phone.context.close()))
})

test('the creator can change roles before anyone joins', async ({ browser }) => {
  const missionary = await openPhone(browser)
  await createPractice(missionary.page)
  await missionary.page.getByRole('button', { name: 'Change roles' }).click()
  await expect(heading(missionary.page, SCREENS.chooseRole)).toBeVisible()
  await expect(missionary.page.getByRole('radio', { name: /Latter-day Saint missionary$/ })).toBeChecked()
  await missionary.context.close()
})

test('a creator who chooses the Christian starts the practice, and the joiner leads as the missionary', async ({
  browser,
}) => {
  const creator = await openPhone(browser)
  const joiner = await openPhone(browser)
  const code = await createPractice(creator.page, 'Christian')
  await expect(creator.page.getByText('Your role').locator('..')).toContainText('Christian')
  await joinPractice(joiner.page, code)
  for (const phone of [creator, joiner]) await expect(heading(phone.page, SCREENS.paired)).toBeVisible()
  await expect(joiner.page.getByRole('button', { name: 'Start practice' })).toHaveCount(0)
  await creator.page.getByRole('button', { name: 'Start practice' }).click()
  for (const phone of [creator, joiner]) await expect(heading(phone.page, DOORSTEP.sceneTitle)).toBeVisible()

  const pair = { missionary: joiner, christian: creator }
  await bothReady(pair)
  await walkToQuestions(pair)
  await closePair(pair)
})

test('pairing leads to a summary only the creator can start', async ({ browser }) => {
  const pair = await pairPhones(browser)
  await expect(pair.missionary.page.getByText('Ready to practise')).toBeVisible()
  await expect(pair.christian.page.getByText('Your partner will start when you’re both ready.')).toBeVisible()
  await closePair(pair)
})
