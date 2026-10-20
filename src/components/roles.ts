import type { Role } from '../sessions/types'

/** What each side does, shown above the role name on the role choice. */
export const ROLE_CAPTIONS: Record<Role, string> = {
  missionary: 'Play the missionary using the prompts provided.',
  christian: 'Practise explaining your beliefs and responding to a missionary.',
}

/** Short role names for the role cards and the compact progress line. */
export const ROLE_SHORT_LABELS: Record<Role, string> = {
  missionary: 'Mormon',
  christian: 'Christian',
}

export const otherRole = (role: Role): Role => (role === 'missionary' ? 'christian' : 'missionary')
