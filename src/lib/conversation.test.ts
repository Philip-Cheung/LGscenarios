import { describe, expect, it } from 'vitest'
import v1 from '../../content/scenarios/week-one-christians-too.v1.json'
import v2 from '../../content/scenarios/week-one-christians-too.v2.json'
import { conversationFileSchema } from './conversation'

function errors(file: unknown): string[] {
  const result = conversationFileSchema.safeParse(file)
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`)
}

const beats = (file: typeof v1 | typeof v2) => file.topics.flatMap((topic) => [topic.question, ...topic.followUps])

describe('conversation schema 3.0', () => {
  it('accepts the published version 1 and the prepared-questions version 2', () => {
    expect(errors(v1)).toEqual([])
    expect(errors(v2)).toEqual([])
  })

  it('treats the clarification, "not sure", and clarifying questions as optional', () => {
    const { clarification: _clarification, notSureAnswer: _notSure, ...file } = structuredClone(v1)
    for (const beat of beats(file as typeof v1)) delete (beat.help as { clarify?: string }).clarify
    expect(errors(file)).toEqual([])
  })
})

describe('week one, version 2: prepared questions only', () => {
  it('keeps the five main questions and ten follow-ups from version 1, word for word', () => {
    expect(v2.topics).toHaveLength(5)
    for (const topic of v2.topics) expect(topic.followUps).toHaveLength(2)
    const asked = (file: typeof v1 | typeof v2) => beats(file).map(({ id, text, caption }) => ({ id, text, caption }))
    expect(asked(v2)).toEqual(asked(v1))
    expect(v2.opening.text).toBe(v1.opening.text)
    const kjv = (file: typeof v1 | typeof v2) => file.passages.items.map(({ id, label, verses }) => ({ id, label, verses }))
    expect(kjv(v2)).toEqual(kjv(v1))
  })

  it('offers one complete answer per question, with no questions back and no filler', () => {
    const answers = [...v2.opening.help.answers, ...beats(v2).flatMap((beat) => beat.help.answers)]
    for (const beat of beats(v2)) expect(beat.help.answers).toHaveLength(1)
    for (const answer of answers) {
      expect(answer).not.toContain('?')
      expect(answer).not.toMatch(/…|\.\.\./)
      expect(answer).not.toMatch(/read (that|the) passage together/i)
    }
    expect(v2.opening.help.answers).toEqual(['Sure, I have a few minutes. I’m a Christian myself.'])
  })

  it('has no clarification, "not sure", or clarifying questions to send back to the missionary', () => {
    expect(v2).not.toHaveProperty('clarification')
    expect(v2).not.toHaveProperty('notSureAnswer')
    for (const beat of beats(v2)) expect(beat.help).not.toHaveProperty('clarify')
  })

  it('words hints as help forming an answer, not as questions for the missionary', () => {
    for (const beat of beats(v2)) expect(beat.help.hint).not.toMatch(/\bask\b/i)
  })
})
