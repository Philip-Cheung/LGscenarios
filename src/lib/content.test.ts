import coffeeChatV1 from '../../content/scenarios/coffee-chat.v1.json'
import sampleDoorstepV3 from '../../content/scenarios/sample-doorstep.v3.json'
import whoIsGodV1 from '../../content/scenarios/who-is-god.v1.json'
import { whoIsGod } from '../scenarios/fixtures'
import { findDiscussionItem, scenarioFileSchema, toStoredContent, validateScenarioFiles } from './content'

const valid = {
  schemaVersion: '1.0',
  id: 'test-scenario',
  version: 1,
  status: 'draft',
  title: 'Test',
  roles: {
    missionary: { label: 'Missionary', sceneTitle: 'Outside', sceneText: 'A street.', goal: 'Talk.' },
    christian: { label: 'Christian', sceneTitle: 'Inside', sceneText: 'A home.', goal: 'Answer.' },
  },
  interactionTrigger: {
    initiatingRole: 'missionary',
    initiatorPrompt: 'You arrive.',
    initiatorActionLabel: 'Knock',
    receiverPrompt: 'Someone knocks.',
    receiverActionLabel: 'Open',
  },
  openingDialogue: { speakerRole: 'missionary', script: 'Hello.' },
  questions: [
    {
      id: 'one',
      title: 'One',
      missionaryScript: 'Question?',
      christian: { hiddenAnswer: 'Answer.' },
      followUps: [{ id: 'more', missionaryScript: 'More?', christian: { hiddenAnswer: 'More.' } }],
    },
  ],
  conclusion: { closingPrompt: 'Thanks.' },
}

const question = valid.questions[0]

describe('validateScenarioFiles', () => {
  it('accepts the scenario files in content/scenarios', () => {
    expect(validateScenarioFiles([whoIsGodV1, coffeeChatV1, sampleDoorstepV3]).errors).toEqual([])
  })

  it('rejects markup and unknown fields', () => {
    const report = validateScenarioFiles([
      { ...valid, questions: [{ ...question, missionaryScript: '<b>Hi</b>', html: true }] },
    ])
    expect(report.errors.join('\n')).toMatch(/angle brackets/)
    expect(report.errors.join('\n')).toMatch(/html/)
  })

  it('rejects duplicate question and follow-up ids, and empty question lists', () => {
    const duplicateQuestion = validateScenarioFiles([{ ...valid, questions: [question, question] }])
    expect(duplicateQuestion.errors.join('\n')).toMatch(/Duplicate question id/)
    const duplicateFollowUp = validateScenarioFiles([
      { ...valid, questions: [{ ...question, followUps: [question.followUps[0], question.followUps[0]] }] },
    ])
    expect(duplicateFollowUp.errors.join('\n')).toMatch(/Duplicate follow-up id/)
    expect(validateScenarioFiles([{ ...valid, questions: [] }]).errors).not.toEqual([])
  })

  it('rejects unknown roles, schema versions, and statuses', () => {
    const report = validateScenarioFiles([
      { ...valid, schemaVersion: '2.0' },
      { ...valid, version: 2, status: 'live' },
      { ...valid, version: 3, openingDialogue: { speakerRole: 'narrator', script: 'Hello.' } },
    ])
    expect(report.errors).toHaveLength(3)
  })

  it('rejects duplicate versions', () => {
    expect(validateScenarioFiles([valid, valid]).errors.join('\n')).toMatch(/Duplicate scenario version/)
  })

  it('warns, without failing, when text is long for a phone screen', () => {
    const report = validateScenarioFiles([{ ...valid, questions: [{ ...question, missionaryScript: 'a'.repeat(300) }] }])
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

describe('findDiscussionItem', () => {
  it('finds the active question and follow-up, and nothing for unknown ids', () => {
    expect(findDiscussionItem(whoIsGod, 'nature-of-god', null)?.question.title).toBe('Who is God?')
    expect(findDiscussionItem(whoIsGod, 'nature-of-god', 'jesus-prays')?.followUp?.id).toBe('jesus-prays')
    expect(findDiscussionItem(whoIsGod, 'nature-of-god', 'image-of-god')).toBeNull()
    expect(findDiscussionItem(whoIsGod, 'missing', null)).toBeNull()
  })
})
