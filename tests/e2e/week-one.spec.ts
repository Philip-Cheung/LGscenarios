import { expect, test, type Page } from '@playwright/test'
import {
  bothReady,
  chooseMenuItem,
  closePair,
  createPractice,
  exampleAnswer,
  heading,
  joinPractice,
  openPhone,
  pairOnScene,
  PARTNER_CHOOSING,
  SCENARIO_PATH,
  SCREENS,
  type Pair,
} from './helpers'

/** Copy from content/scenarios/week-one-first-vision.v1.json. */
const WEEK_PATH = '/s/week-one-first-vision'
const WEEK = {
  title: 'Week One · The First Vision',
  sceneTitle: 'A Mormon missionary at your door',
  intro: 'Hi, I’m Elder [name], a Mormon missionary.',
  churchQuestion: 'Do you go to church?',
  churchExample: 'Yes, I’m a Christian and I go to a local church.',
  acknowledgment: 'Thanks for sharing. I’d like to hear a little about your faith.',
  topics: {
    'faith': {
      topic: 'Your faith',
      prompt: 'What does faith in Jesus mean to you personally?',
      example: 'My faith is about knowing Jesus and trusting him.',
      followUp: 'We believe in Jesus and his forgiveness too.',
      followUpExample: 'I start with the Bible and try to understand each passage in context.',
    },
    'first-vision': {
      topic: 'The First Vision',
      prompt: 'One part of our message is Joseph Smith’s First Vision.',
      example: 'I believe God hears prayer, and I agree that we should ask him for wisdom.',
      followUp: 'Reading the Book of Mormon and praying have helped me believe Joseph was a prophet.',
      followUpExample: 'Yes, I believe God can speak.',
    },
    'accounts': {
      topic: 'Different accounts',
      prompt: 'Joseph described his vision on several occasions.',
      example: 'Yes. I understand that people tell stories differently.',
      followUp: 'The early account doesn’t say he saw only one person.',
      followUpExample: 'You’re right that the early account doesn’t explicitly say ‘only one.’',
    },
    'prayer': {
      topic: 'Prayer and truth',
      prompt: 'I believe Joseph Smith was a prophet. Reading and praying have helped me believe that.',
      example: 'I’m willing to pray for wisdom and read more.',
      followUp: 'I agree that studying matters.',
      followUpExample: 'I believe God guides me too.',
    },
  },
  james15: 'If any of you lack wisdom, let him ask of God',
  james12: 'My brethren, count it all joy when ye fall into divers temptations',
  listenerReply: 'Thank you for listening too. I’d be happy to read more and talk again.',
  reflectionFollowUp: 'Did you respond to what your partner actually said?',
} as const

type Topic = keyof typeof WEEK.topics

function progress(page: Page) {
  return page.locator('[role="progressbar"]')
}

/** Opening through the church question and the Christian's answer; ends on the first topic list. */
async function answerOpening(pair: Pair) {
  const { missionary, christian } = pair
  await missionary.page.getByRole('button', { name: 'Begin conversation' }).click()
  await expect(missionary.page.getByText(WEEK.intro)).toBeVisible()
  await expect(missionary.page.getByText(`“${WEEK.churchQuestion}”`)).toBeVisible()
  await expect(heading(christian.page, SCREENS.partnerTurn)).toBeVisible()
  await expect(christian.page.getByText(WEEK.churchQuestion)).toHaveCount(0)

  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await expect(heading(missionary.page, SCREENS.listening)).toBeVisible()
  await expect(heading(christian.page, 'A little about you')).toBeVisible()
  await expect(christian.page.getByText(`“${WEEK.churchQuestion}”`)).toBeVisible()
  for (const phone of [missionary, christian]) await expect(progress(phone.page)).toHaveAttribute('aria-valuetext', 'Opening')
  const { toggle, readable } = await exampleAnswer(christian.page)
  await expect(readable).toBeHidden()
  await toggle.click()
  await expect(readable).toContainText(WEEK.churchExample)
  await expect(missionary.page.getByText(WEEK.churchExample)).toHaveCount(0)

  await christian.page.getByRole('button', { name: 'I’ve shared my thoughts' }).click()
  await expect(heading(missionary.page, SCREENS.questions)).toBeVisible()
  await expect(missionary.page.getByText(`“${WEEK.acknowledgment}”`)).toBeVisible()
  await expect(christian.page.getByText(PARTNER_CHOOSING)).toBeVisible()
}

