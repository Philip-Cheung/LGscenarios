import { sampleDoorstepV1 } from './sample-doorstep.v1'
import { sampleDoorstepV2 } from './sample-doorstep.v2'
import { answerFor, isBranchPrompt, spokenLine, waitText } from './present'

describe('scenario presentation', () => {
  it('keeps older prompts as a single spoken line', () => {
    const prompt = sampleDoorstepV1.prompts[0]
    expect(isBranchPrompt(prompt)).toBe(false)
    expect(spokenLine(prompt, null)).toBe(prompt.text)
    expect(waitText(prompt)).toBeNull()
  })

  it('hides unused conditional responses until a branch is chosen', () => {
    const prompt = sampleDoorstepV2.prompts[2]
    expect(spokenLine(prompt, null)).toBeNull()
    expect(answerFor(prompt, null)).toBeNull()
    expect(spokenLine(prompt, 'they-agree')).toBe('Thank you. I will keep this short.')
    expect(answerFor(prompt, 'they-agree')).toBe('That sounds fine.')
    expect(spokenLine(prompt, 'something-else')).not.toBe(spokenLine(prompt, 'they-agree'))
  })

  it('keeps the wait instruction off the spoken line', () => {
    const prompt = sampleDoorstepV2.prompts[0]
    expect(spokenLine(prompt, null)).toBe('Hello. May I ask you one short question?')
    expect(waitText(prompt)).toBe('Stop and allow them to respond.')
  })
})
