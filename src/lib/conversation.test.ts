import { describe, expect, it } from 'vitest'
import v1 from '../../content/scenarios/week-one-christians-too.v1.json'
import v2 from '../../content/scenarios/week-one-christians-too.v2.json'
import { conversationFileSchema, conversationWarnings } from './conversation'

type Draft = typeof v2 & Record<string, unknown>

/** A deep copy of the 3.1 draft, changed by `edit`. */
function draft(edit: (file: Draft) => void = () => {}): Draft {
  const file = structuredClone(v2) as Draft
  edit(file)
  return file
}

/** The Being Christian question in a copy. */
const question = (file: Draft) => file.topics[0].question as unknown as Record<string, any>

function errors(file: unknown): string[] {
  const result = conversationFileSchema.safeParse(file)
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`)
}

describe('conversation schema 3.1', () => {
  it('accepts the 3.1 draft and keeps the published 3.0 version valid', () => {
    expect(errors(v2)).toEqual([])
    expect(errors(v1)).toEqual([])
  })

  it('keeps answer ids and replies out of 3.0 content', () => {
    const file = draft((f) => {
      f.schemaVersion = '3.0'
    })
    expect(errors(file)).toEqual(
      expect.arrayContaining([
        'topics.0.question.help.answers Answer ids need schemaVersion "3.1"',
        'topics.0.question.respond Reply support needs schemaVersion "3.1"',
      ]),
    )
  })

  it('requires stable ids on every 3.1 answer and refuses positional or duplicate ids', () => {
    expect(errors(draft((f) => (question(f).help.answers[0] = 'Plain text.')))).toContain(
      'topics.0.question.help.answers.0 Give each answer an id',
    )
    expect(errors(draft((f) => (question(f).help.answers[0].id = 'answer-1')))).toContain(
      'topics.0.question.help.answers.0.id "answer-1" is reserved for positional answers',
    )
    expect(errors(draft((f) => (question(f).help.answers[1].id = 'christianity-why-trinity')))).toContain(
      'topics.0.followUps.1.id Duplicate id "christianity-why-trinity"',
    )
    expect(errors(draft((f) => (question(f).respond.replies[0].id = 'free')))).toContain(
      'topics.0.question.respond.replies.0.id Duplicate id "free"',
    )
  })

  it('checks that every answer, the clarifying question, "not sure", and each heard label map to this line’s replies', () => {
    expect(errors(draft((f) => delete question(f).help.answers[0].reply))).toContain(
      'topics.0.question.help.answers.0.reply Map each answer to a reply',
    )
    expect(errors(draft((f) => (question(f).help.answers[0].reply = 'christianity-reply-godhead')))).toContain(
      'topics.0.question.help.answers.0.reply Unknown reply "christianity-reply-godhead"',
    )
    expect(errors(draft((f) => delete question(f).respond.clarifyReply))).toContain(
      'topics.0.question.respond.clarifyReply Map the clarifying question to a reply',
    )
    expect(errors(draft((f) => (question(f).respond.notSureReply = 'nope')))).toContain(
      'topics.0.question.respond.notSureReply Unknown reply "nope"',
    )
    expect(errors(draft((f) => (question(f).respond.heard[1].reply = question(f).respond.heard[0].reply)))).toContain(
      'topics.0.question.respond.heard.1.reply Each heard label needs its own reply',
    )
  })

  it('requires Christian help exactly when a reply hands the turn over', () => {
    expect(errors(draft((f) => (question(f).respond.replies[0].next = 'christian-response')))).toContain(
      'topics.0.question.respond.replies.0.help A reply that hands the turn over needs Christian help',
    )
    const asking = draft((f) => {
      question(f).respond.replies[0].next = 'christian-response'
      question(f).respond.replies[0].help = { hint: 'Say what matters.', answers: [{ id: 'asking-answer', text: 'This.' }] }
    })
    expect(errors(asking)).toEqual([])
    expect(
      errors(draft((f) => (question(f).respond.replies[0].help = { hint: 'Hint.', answers: [{ id: 'x-answer', text: 'This.' }] }))),
    ).toContain('topics.0.question.respond.replies.0.help Only a reply that hands the turn over has Christian help')
  })

  it('checks passage links in replies', () => {
    expect(errors(draft((f) => (question(f).respond.replies[0].text = 'See [this](ref:not-a-passage).')))).toContain(
      'topics.0.question.respond.replies.0.text Unknown passage "not-a-passage"',
    )
  })

  it('warns about lines without replies yet and replies nothing leads to', () => {
    const parsed = conversationFileSchema.parse(
      draft((f) => question(f).respond.replies.push({ id: 'unused-reply', label: 'Unused', text: 'Unused.', next: 'continue' })),
    )
    const warnings = conversationWarnings(parsed)
    expect(warnings).toContain('beat "history" has no reply support yet')
    expect(warnings).toContain('reply "unused-reply" is never offered')
    expect(warnings.some((warning) => warning.includes('"christianity"'))).toBe(false)
  })
})