/** The missionary asks a topic's first question; the Christian answers it; the follow-up is pending. */
async function askTopic(pair: Pair, key: Topic) {
  const { missionary, christian } = pair
  const topic = WEEK.topics[key]
  await missionary.page.getByRole('radio', { name: new RegExp(topic.topic) }).check()
  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await expect(heading(missionary.page, SCREENS.listening)).toBeVisible()
  await expect(heading(christian.page, SCREENS.response)).toBeVisible()
  await expect(christian.page.getByText(topic.prompt)).toBeVisible()
  const { toggle, readable } = await exampleAnswer(christian.page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(readable).toBeHidden()
  await expect(missionary.page.getByText(topic.example)).toHaveCount(0)

  await christian.page.getByRole('button', { name: 'I’ve shared my thoughts' }).click()
  await expectFollowUpPending(pair, key)
}

async function expectFollowUpPending(pair: Pair, key: Topic) {
  const { missionary, christian } = pair
  const topic = WEEK.topics[key]
  await expect(heading(missionary.page, 'Ask a follow-up')).toBeVisible()
  await expect(missionary.page.getByText('Use what your partner actually said. Adapt the wording if needed.')).toBeVisible()
  await expect(missionary.page.getByText(topic.followUp)).toBeVisible()
  await expect(missionary.page.getByText(topic.followUpExample)).toHaveCount(0)
  await expect(heading(christian.page, SCREENS.partnerTurn)).toBeVisible()
  await expect(christian.page.getByText('Listen for their follow-up question. It will appear here next.')).toBeVisible()
  await expect(christian.page.getByText(topic.followUp)).toHaveCount(0)
  for (const phone of [missionary, christian]) {
    await expect(progress(phone.page)).toHaveAttribute('aria-valuetext', 'Questions · Follow-up')
  }
}

/** The missionary asks the follow-up; the Christian answers with a fresh hidden example; the topic is done. */
async function answerFollowUp(pair: Pair, key: Topic) {
  const { missionary, christian } = pair
  const topic = WEEK.topics[key]
  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await expect(heading(christian.page, 'Respond to the follow-up')).toBeVisible()
  await expect(progress(christian.page)).toHaveAttribute('aria-valuetext', 'Response · Follow-up')
  await expect(christian.page.getByText(topic.followUp)).toBeVisible()
  const { toggle, readable } = await exampleAnswer(christian.page)
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(readable).toContainText(topic.followUpExample)
  await expect(readable).not.toContainText(topic.example)
  await christian.page.getByRole('button', { name: 'I’ve shared my thoughts' }).click()
  await expectAnswered(pair, key)
}

async function expectAnswered(pair: Pair, key: Topic) {
  const radio = pair.missionary.page.getByRole('radio', { name: new RegExp(`${WEEK.topics[key].topic} · Answered`) })
  await expect(heading(pair.missionary.page, SCREENS.questions)).toBeVisible()
  await expect(radio).toBeDisabled()
  await expect(pair.christian.page.getByText(PARTNER_CHOOSING)).toBeVisible()
}

test('Week One: the missionary-creator pair runs the opening, follow-ups, skip, passages, reload, and closing', async ({
  browser,
}) => {
  const pair = await pairOnScene(browser, 375, 740, WEEK_PATH, { missionary: WEEK.sceneTitle, christian: WEEK.sceneTitle })
  const { missionary, christian } = pair
  await expect(missionary.page).toHaveTitle(`${WEEK.title} · Doorstep practice`)
  await bothReady(pair)
  await answerOpening(pair)

  // The missionary can read the passage in a chosen prompt before asking it.
  await missionary.page.getByRole('radio', { name: /The First Vision/ }).check()
  await missionary.page.getByRole('button', { name: 'James 1:5' }).click()
  const missionaryReader = missionary.page.getByRole('dialog', { name: 'James 1:5' })
  await expect(missionaryReader).toContainText(WEEK.james15)
  await missionaryReader.getByRole('button', { name: 'Close' }).click()
  await expect(missionaryReader).toHaveCount(0)
  await expect(missionary.page.getByRole('button', { name: 'James 1:5' })).toBeFocused()
  await expect(christian.page.getByText(PARTNER_CHOOSING)).toBeVisible()

  await askTopic(pair, 'first-vision')
  // The acknowledgment is shown on the first topic list only.
  await answerFollowUp(pair, 'first-vision')
  await expect(missionary.page.getByText(`“${WEEK.acknowledgment}”`)).toHaveCount(0)

  // The Christian opens the bundled KJV text with its surrounding verses.
  await missionary.page.getByRole('radio', { name: /Your faith/ }).check()
  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await expect(heading(christian.page, SCREENS.response)).toBeVisible()
  const { toggle } = await exampleAnswer(christian.page)
  await toggle.click()
  await christian.page.getByText('More help', { exact: true }).click()
  const trigger = christian.page.getByRole('button', { name: '1 John 4:9–10' })
  await trigger.click()
  const reader = christian.page.getByRole('dialog', { name: '1 John 4:9–10' })
  await expect(reader).toContainText('King James Version (KJV)')
  await expect(reader).toContainText('In this was manifested the love of God toward us')
  await reader.getByRole('button', { name: 'Read surrounding verses' }).click()
  await expect(reader).toContainText('Beloved, let us love one another')
  await expect(reader.getByRole('button', { name: 'Show selected verses' })).toBeVisible()
  await christian.page.keyboard.press('Escape')
  await expect(reader).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(christian.page.getByRole('button', { name: 'Hide example answer' })).toBeVisible()

  // A restart request from the partner closes an open passage and shows the current screen.
  await trigger.click()
  await expect(reader).toBeVisible()
  await chooseMenuItem(missionary.page, 'Restart practice')
  await missionary.page.getByRole('dialog', { name: 'Start again?' }).getByRole('button', { name: 'Start again' }).click()
  await expect(heading(christian.page, 'Start again?')).toBeVisible()
  await expect(reader).toHaveCount(0)
  await christian.page.getByRole('button', { name: 'Keep practising' }).click()
  await expect(heading(christian.page, SCREENS.response)).toBeVisible()
  await expect((await exampleAnswer(christian.page)).toggle).toHaveAttribute('aria-expanded', 'false')

  // Skipping a follow-up still marks the topic answered.
  await christian.page.getByRole('button', { name: 'I’ve shared my thoughts' }).click()
  await expectFollowUpPending(pair, 'faith')
  await missionary.page.getByRole('button', { name: 'Next topic' }).click()
  await expectAnswered(pair, 'faith')

  // A reload during a pending follow-up returns both phones to the same topic and turn.
  await askTopic(pair, 'accounts')
  await Promise.all([missionary.page.reload(), christian.page.reload()])
  await expectFollowUpPending(pair, 'accounts')
  await answerFollowUp(pair, 'accounts')

  await askTopic(pair, 'prayer')
  await answerFollowUp(pair, 'prayer')
  await expect(missionary.page.getByText('You’ve asked every question. Move to closing when you’re ready.')).toBeVisible()
  await expect(missionary.page.getByRole('button', { name: 'I’ve asked it' })).toHaveCount(0)
  await missionary.page.getByRole('button', { name: 'Move to closing' }).click()
  await expect(heading(missionary.page, SCREENS.closing)).toBeVisible()
  await expect(heading(christian.page, SCREENS.wrapUp)).toBeVisible()
  await expect(christian.page.getByText(WEEK.listenerReply)).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Finish practice' }).click()
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, SCREENS.complete)).toBeVisible()
    await expect(phone.page.getByText(WEEK.reflectionFollowUp)).toBeVisible()
  }
  await closePair(pair)
})

