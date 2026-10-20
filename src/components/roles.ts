import type { Role } from '../sessions/types'

/** What each side does, shown above the role name on the role choice. */
export const ROLE_CAPTIONS: Record<Role, string> = {
  missionary: 'Start the conversation',
  christian: 'Listen and respond',
}

export const otherRole = (role: Role): Role => (role === 'missionary' ? 'christian' : 'missionary')
