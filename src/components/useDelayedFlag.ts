import { useEffect, useState } from 'react'

/** Becomes true only after `flag` has stayed true for `delayMs`; resets immediately. */
export function useDelayedFlag(flag: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false)
  useEffect(() => {
    if (!flag) return
    const timer = window.setTimeout(() => setDelayed(true), delayMs)
    return () => {
      window.clearTimeout(timer)
      setDelayed(false)
    }
  }, [flag, delayMs])
  return flag && delayed
}
