import { describe, expect, it } from 'vitest'
import file from '../../../content/scenarios/week-one-christians-too.v1.json'
import repliesFile from '../../../content/scenarios/week-one-christians-too.v2.json'
import { CLARIFICATION_ID, CLOSING_ID, OPENING_ID, type ConversationContent } from '../../lib/conversation'
import { parseScenarioFile, toStoredContent } from '../../lib/content'
import type { HistoryEntry } from '../../sessions/types'
import {
  answerId,
  canSpeak,
  conversationProgress,
  directionChoices,
  FREE_RESPONSE_ID,
  FREE_RESPONSE_TEXT,
  NOT_SURE_ID,
  OWN_WORDS_TEXT,
  responseOptions,
  responseText,
  suggestNext,
  threadMessages,
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

  it('leaves only the closing once every topic and follow-up has been spoken', () => {
    const all: HistoryEntry[] = [m(OPENING_ID), c(FREE_RESPONSE_ID)]
    for (const topic of content.topics) {
      for (const beat of [topic.question, ...topic.followUps]) all.push(m(beat.id), c(FREE_RESPONSE_ID))
    }
    const progress = conversationProgress(content, all)
    expect(suggestNext(content, progress)).toBeNull()
    expect(directionChoices(content, progress)).toEqual({ continueTopic: [], otherDirections: [] })
    expect(canSpeak(content, progress, CLOSING_ID)).toBe(true)
  })
})

const parsedReplies = parseScenarioFile(repliesFile)
if (!parsedReplies.success) throw new Error('week-one-christians-too.v2.json does not parse')
const replies = toStoredContent(parsedReplies.data) as ConversationContent

describe('conversation model with missionary replies (3.1)', () => {
  const asked = [m(OPENING_ID), c(answerId(0)), m('christianity')]

  it('offers the Christian authored answers by id and resolves them in the thread', () => {
    const beat = conversationProgress(replies, asked).lastBeat
    expect(beat && responseOptions(replies, beat).map((option) => option.id)).toEqual([
      'christianity-eternal-son',
      'christianity-compare-meaning',
      NOT_SURE_ID,
    ])
    expect(responseText(replies, beat, 'christianity-eternal-son')).toMatch(/^Following Jesus is central/)
    expect(responseText(replies, beat, answerId(0))).toBeNull()
  })

  it('suggests the reply matched to the confirmed answer and allows only replies, own words, clarify, or closing', () => {
    const progress = conversationProgress(replies, [...asked, c('christianity-eternal-son')])
    expect(progress.responding?.parent.id).toBe('christianity')
    expect(progress.responding?.matchedId).toBe('christianity-reply-who-jesus-is')
    expect(suggestNext(replies, progress)).toBe('christianity-reply-who-jesus-is')
    for (const id of ['christianity-reply-compare', FREE_RESPONSE_ID, CLARIFICATION_ID, CLOSING_ID]) {
      expect(canSpeak(replies, progress, id)).toBe(true)
    }
    for (const id of ['history', 'christianity-call-us-christians', 'christianity-reply-godhead']) {
      expect(canSpeak(replies, progress, id)).toBe(false)
    }
  })

  it('maps the clarifying question and "not sure", and has no match for a free answer', () => {
    const matched = (id: string) => conversationProgress(replies, [...asked, c(id)]).responding?.matchedId
    expect(matched(CLARIFICATION_ID)).toBe('christianity-reply-who-jesus-is')
    expect(matched(NOT_SURE_ID)).toBe('christianity-reply-read-together')
    expect(matched(FREE_RESPONSE_ID)).toBeNull()
    expect(suggestNext(replies, conversationProgress(replies, [...asked, c(FREE_RESPONSE_ID)]))).toBeNull()
  })

  it('continues after a reply: the topic’s follow-ups again, no more replies', () => {
    const progress = conversationProgress(replies, [...asked, c('christianity-eternal-son'), m('christianity-reply-who-jesus-is')])
    expect(progress.responding).toBeNull()
    expect(progress.afterReply).toBe(true)
    expect(progress.activeTopicId).toBe('christianity')
    expect(suggestNext(replies, progress)).toBe('christianity-call-us-christians')
    expect(canSpeak(replies, progress, 'christianity-reply-compare')).toBe(false)
    expect(canSpeak(replies, progress, FREE_RESPONSE_ID)).toBe(false)
  })

  it('returns to the same line after the clarification, without a match and without a second clarification', () => {
    const progress = conversationProgress(replies, [...asked, c(FREE_RESPONSE_ID), m(CLARIFICATION_ID), c(answerId(0))])
    expect(progress.responding?.parent.id).toBe('christianity')
    expect(progress.responding?.matchedId).toBeNull()
    expect(canSpeak(replies, progress, CLARIFICATION_ID)).toBe(false)
  })

  it('skips replies on a line that has none yet', () => {
    const progress = conversationProgress(replies, [m(OPENING_ID), c(answerId(0)), m('history'), c('history-a1')])
    expect(progress.responding).toBeNull()
    expect(canSpeak(replies, progress, 'history-ask-god-for-wisdom')).toBe(true)
  })

  it('shows replies with their topic, and a reply in their own words as a neutral marker', () => {
    const thread = threadMessages(replies, [
      ...asked,
      c('christianity-eternal-son'),
      m('christianity-reply-who-jesus-is'),
      m('christianity-why-trinity'),
      c(FREE_RESPONSE_ID),
      m(FREE_RESPONSE_ID),
    ])
    expect(thread[4]).toMatchObject({ speaker: 'missionary', caption: 'Reply · Being Christian', free: false })
    expect(thread[4].text).toMatch(/^We believe Jesus Christ is the Son of God/)
    expect(thread.at(-1)).toMatchObject({ speaker: 'missionary', text: OWN_WORDS_TEXT, free: true })
  })
})
