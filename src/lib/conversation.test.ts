import { describe, expect, it } from 'vitest'
import v1 from '../../content/scenarios/week-one-christians-too.v1.json'
import v2 from '../../content/scenarios/week-one-christians-too.v2.json'
import v3 from '../../content/scenarios/week-one-christians-too.v3.json'
import lesson from '../../content/scenarios/lesson-one-first-vision.v1.json'
import lessonV2 from '../../content/scenarios/lesson-one-first-vision.v2.json'
import lessonV3 from '../../content/scenarios/lesson-one-first-vision.v3.json'
import hardMode from '../../content/scenarios/week-one-hard-mode.v1.json'
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

describe('week one, version 3: the three kingdoms stated up front', () => {
  it('changes only the main "Life after death" question from version 2', () => {
    expect(errors(v3)).toEqual([])
    const { version: _v3, sourceNotes: _v3Notes, ...rest3 } = structuredClone(v3)
    const { version: _v2, sourceNotes: _v2Notes, ...rest2 } = structuredClone(v2)
    const afterlife = (file: typeof rest2) => file.topics.find((topic) => topic.id === 'afterlife')!.question
    expect(afterlife(rest3).text).toBe(
      'We believe that after resurrection and judgment, almost everyone will receive a place in one of three kingdoms of glory: the celestial, terrestrial, or telestial kingdom. The celestial is the highest, where people can live in Heavenly Father’s presence.\n\nWe believe God revealed more about these kingdoms through Joseph Smith. We connect this teaching with Jesus’ words, “[In my Father’s house are many mansions.](ref:john-14-1-6)” How do you understand that promise?',
    )
    afterlife(rest3).text = afterlife(rest2).text
    expect(rest3).toEqual(rest2)
  })
})

describe('Lesson 1: Introduction & First Vision', () => {
  const answer = (id: string) => lesson.topics.find((topic) => topic.id === id)!.question.help.answers[0]
  const spoken = [lesson.opening.text, ...lesson.topics.map((topic) => topic.question.text), lesson.closing.text]
  const christian = [...lesson.opening.help.answers, ...lesson.topics.map((topic) => topic.question.help.answers[0])]

  it('is a valid, separate scenario with the five exchanges in worksheet order and no follow-ups', () => {
    expect(errors(lesson)).toEqual([])
    expect(lesson).toMatchObject({ id: 'lesson-one-first-vision', title: 'Introduction & First Vision', speakAloud: true })
    expect(lesson.topics.map((topic) => topic.id)).toEqual([
      'church-name',
      'first-vision-accounts',
      'gospel-comparison',
      'age-difference',
      'unfamiliar-accounts',
    ])
    for (const topic of lesson.topics) expect(topic.followUps).toEqual([])
    expect(lesson.reflection.prompts).toEqual(['Which course point do you feel more ready to explain now?'])
  })

  it('never has the Christian ask a question back, and keeps every answer and line free of filler', () => {
    for (const text of christian) expect(text).not.toContain('?')
    for (const text of [...spoken, ...christian]) expect(text).not.toMatch(/…|\.\.\./)
  })

  it('keeps the course’s arguments, stated accurately', () => {
    expect(answer('church-name')).toContain('“I’m a Mormon.”')
    expect(answer('church-name')).toMatch(/President Nelson said leaving Jesus’ name out of the Church’s name was a victory for Satan/)
    expect(answer('first-vision-accounts')).toMatch(/nine written accounts: four .* and five written by people who heard him tell it/)
    expect(answer('age-difference')).toMatch(/The 1832 account places him at 15, while later accounts say he was about 14/)
    const { sourceNotes: _notes, ...shown } = lesson
    const all = JSON.stringify(shown)
    expect(all).not.toMatch(/6\.1|million/)
    expect(all).not.toMatch(/age 16|16 years old/)
    expect(all).toContain('“sixteenth year,” which means age 15')
  })

  it('labels the Book of Mormon passage as such, and every other passage as KJV', () => {
    const sources = Object.fromEntries(lesson.passages.items.map((passage) => [passage.id, 'source' in passage ? passage.source : 'KJV']))
    expect(sources).toEqual({
      '3-nephi-27-7-8': 'Book of Mormon',
      'james-1-2-6': 'KJV',
      '1-john-4-1-3': 'KJV',
      'luke-1-1-4': 'KJV',
      'proverbs-18-13-17': 'KJV',
      '1-peter-3-13-16': 'KJV',
    })
    expect(lesson.topics[0].question.caption).toBe('3 Nephi 27:7–8 · Book of Mormon')
  })

  it('refuses a caption that names an unknown passage', () => {
    const file = structuredClone(lesson)
    file.topics[0].question.passage = 'missing-passage'
    expect(errors(file)).toEqual(['topics.0.question.passage Unknown passage "missing-passage"'])
  })
})

