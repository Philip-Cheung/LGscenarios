import { describe, expect, it } from 'vitest'
import file from '../../../content/scenarios/week-one-christians-too.v1.json'
import lessonFile from '../../../content/scenarios/lesson-one-first-vision.v1.json'
import lessonV2File from '../../../content/scenarios/lesson-one-first-vision.v2.json'
import preparedFile from '../../../content/scenarios/week-one-christians-too.v3.json'
import { CLARIFICATION_ID, CLOSING_ID, OPENING_ID, type ConversationContent } from '../../lib/conversation'
import { parseScenarioFile, toStoredContent } from '../../lib/content'
import type { HistoryEntry } from '../../sessions/types'
import {
  answerId,
  canSpeak,
  conversationProgress,
  directionChoices,
  findBeat,
  FREE_RESPONSE_ID,
  FREE_RESPONSE_TEXT,
  NOT_SURE_ID,
  responseOptions,
  responseText,
  suggestNext,
  threadMessages,
  topicsExhausted,
} from './model'

const parsed = parseScenarioFile(file)
if (!parsed.success) throw new Error('week-one-christians-too.v1.json does not parse')
const content = toStoredContent(parsed.data) as ConversationContent
const [christianity, history, god] = content.topics

const m = (id: string): HistoryEntry => ({ speaker: 'missionary', id })
const c = (id: string): HistoryEntry => ({ speaker: 'christian', id })

describe('conversation model', () => {
  it('starts with the introduction and offers only the welcome replies', () => {
    const progress = conversationProgress(content, [])
    expect(suggestNext(content, progress)).toBe(OPENING_ID)
    expect(canSpeak(content, progress, OPENING_ID)).toBe(true)
    expect(canSpeak(content, progress, christianity.question.id)).toBe(false)
    const opening = conversationProgress(content, [m(OPENING_ID)]).lastBeat
    expect(opening && responseOptions(content, opening).map((option) => option.id)).toEqual(
      content.opening.help.answers.map((_, index) => answerId(index)),
    )
  })

  it('shows a free reply as the neutral marker, never a transcript', () => {
    const [, reply] = threadMessages(content, [m(OPENING_ID), c(FREE_RESPONSE_ID)])
    expect(reply).toMatchObject({ speaker: 'christian', text: FREE_RESPONSE_TEXT, free: true })
    expect(reply.caption).toBe('Spoken response · not transcribed')
  })

  it('shows a chosen reply in full, with the not-sure and clarify replies resolved against the last line', () => {
    const thread = threadMessages(content, [
      m(OPENING_ID),
      c(answerId(0)),
      m(god.question.id),
      c(NOT_SURE_ID),
      m(god.followUps[0].id),
      c(CLARIFICATION_ID),
    ])
    expect(thread[1].text).toBe(content.opening.help.answers[0])
    expect(thread[3].text).toBe(content.notSureAnswer)
    expect(thread[5].text).toBe(god.followUps[0].help.clarify)
    expect(thread[3].caption).toBe('Suggested response · confirmed aloud')
  })

  it('suggests the active topic’s next follow-up, then the next unasked topic', () => {
    const asked = [m(OPENING_ID), c(FREE_RESPONSE_ID), m(christianity.question.id), c(FREE_RESPONSE_ID)]
    expect(suggestNext(content, conversationProgress(content, asked))).toBe(christianity.followUps[0].id)
    const followed = [...asked, ...christianity.followUps.flatMap((followUp) => [m(followUp.id), c(FREE_RESPONSE_ID)])]
    expect(suggestNext(content, conversationProgress(content, followed))).toBe(history.question.id)
  })

  it('offers follow-ups for the active topic only and drops exhausted prompts', () => {
    const progress = conversationProgress(content, [
      m(OPENING_ID),
      c(FREE_RESPONSE_ID),
      m(god.question.id),
      c(FREE_RESPONSE_ID),
      m(god.followUps[0].id),
      c(FREE_RESPONSE_ID),
    ])
    const choices = directionChoices(content, progress)
    expect(choices.continueTopic.map((choice) => choice.beatId)).toEqual(god.followUps.slice(1).map((followUp) => followUp.id))
    expect(choices.otherDirections.map((choice) => choice.beatId)).not.toContain(god.question.id)
    expect(canSpeak(content, progress, god.followUps[0].id)).toBe(false)
    expect(canSpeak(content, progress, christianity.followUps[0].id)).toBe(false)
    expect(canSpeak(content, progress, history.question.id)).toBe(true)
  })

  it('allows one clarification at a time, and only inside a topic', () => {
    const opened = conversationProgress(content, [m(OPENING_ID), c(FREE_RESPONSE_ID)])
    expect(canSpeak(content, opened, CLARIFICATION_ID)).toBe(false)
    const inTopic = [m(OPENING_ID), c(FREE_RESPONSE_ID), m(god.question.id), c(FREE_RESPONSE_ID)]
    expect(canSpeak(content, conversationProgress(content, inTopic), CLARIFICATION_ID)).toBe(true)
    const clarified = [...inTopic, m(CLARIFICATION_ID), c(FREE_RESPONSE_ID)]
    const progress = conversationProgress(content, clarified)
    expect(canSpeak(content, progress, CLARIFICATION_ID)).toBe(false)
    expect(progress.activeTopicId).toBe(god.id)
  })

  it('prepares the closing once every topic and follow-up has been spoken', () => {
    const all: HistoryEntry[] = [m(OPENING_ID), c(FREE_RESPONSE_ID)]
    for (const topic of content.topics) {
      for (const beat of [topic.question, ...topic.followUps]) {
        expect(topicsExhausted(content, conversationProgress(content, all))).toBe(false)
        all.push(m(beat.id), c(FREE_RESPONSE_ID))
      }
    }
    const progress = conversationProgress(content, all)
    expect(suggestNext(content, progress)).toBe(CLOSING_ID)
    expect(topicsExhausted(content, progress)).toBe(true)
    expect(directionChoices(content, progress)).toEqual({ continueTopic: [], otherDirections: [] })
    expect(canSpeak(content, progress, CLOSING_ID)).toBe(true)
  })
})

