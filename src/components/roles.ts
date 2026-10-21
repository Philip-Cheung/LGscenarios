import type { Role } from '../sessions/types'

/** What each side does, shown above the role name on the role choice. */
export const ROLE_CAPTIONS: Record<Role, string> = {
  missionary: 'Play the LDS Missionary using the prompts provided.',
  christian: 'Practise explaining your beliefs and responding to an LDS Missionary.',
}

/** Short role names for the role cards and the compact progress line. */
export const ROLE_SHORT_LABELS: Record<Role, string> = {
  missionary: 'LDS Missionary',
  christian: 'Christian',
}

export const otherRole = (role: Role): Role => (role === 'missionary' ? 'christian' : 'missionary')