describe('Lesson 1, version 2: the worksheet questions and answers', () => {
  const questions = lessonV2.topics.map((topic) => topic.question)
  const { sourceNotes: _notes, ...shown } = lessonV2
  const all = JSON.stringify(shown)

  it('keeps the introduction and goodbye around the five worksheet questions, in order, with no follow-ups', () => {
    expect(errors(lessonV2)).toEqual([])
    expect(lessonV2).toMatchObject({ id: 'lesson-one-first-vision', version: 2, title: 'Introduction & First Vision', speakAloud: true })
    expect(lessonV2.opening).toEqual(lesson.opening)
    expect(lessonV2.closing).toEqual({ ...lesson.closing, caption: 'Wrap up conversation' })
    expect(questions.map((question) => question.caption)).toEqual([1, 2, 3, 4, 5].map((n) => `Lesson 1 · Question ${n}`))
    expect(questions[0].text).toBe('Why is the use or non-use of the word Mormon a good thing to bring up with your Mormon friend?')
    expect(questions[4].text).toBe(
      'How would you respond if your Mormon friend or neighbor was unaware that there were multiple first vision accounts?',
    )
    for (const topic of lessonV2.topics) expect(topic.followUps).toEqual([])
  })

  it('offers only the lesson answer as help: one answer, no notes, evidence, passages or reading links', () => {
    for (const question of questions) {
      expect(question.help.answers).toHaveLength(1)
      expect(Object.keys(question.help).sort()).toEqual(['answers', 'hint'])
      expect(question).not.toHaveProperty('passage')
      expect(question.text).not.toContain('(ref:')
    }
  })

  it('fixes the worksheet typos', () => {
    expect(all).not.toMatch(/you're your|you’re your|document first|\bfirs\b|do the LDS church/)
    expect(questions[3].help.answers[0]).toContain('there was really only one first vision')
    expect(questions[1].help.answers[0]).toContain('nine different documented first vision accounts')
  })

  it('applies the accuracy rules: no unverified campaign claims, and President Nelson quoted exactly', () => {
    expect(all).not.toMatch(/6\.1|million|same year/)
    expect(all).not.toMatch(/every time the term Mormon/)
    expect(questions[0].help.answers[0]).toContain('to remove the Lord’s name from the Lord’s Church is “a major victory for Satan.”')
    expect(questions[3].help.answers[0]).toContain('“Is it possible there were multiple first visions?”')
  })
})

describe('Hard mode: week one with missionary replies (schema 3.1)', () => {
  const hardBeats = hardMode.topics.flatMap((topic) => [topic.question, ...topic.followUps])

  it('parses, and asks week one v3’s lines word for word, including the three-kingdoms afterlife question', () => {
    expect(errors(hardMode)).toEqual([])
    expect(hardMode).toMatchObject({ id: 'week-one-hard-mode', version: 1, schemaVersion: '3.1', title: 'Hard mode' })
    const asked = (file: typeof v3 | typeof hardMode) =>
      file.topics.flatMap((topic) => [topic.question, ...topic.followUps]).map(({ id, text, caption }) => ({ id, text, caption }))
    expect(asked(hardMode)).toEqual(asked(v3))
    expect(hardMode.opening.text).toBe(v3.opening.text)
    expect(hardMode.closing).toEqual(v3.closing)
    expect(hardMode).not.toHaveProperty('hardMode')
  })

  it('gives every question and follow-up replies, and matches every Christian answer to one of them', () => {
    for (const beat of hardBeats) {
      const replyIds = beat.respond.replies.map((reply) => reply.id)
      for (const answer of beat.help.answers) expect(replyIds).toContain(answer.reply)
      expect(replyIds).toContain(beat.respond.clarifyReply)
      expect(replyIds).toContain(beat.respond.notSureReply)
      for (const heard of beat.respond.heard) expect(replyIds).toContain(heard.reply)
      for (const reply of beat.respond.replies) expect(reply.next).toBe('continue')
    }
  })

  it('rejects replies in a 3.0 file, and a 3.1 answer without a reply', () => {
    const asOld = structuredClone(hardMode) as Record<string, unknown>
    asOld.schemaVersion = '3.0'
    expect(errors(asOld)).not.toEqual([])
    const unmatched = structuredClone(hardMode)
    delete (unmatched.topics[0].question.help.answers[0] as { reply?: string }).reply
    expect(errors(unmatched)).not.toEqual([])
  })
})

describe('Lesson 1, version 3: links to Hard mode', () => {
  it('is version 2 plus the Hard mode link, nothing else', () => {
    expect(errors(lessonV3)).toEqual([])
    const { version: _v3, status: _s3, hardMode: link, ...rest } = lessonV3
    const { version: _v2, status: _s2, ...previous } = lessonV2
    expect(rest).toEqual(previous)
    expect(link).toEqual({ scenarioId: 'week-one-hard-mode' })
  })

  it('refuses an invalid Hard mode id', () => {
    const file = structuredClone(lessonV3)
    file.hardMode.scenarioId = 'Not An Id'
    expect(errors(file)).not.toEqual([])
  })
})
