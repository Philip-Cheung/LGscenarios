import { allScenarios } from '../scenarios'
import { validateScenarioSet } from './content'

const valid = {
  scenarioId: 'test-scenario',
  slug: 'test-scenario',
  version: 1,
  title: 'Test',
  prompts: [{ id: 'one', label: 'One', text: 'Question?', suggestedAnswer: 'Answer.' }],
}

describe('validateScenarioSet', () => {
  it('accepts the bundled scenarios without errors', () => {
    expect(validateScenarioSet(allScenarios).errors).toEqual([])
  })

  it('rejects markup and unknown fields', () => {
    const report = validateScenarioSet([
      { ...valid, prompts: [{ ...valid.prompts[0], text: '<b>Hi</b>', html: true }] },
    ])
    expect(report.errors.join('\n')).toMatch(/angle brackets/)
    expect(report.errors.join('\n')).toMatch(/html/)
  })

  it('rejects duplicate prompt ids and empty prompt lists', () => {
    const duplicate = validateScenarioSet([{ ...valid, prompts: [valid.prompts[0], valid.prompts[0]] }])
    expect(duplicate.errors.join('\n')).toMatch(/Duplicate prompt id/)
    expect(validateScenarioSet([{ ...valid, prompts: [] }]).errors).not.toEqual([])
  })

  it('enforces one scenario per slug across versions', () => {
    const report = validateScenarioSet([valid, { ...valid, scenarioId: 'other', version: 2 }])
    expect(report.errors.join('\n')).toMatch(/used by both/)
  })

  it('rejects duplicate versions', () => {
    expect(validateScenarioSet([valid, valid]).errors.join('\n')).toMatch(/Duplicate scenario version/)
  })

  it('warns, without failing, when text is long for a phone screen', () => {
    const report = validateScenarioSet([{ ...valid, prompts: [{ ...valid.prompts[0], text: 'a'.repeat(200) }] }])
    expect(report.errors).toEqual([])
    expect(report.warnings).toHaveLength(1)
  })
})
