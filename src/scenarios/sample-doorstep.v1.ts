import type { ScenarioContent } from '../lib/content'

// Immutable once published. To revise, add sample-doorstep.v2.ts instead.
export const sampleDoorstepV1 = {
  scenarioId: 'sample-doorstep',
  slug: 'sample-doorstep',
  version: 1,
  title: 'A conversation at the door',
  prompts: [
    {
      id: 'start',
      label: 'Start the conversation',
      text: 'Hi! Could we ask you a question about your faith?',
      suggestedAnswer: 'Sure. What would you like to talk about?',
    },
    {
      id: 'hope',
      label: 'Ask a question',
      text: 'What gives you hope?',
      suggestedAnswer: 'My faith gives me hope. It reminds me that I am loved.',
    },
    {
      id: 'everyday',
      label: 'Follow up',
      text: 'How does that help you in everyday life?',
      suggestedAnswer: 'It helps me face difficult days with patience and hope.',
    },
  ],
} as const satisfies ScenarioContent
