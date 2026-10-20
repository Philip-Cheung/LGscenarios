import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PAIR_CODE_INPUT_MAX_LENGTH, isWellFormedPairCode, normalizePairCode } from '../lib/pairCode'
import { Button, Card, TextInput } from './ui'
import styles from './screens.module.css'

interface JoinFormProps {
  initialValue?: string
  busy: boolean
  error: string | null
  onJoin(code: string): void
  onBack(): void
}

export function JoinForm({ initialValue = '', busy, error, onJoin, onBack }: JoinFormProps) {
  const [value, setValue] = useState(initialValue)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Return focus to the field when the server rejects a code (it was disabled while busy).
  useEffect(() => {
    if (error && !busy) inputRef.current?.focus()
  }, [error, busy])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizePairCode(value)
    if (!isWellFormedPairCode(normalized)) {
      setLocalError('Enter the 6-character code shown on your partner’s phone.')
      inputRef.current?.focus()
      return
    }
    setLocalError(null)
    onJoin(normalized)
  }

  return (
    <Card aria-labelledby="join-heading">
      <form className={styles.form} onSubmit={submit} noValidate>
        <p className={styles.meta}>
          <span>Christian</span>
          <span>Pairing</span>
        </p>
        <h2 id="join-heading" className={styles.heading}>
          Enter your partner’s code
        </h2>
        <TextInput
          ref={inputRef}
          label="Pair code"
          hint="Your partner chooses Mormon missionary and sees this code on their phone. Stay in this browser."
          name="pairCode"
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (localError) setLocalError(null)
          }}
          error={localError ?? error}
          maxLength={PAIR_CODE_INPUT_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          placeholder="ABC-DEF"
          translate="no"
          disabled={busy}
        />
        <div className={styles.stack}>
          <Button type="submit" block loading={busy}>
            Join
          </Button>
          <Button variant="secondary" block disabled={busy} onClick={onBack}>
            Choose a different role
          </Button>
        </div>
      </form>
    </Card>
  )
}
