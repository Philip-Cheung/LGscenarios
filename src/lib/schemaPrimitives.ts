import { z } from 'zod'
import { richTextProblems } from './richText'

/** Stable ids for scenarios, questions, passages, and conversation beats. */
export const identifier = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits, and single hyphens')

export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Must not be empty')
    .max(max)
    .refine((value) => !/[<>]/.test(value), 'Plain text only; angle brackets are not allowed')

/** Plain text that may also contain passage references and allowed source links (see `richText.ts`). */
export const richText = (max: number) =>
  plainText(max).superRefine((value, ctx) => {
    for (const problem of richTextProblems(value)) ctx.addIssue({ code: 'custom', message: problem })
  })
