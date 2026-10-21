export type EndedReason = 'left' | 'partnerLeft' | 'expired' | 'gone'

export const ENDED_COPY: Record<EndedReason, { heading: string; body: string }> = {
  left: { heading: 'You’ve left the practice.', body: 'Thank you for making time to connect.' },
  partnerLeft: { heading: 'Your partner ended the practice.', body: 'Thank you for making time to connect.' },
  expired: { heading: 'This practice has ended.', body: 'Practices close after a while. Start a new one when you’re ready.' },
  gone: {
    heading: 'This practice isn’t available on this device.',
    body: 'If browser data was cleared or you switched browsers, start a new practice.',
  },
}
