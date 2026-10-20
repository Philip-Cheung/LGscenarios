import coffeeChatV2 from '../../content/scenarios/coffee-chat.v2.json'
import sampleDoorstepV4 from '../../content/scenarios/sample-doorstep.v4.json'
import weekOneV1 from '../../content/scenarios/week-one-first-vision.v1.json'
import whoIsGodV1 from '../../content/scenarios/who-is-god.v1.json'
import { sampleDoorstep } from '../scenarios/fixtures'
import { findQuestion, scenarioFileSchema, toStoredContent, validateScenarioFiles } from './content'

const valid = {
  schemaVersion: '2.0',
  id: 'test-scenario',
  version: 1,
  status: 'draft',
  title: 'Test',
  roles: {
    missionary: { label: 'Missionary', sceneTitle: 'Outside', sceneText: 'A street.', goal: 'Talk.' },
    christian: { label: 'Christian', sceneTitle: 'Inside', sceneText: 'A home.', goal: 'Answer.' },
  },
  openingDialogue: { script: 'Hello.' },
  questions: [{ id: 'one', topic: 'One', icon: 'leaf', prompt: 'Question?', exampleAnswer: 'Answer.' }],
  conclusion: { closingPrompt: 'Thanks.' },
}

const question = valid.questions[0]

const bible = {
  translation: 'King James Version (KJV)',
  chapters: [
    {
      id: 'james-1',
      book: 'James',
      chapter: 1,
      verses: [4, 5, 6].map((number) => ({ number, text: `Verse ${number}.` })),
    },
  ],
  references: [{ id: 'james-1-5', label: 'James 1:5', chapter: 'james-1', start: 5, end: 5 }],
}

const v21 = { ...valid, schemaVersion: '2.1', bible }

describe('validateScenarioFiles', () => {
  it('accepts the scenario files in content/scenarios', () => {
    expect(validateScenarioFiles([whoIsGodV1, coffeeChatV2, sampleDoorstepV4]).errors).toEqual([])
  })

  it('rejects markup and unknown fields', () => {
    const report = validateScenarioFiles([{ ...valid, questions: [{ ...question, prompt: '<b>Hi</b>', html: true }] }])
    expect(report.errors.join('\n')).toMatch(/angle brackets/)
    expect(report.errors.join('\n')).toMatch(/html/)
  })

  it('rejects duplicate question ids and empty question lists', () => {
    const duplicate = validateScenarioFiles([{ ...valid, questions: [question, question] }])
    expect(duplicate.errors.join('\n')).toMatch(/Duplicate question id/)
    expect(validateScenarioFiles([{ ...valid, questions: [] }]).errors).not.toEqual([])
  })

  it('rejects old schema versions, unknown icons and illustrations, and unknown statuses', () => {
    const report = validateScenarioFiles([
      { ...valid, schemaVersion: '1.0' },
      { ...valid, version: 2, status: 'live' },
      { ...valid, version: 3, questions: [{ ...question, icon: 'star' }] },
      { ...valid, version: 4, illustration: 'garden' },
    ])
    expect(report.errors).toHaveLength(4)
  })

  it('rejects the retired trigger and follow-up fields', () => {
    const report = validateScenarioFiles([
      { ...valid, interactionTrigger: { initiatingRole: 'missionary' } },
      { ...valid, version: 2, questions: [{ ...question, followUps: [] }] },
    ])
    expect(report.errors).toHaveLength(2)
  })

  it('rejects duplicate versions', () => {
    expect(validateScenarioFiles([valid, valid]).errors.join('\n')).toMatch(/Duplicate scenario version/)
  })

  it('accepts the Week One scenario with its Bible passages', () => {
    expect(validateScenarioFiles([weekOneV1]).errors).toEqual([])
  })

  it('requires schemaVersion 2.1 for opening questions, follow-ups, help, and passages', () => {
    const followUp = { prompt: 'Why?', exampleAnswer: 'Because.' }
    const report = validateScenarioFiles([{ ...valid, questions: [{ ...question, followUp }] }])
    expect(report.errors.join('\n')).toMatch(/schemaVersion "2.1"/)
    expect(validateScenarioFiles([{ ...v21, questions: [{ ...question, followUp }] }]).errors).toEqual([])
  })

  it('rejects references that do not resolve to verified verses', () => {
    const report = validateScenarioFiles([
      { ...v21, questions: [{ ...question, exampleAnswer: 'See [James 1:9](ref:james-1-9).' }] },
      { ...v21, version: 2, bible: { ...bible, references: [{ ...bible.references[0], end: 9 }] } },
      { ...v21, version: 3, bible: { ...bible, references: [{ ...bible.references[0], context: { start: 5, end: 5 } }] } },
      { ...v21, version: 4, bible: { ...bible, references: [{ ...bible.references[0], context: { start: 6, end: 8 } }] } },
      { ...v21, version: 5, bible: { ...bible, references: [{ ...bible.references[0], chapter: 'james-2' }] } },
    ])
    const errors = report.errors.join('\n')
    expect(errors).toMatch(/Unknown Bible reference "james-1-9"/)
    expect(errors).toMatch(/not all in "james-1"/)
    expect(errors).toMatch(/must add surrounding verses/)
    expect(errors).toMatch(/must include the selected verses/)
    expect(errors).toMatch(/Unknown chapter "james-2"/)
  })

  it('rejects links to hosts other than the allowed source sites', () => {
    const report = validateScenarioFiles([
      { ...v21, questions: [{ ...question, exampleAnswer: 'Read [this](https://example.com/page).' }] },
    ])
    expect(report.errors.join('\n')).toMatch(/must use ref:<passage-id> or an https link/)
  })

  it('warns, without failing, when text is long for a phone screen', () => {
    const report = validateScenarioFiles([{ ...valid, questions: [{ ...question, exampleAnswer: 'a'.repeat(400) }] }])
    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(1)
  })
})

describe('toStoredContent', () => {
  it('drops file-only fields so the stored content never carries its publication status', () => {
    const stored = toStoredContent(scenarioFileSchema.parse({ ...valid, $schema: '../scenario.schema.json' }))
    expect(stored).not.toHaveProperty('status')
    expect(stored).not.toHaveProperty('$schema')
    expect(stored.id).toBe('test-scenario')
  })
})

describe('findQuestion', () => {
  it('finds the asked question, and nothing for unknown or missing ids', () => {
    expect(findQuestion(sampleDoorstep, 'hope')?.prompt).toBe('What gives you hope?')
    expect(findQuestion(sampleDoorstep, 'missing')).toBeNull()
    expect(findQuestion(sampleDoorstep, null)).toBeNull()
  })
})