const parsedPrepared = parseScenarioFile(preparedFile)
if (!parsedPrepared.success) throw new Error('week-one-christians-too.v3.json does not parse')
const prepared = toStoredContent(parsedPrepared.data) as ConversationContent

describe('conversation model, prepared questions only (week one v2)', () => {
  const asked = [m(OPENING_ID), c(answerId(0)), m(prepared.topics[0].question.id)]

  it('offers the Christian exactly the authored answer: no "not sure" and no clarifying question', () => {
    const beat = conversationProgress(prepared, asked).lastBeat
    expect(beat && responseOptions(prepared, beat)).toEqual([{ id: answerId(0), text: prepared.topics[0].question.help.answers[0] }])
    expect(beat?.help?.clarify).toBeUndefined()
    expect(responseText(prepared, beat, NOT_SURE_ID)).toBeNull()
    expect(responseText(prepared, beat, CLARIFICATION_ID)).toBeNull()
  })

  it('never offers the missionary a clarification', () => {
    const answered = conversationProgress(prepared, [...asked, c(FREE_RESPONSE_ID)])
    expect(findBeat(prepared, CLARIFICATION_ID)).toBeNull()
    expect(canSpeak(prepared, answered, CLARIFICATION_ID)).toBe(false)
  })

  it('suggests every prepared question once, in order: each main question, its follow-ups, then the next topic', () => {
    const expected = prepared.topics.flatMap((topic) => [topic.question.id, ...topic.followUps.map((followUp) => followUp.id)])
    const history: HistoryEntry[] = [m(OPENING_ID), c(answerId(0))]
    const suggested: string[] = []
    for (let next = suggestNext(prepared, conversationProgress(prepared, history)); next !== CLOSING_ID; ) {
      suggested.push(next)
      history.push(m(next), c(answerId(0)))
      next = suggestNext(prepared, conversationProgress(prepared, history))
    }
    expect(suggested).toEqual(expected)
    expect(canSpeak(prepared, conversationProgress(prepared, history), CLOSING_ID)).toBe(true)
  })

  it('follows a question the missionary chose by hand, and skips questions already asked', () => {
    const [christianity, , god] = prepared.topics
    const jumped = [...asked, c(answerId(0)), m(god.question.id), c(FREE_RESPONSE_ID)]
    expect(suggestNext(prepared, conversationProgress(prepared, jumped))).toBe(god.followUps[0].id)
    const godDone = [...jumped, ...god.followUps.flatMap((followUp) => [m(followUp.id), c(answerId(0))])]
    // Being Christian's main question was asked, so its follow-ups are no longer reachable; the next topic is.
    expect(suggestNext(prepared, conversationProgress(prepared, godDone))).toBe(prepared.topics[1].question.id)
    expect(canSpeak(prepared, conversationProgress(prepared, godDone), christianity.question.id)).toBe(false)
  })

  it('shows a confirmed answer in full and a free answer as the neutral marker', () => {
    const thread = threadMessages(prepared, [...asked, c(answerId(0))])
    expect(thread.at(-1)).toMatchObject({ speaker: 'christian', text: prepared.topics[0].question.help.answers[0], free: false })
    expect(threadMessages(prepared, [...asked, c(FREE_RESPONSE_ID)]).at(-1)).toMatchObject({ text: FREE_RESPONSE_TEXT, free: true })
  })
})