test('Week One: a Christian creator’s room is joined from another link, and closing early skips the pending follow-up', async ({
  browser,
}) => {
  const christian = await openPhone(browser, 1280, 900, WEEK_PATH)
  const missionary = await openPhone(browser, 375, 740, SCENARIO_PATH)
  const code = await createPractice(christian.page, 'Christian')
  await joinPractice(missionary.page, code)
  const pair: Pair = { missionary, christian }
  for (const phone of [missionary, christian]) {
    await expect(heading(phone.page, SCREENS.paired)).toBeVisible()
    await expect(phone.page.getByText('Conversation', { exact: true }).locator('..')).toContainText(WEEK.title)
  }
  await expect(missionary.page.getByRole('button', { name: 'Start practice' })).toHaveCount(0)
  await christian.page.getByRole('button', { name: 'Start practice' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, WEEK.sceneTitle)).toBeVisible()
  await bothReady(pair)
  await expect(christian.page.getByRole('button', { name: 'Begin conversation' })).toHaveCount(0)
  await answerOpening(pair)

  await askTopic(pair, 'prayer')
  await answerFollowUp(pair, 'prayer')
  await askTopic(pair, 'accounts')

  // Closing while the follow-up is pending ends the topic without marking it answered.
  await expect(missionary.page.getByRole('button', { name: 'Next topic' })).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Move to closing' }).click()
  await expect(heading(missionary.page, SCREENS.closing)).toBeVisible()
  await expect(heading(christian.page, SCREENS.wrapUp)).toBeVisible()
  await missionary.page.getByRole('button', { name: 'Finish practice' }).click()
  for (const phone of [missionary, christian]) await expect(heading(phone.page, SCREENS.complete)).toBeVisible()
  await closePair(pair)
})

test('Week One: the accounts help links to the historical sources as labelled external links', async ({ browser }) => {
  const pair = await pairOnScene(browser, 375, 740, WEEK_PATH, { missionary: WEEK.sceneTitle, christian: WEEK.sceneTitle })
  await bothReady(pair)
  await answerOpening(pair)
  const { missionary, christian } = pair
  await missionary.page.getByRole('radio', { name: /Different accounts/ }).check()
  await missionary.page.getByRole('button', { name: 'I’ve asked it' }).click()
  await (await exampleAnswer(christian.page)).toggle.click()
  await christian.page.getByText('More help', { exact: true }).click()
  const transcript = christian.page.getByRole('link', { name: /1832 transcript.*opens in a new tab/ })
  await expect(transcript).toHaveAttribute('href', /^https:\/\/www\.churchofjesuschrist\.org\//)
  await expect(transcript).toHaveAttribute('target', '_blank')
  await expect(christian.page.getByRole('link', { name: /Joseph Smith—History 1:17/ })).toBeVisible()
  await expect(christian.page.getByRole('button', { name: /Joseph Smith/ })).toHaveCount(0)
  await closePair(pair)
})
