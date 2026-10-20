import type { Role } from '../sessions/types'

export const ROLE_LABELS: Record<Role, string> = {
  missionary: 'Mormon missionary',
  christian: 'Christian',
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  missionary: 'Read the prompts and guide the conversation.',
  christian: 'Practise your response. Reveal an answer if needed.',
}
