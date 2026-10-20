import coffeeChatV2 from '../../content/scenarios/coffee-chat.v2.json'
import sampleDoorstepV4 from '../../content/scenarios/sample-doorstep.v4.json'
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
