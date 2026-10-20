import type { ScenarioContent } from '../lib/content'

// Immutable once published. To revise, add sample-doorstep.v3.ts instead.
// Filler beats only: no substantive script until that content is approved.
export const sampleDoorstepV2 = {
  scenarioId: 'sample-doorstep',
  slug: 'sample-doorstep',
  version: 2,
  title: 'A conversation at the door',
  description: 'Practise a short doorstep conversation about faith and hope.',
  prompts: [
    {
      id: 'start',
      label: 'Start the conversation',
      text: 'Hello. May I ask you one short question?',
      suggestedAnswer: 'Yes. Go ahead.',
      cues: [
        { type: 'say', text: 'Hello. May I ask you one short question?' },
        { type: 'wait', text: 'Stop and allow them to respond.' },
      ],
    },
    {
      id: 'follow-up',
      label: 'Follow up',
      text: 'What would you add to that?',
      suggestedAnswer: 'I would keep my answer short and clear.',
      cues: [
        { type: 'challenge', text: 'What would you add to that?' },
        { type: 'wait', text: 'Stop and allow them to respond.' },
      ],
    },
    {
      id: 'branch',
      label: 'Choose a follow-up',
      text: 'Choose the matching response.',
      suggestedAnswer: 'I will respond in my own words.',
      cues: [
        {
          type: 'ifTheySay',
          options: [
            {
              id: 'they-agree',
              label: 'They agree',
              response: 'Thank you. I will keep this short.',
              suggestedAnswer: 'That sounds fine.',
            },
            {
              id: 'something-else',
              label: 'Something else',
              response: 'Thank you for telling me. I will pause here.',
              suggestedAnswer: 'I would like to think about it.',
            },
          ],
        },
      ],
    },
  ],
} as const satisfies ScenarioContent
