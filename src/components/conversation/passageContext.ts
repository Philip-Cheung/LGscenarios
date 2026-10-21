import { createContext } from 'react'

/** Opens the full KJV passage for an inline quotation or a help reference. */
export const OpenPassageContext = createContext<((passageId: string) => void) | null>(null)
