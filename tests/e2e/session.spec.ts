import { expect, test } from '@playwright/test'
import {
  askQuestion,
  bothReady,
  chooseMissionary,
  closePair,
  DOORSTEP,
  expectChoosing,
  expectDiscussion,
  finishConversation,
  heading,
  joinAsChristian,
  openPhone,
  pairOnScene,
  SCENARIO_PATH,
  startPair,
  walkToQuestions,
} from './helpers'

test('a pair completes a guided round, keeps answers hidden until revealed, and swaps roles', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair
  await walkToQuestions(pair)
  await askQuestion(pair, 'hope')

  // Help and the suggested answer appear on the Christian's phone only, and only on request.
  await christian.page.getByRole('button', { name: 'Show hint' }).click()
  await expect(christian.page.getByText(DOORSTEP.questions.hope.hint)).toBeVisible()
  await christian.page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(christian.page.getByText(DOORSTEP.questions.hope.answer)).toBeVisible()
  await expect(missionary.page.getByText(DOORSTEP.questions.hope.answer)).toHaveCount(0)

  // A follow-up hides the earlier answer and waits for the missionary to ask it.
  await missionary.page.getByRole('button', { name: DOORSTEP.followUp.label }).click()
  await expect(heading(missionary.page, DOORSTEP.followUp.script)).toBeVisible()
  await expect(heading(christian.page, 'Listen for your partner’s question')).toBeVisible()
  await expect(christian.page.getByText(DOORSTEP.questions.hope.answer)).toHaveCount(0)
  await missionary.page.getByRole('button', { name: 'Question asked' }).click()
  await expectDiscussion(pair, DOORSTEP.followUp.script, DOORSTEP.followUp.answer)

  await missionary.page.getByRole('button', { name: 'Choose another question' }).click()
  await expectChoosing(pair)
  await askQuestion(pair, 'faith')
  await finishConversation(pair)
  await expect(missionary.page.getByText(DOORSTEP.closing)).toBeVisible()

  await missionary.page.getByRole('button', { name: 'Switch roles' }).click()
  await christian.page.getByRole('button', { name: 'Accept' }).click()

  // The phones have traded roles and both return to the scene.
  await expect(heading(christian.page, DOORSTEP.missionaryScene)).toBeVisible()
  await expect(heading(missionary.page, DOORSTEP.christianScene)).toBeVisible()
  const swapped = { missionary: christian, christian: missionary }
  await bothReady(swapped)
  await expect(heading(christian.page, DOORSTEP.initiatorPrompt)).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: DOORSTEP.initiatorAction })).toHaveCount(0)

  await closePair(pair)
})

test('six pairs practise at the same time without affecting each other', async ({ browser }) => {
  test.setTimeout(180_000)
  const pairs = await Promise.all(Array.from({ length: 6 }, () => startPair(browser)))

  // Pair i walks i % 3 steps: stay at the door, knock, or reach the questions.
  await Promise.all(
    pairs.map(async (pair, i) => {
      if (i % 3 === 1) {
        await pair.missionary.page.getByRole('button', { name: DOORSTEP.initiatorAction }).click()
        await expect(heading(pair.christian.page, DOORSTEP.receiverPrompt)).toBeVisible()
      }
      if (i % 3 === 2) await walkToQuestions(pair)
    }),
  )
  for (const [i, pair] of pairs.entries()) {
    if (i % 3 === 0) {
      await expect(heading(pair.missionary.page, DOORSTEP.initiatorPrompt)).toBeVisible()
      await expect(heading(pair.christian.page, 'Waiting for your partner')).toBeVisible()
    }
    if (i % 3 === 1) await expect(heading(pair.christian.page, DOORSTEP.receiverPrompt)).toBeVisible()
    if (i % 3 === 2) await expectChoosing(pair)
  }

  await Promise.all(pairs.map(closePair))
})

test('a phone that reloads or loses its connection catches up, and a reload conceals the answer', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  await christian.page.reload()
  await expect(heading(christian.page, 'Waiting for your partner')).toBeVisible()

  // A live update proves the reloaded phone is subscribed again, not just showing fetched state.
  await missionary.page.getByRole('button', { name: DOORSTEP.initiatorAction }).click()
  await expect(heading(christian.page, DOORSTEP.receiverPrompt)).toBeVisible()
  await christian.page.getByRole('button', { name: DOORSTEP.receiverAction }).click()
  await expect(heading(missionary.page, DOORSTEP.opening)).toBeVisible()

  await christian.context.setOffline(true)
  await missionary.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(heading(missionary.page, 'Choose a question')).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeVisible()

  await christian.context.setOffline(false)
  await expect(heading(christian.page, 'Your partner is choosing a question')).toBeVisible()
  await expect(christian.page.getByText('Reconnecting…')).toBeHidden()

  await askQuestion(pair, 'hope')
  await christian.page.getByRole('button', { name: 'Reveal answer' }).click()
  await expect(christian.page.getByText(DOORSTEP.questions.hope.answer)).toBeVisible()
  await christian.page.reload()
  await expect(heading(christian.page, DOORSTEP.questions.hope.script)).toBeVisible()
  await expect(christian.page.getByRole('button', { name: 'Reveal answer' })).toBeVisible()
  await expect(christian.page.getByText(DOORSTEP.questions.hope.answer)).toHaveCount(0)

  await closePair(pair)
})

test('a second published scenario plays from its own link with its own trigger', async ({ browser }) => {
  const pair = await pairOnScene(browser, 375, 740, '/s/coffee-chat', {
    missionary: 'A café downtown',
    christian: 'A café downtown',
  })
  const { missionary, christian } = pair
  await bothReady(pair)

  // In this scenario the Christian starts the interaction.
  await expect(heading(christian.page, 'You see your friend walk into the café.')).toBeVisible()
  await expect(heading(missionary.page, 'Waiting for your partner')).toBeVisible()
  await christian.page.getByRole('button', { name: 'Wave them over' }).click()
  await expect(heading(missionary.page, 'Your friend waves at you from a table.')).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Walk over and sit down' }).click()
  await expect(heading(missionary.page, "Thanks for meeting me! I've been looking forward to catching up.")).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(missionary.page.getByRole('button', { name: 'What is your church like?' })).toBeVisible()

  await closePair(pair)
})

test('the red leave button ends the session for both phones after confirmation', async ({ browser }) => {
  const pair = await startPair(browser)
  const { missionary, christian } = pair

  const leave = christian.page.getByRole('button', { name: 'Leave session' })
  const box = await leave.boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(44)
  expect(box?.height).toBeGreaterThanOrEqual(44)

  await leave.click()
  const dialog = christian.page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Keep playing' }).click()
  await expect(heading(christian.page, 'Waiting for your partner')).toBeVisible()

  await leave.click()
  await dialog.getByRole('button', { name: 'End session' }).click()
  await expect(christian.page.getByRole('button', { name: 'Mormon missionary' })).toBeVisible()
  await expect(missionary.page.getByText('Your partner ended the session.')).toBeVisible()

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
  await expect(heading(christian.page, DOORSTEP.christianScene)).toBeVisible()

  await third.page.goto(SCENARIO_PATH)
  await joinAsChristian(third.page, code)
  await expect(third.page.getByRole('alert')).toContainText('not valid')

  await Promise.all([missionary, christian, third].map((phone) => phone.context.close()))
})
