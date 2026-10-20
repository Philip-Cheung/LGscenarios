import type { Role } from '../sessions/types'

export const ROLE_LABELS: Record<Role, string> = {
  missionary: 'Mormon missionary',
  christian: 'Christian',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  missionary: 'Lead the conversation and choose the questions.',
  christian: 'Answer in your own words. Reveal a suggested answer if needed.',
}