const parsedLesson = parseScenarioFile(lessonFile)
if (!parsedLesson.success) throw new Error('lesson-one-first-vision.v1.json does not parse')
const lesson = toStoredContent(parsedLesson.data) as ConversationContent

describe('conversation model, Lesson 1 (Introduction & First Vision)', () => {
  const LESSON_ORDER = ['church-name', 'first-vision-accounts', 'gospel-comparison', 'age-difference', 'unfamiliar-accounts']

  it('prepares the five exchanges in worksheet order after the introduction, then the wrap-up', () => {
    const history: HistoryEntry[] = [m(OPENING_ID), c(answerId(0))]
    const suggested: string[] = []
    for (let next = suggestNext(lesson, conversationProgress(lesson, history)); next !== CLOSING_ID; ) {
      suggested.push(next)
      history.push(m(next), c(answerId(0)))
      next = suggestNext(lesson, conversationProgress(lesson, history))
    }
    expect(suggested).toEqual(LESSON_ORDER)
    expect(topicsExhausted(lesson, conversationProgress(lesson, history))).toBe(true)
  })

  it('completes an exchange only once it is spoken, and keeps track of exchanges chosen out of order', () => {
    const opened = conversationProgress(lesson, [m(OPENING_ID), c(answerId(0))])
    expect(opened.askedTopicIds.size).toBe(0)
    const jumped = [m(OPENING_ID), c(answerId(0)), m('age-difference'), c(FREE_RESPONSE_ID)]
    const progress = conversationProgress(lesson, jumped)
    expect([...progress.askedTopicIds]).toEqual(['age-difference'])
    expect(suggestNext(lesson, progress)).toBe('church-name')
    expect(canSpeak(lesson, progress, 'age-difference')).toBe(false)
  })

  it('offers one suggested answer per exchange, with the learning note and other help kept on the beat', () => {
    for (const id of LESSON_ORDER) {
      const beat = findBeat(lesson, id)
      expect(beat && responseOptions(lesson, beat)).toHaveLength(1)
      expect(beat?.help?.note).toBeTruthy()
    }
    expect(findBeat(lesson, 'age-difference')?.help?.evidence?.heading).toBe('What do the accounts say?')
    expect(findBeat(lesson, 'unfamiliar-accounts')?.help?.reading?.url).toBe(
      'https://www.churchofjesuschrist.org/study/manual/gospel-topics-essays/first-vision-accounts?lang=eng',
    )
  })

  it('lets a caption open the passage it names, on both phones', () => {
    const thread = threadMessages(lesson, [m(OPENING_ID), c(answerId(0)), m('church-name')])
    expect(thread.at(-1)).toMatchObject({ speaker: 'missionary', caption: '3 Nephi 27:7–8 · Book of Mormon', passage: '3-nephi-27-7-8' })
  })
})

const parsedLessonV2 = parseScenarioFile(lessonV2File)
if (!parsedLessonV2.success) throw new Error('lesson-one-first-vision.v2.json does not parse')
const lessonV2 = toStoredContent(parsedLessonV2.data) as ConversationContent

describe('conversation model, Lesson 1 version 2 (worksheet questions)', () => {
  it('prepares the five questions in worksheet order after the introduction, then the wrap-up', () => {
    const history: HistoryEntry[] = [m(OPENING_ID), c(answerId(0))]
    const suggested: string[] = []
    for (let next = suggestNext(lessonV2, conversationProgress(lessonV2, history)); next !== CLOSING_ID; ) {
      suggested.push(next)
      expect(responseOptions(lessonV2, findBeat(lessonV2, next)!)).toHaveLength(1)
      history.push(m(next), c(answerId(0)))
      next = suggestNext(lessonV2, conversationProgress(lessonV2, history))
    }
    expect(suggested).toEqual(['word-mormon', 'first-vision-accounts', 'expected-response', 'best-rejoinder', 'unaware-friend'])
    expect(topicsExhausted(lessonV2, conversationProgress(lessonV2, history))).toBe(true)
  })
})
