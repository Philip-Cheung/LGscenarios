import type { ScenarioContent, ScenarioCue, ScenarioPrompt } from '../lib/content'

export type SpokenCue = Extract<ScenarioCue, { type: 'say' | 'challenge' }>
export type BranchCue = Extract<ScenarioCue, { type: 'ifTheySay' }>
export type BranchOption = BranchCue['options'][number]

export function branchCue(prompt: ScenarioPrompt): BranchCue | undefined {
  const cue = prompt.cues?.find((item) => item.type === 'ifTheySay')
  return cue?.type === 'ifTheySay' ? cue : undefined
}

export function isBranchPrompt(prompt: ScenarioPrompt): boolean {
  return branchCue(prompt) !== undefined
}

export function spokenCue(prompt: ScenarioPrompt): SpokenCue | undefined {
  const cue = prompt.cues?.find((item) => item.type === 'say' || item.type === 'challenge')
  return cue?.type === 'say' || cue?.type === 'challenge' ? cue : undefined
}

export function waitText(prompt: ScenarioPrompt): string | null {
  const cue = prompt.cues?.find((item) => item.type === 'wait')
  return cue?.type === 'wait' ? cue.text : null
}

export function branchOption(prompt: ScenarioPrompt, branchId: string | null): BranchOption | null {
  if (!branchId) return null
  return branchCue(prompt)?.options.find((option) => option.id === branchId) ?? null
}

/** Words currently spoken aloud. Null while a conditional beat is still unchosen. */
export function spokenLine(prompt: ScenarioPrompt, branchId: string | null): string | null {
  if (isBranchPrompt(prompt)) return branchOption(prompt, branchId)?.response ?? null
  return prompt.text
}

/** The Christian's suggested answer for the current beat, if one should be offered. */
export function answerFor(prompt: ScenarioPrompt, branchId: string | null): string | null {
  if (isBranchPrompt(prompt)) return branchOption(prompt, branchId)?.suggestedAnswer ?? null
  return prompt.suggestedAnswer
}

export function scenarioHasCues(scenario: ScenarioContent): boolean {
  return scenario.prompts.some((prompt) => (prompt.cues?.length ?? 0) > 0)
}
