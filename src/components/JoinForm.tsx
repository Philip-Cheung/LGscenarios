import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { PAIR_CODE_INPUT_MAX_LENGTH, isWellFormedPairCode, normalizePairCode } from '../lib/pairCode'
import { AppScreen } from './AppScreen'
import { Icon } from './art'
import { Button, TextInput } from './ui'
import styles from './screens.module.css'

interface JoinFormProps {
  initialValue?: string
  busy: boolean
  error: string | null
  onJoin(code: string): void
  onBack(): void
}

export function JoinForm({ initialValue = '', busy, error, onJoin, onBack }: JoinFormProps) {
  const formId = useId()
  const [value, setValue] = useState(initialValue)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Return focus to the field when the server rejects a code (it was disabled while busy).
  useEffect(() => {
    if (error && !busy) inputRef.current?.focus()
  }, [error, busy])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizePairCode(value)
    if (!isWellFormedPairCode(normalized)) {
      setLocalError('Enter all six digits of your partner’s code.')
      inputRef.current?.focus()
      return
    }
    setLocalError(null)
    onJoin(normalized)
  }

  return (
    <AppScreen
      viewKey="join"
      note="Your partner can find their code on the invitation screen."
      actions={
        <>
          <Button type="submit" form={formId} loading={busy}>
            Join practice
          </Button>
          <Button variant="text" disabled={busy} onClick={onBack}>
            Back
          </Button>
        </>
      }
    >
      <span className={styles.turn}>
        <Icon />
        Join your partner
      </span>
      <h1 tabIndex={-1}>Find your practice partner.</h1>
      <p>Enter the six-digit code on your partner’s screen.</p>
      <form id={formId} className={styles.joinForm} onSubmit={submit} noValidate>
        <TextInput
          ref={inputRef}
          label="Pairing code"
          hint="Six digits. Spaces are optional."
          name="pairCode"
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/[^0-9\s-]/g, ''))
            if (localError) setLocalError(null)
          }}
          error={localError ?? error}
          maxLength={PAIR_CODE_INPUT_MAX_LENGTH}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="numeric"
          enterKeyHint="go"
          placeholder="000 000"
          translate="no"
          disabled={busy}
        />
      </form>
    </AppScreen>
  )
}
