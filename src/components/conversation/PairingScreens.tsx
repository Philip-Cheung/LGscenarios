import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { ConversationContent } from '../../lib/conversation'
import {
  formatPairCode,
  isWellFormedPairCode,
  normalizePairCode,
  PAIR_CODE_INPUT_MAX_LENGTH,
  spellPairCode,
} from '../../lib/pairCode'
import type { Role } from '../../sessions/types'
import { Button } from '../ui'
import { Portrait } from './art'
import styles from './conversation.module.css'

const ROLES: readonly Role[] = ['missionary', 'christian']
const other = (role: Role): Role => (role === 'missionary' ? 'christian' : 'missionary')

/** Focuses the screen heading on arrival so screen readers start at the top. */
function useHeadingFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return ref
}

interface RoleChoiceProps {
  content: ConversationContent
  /** The missionary card is creating a pair. */
  busy: boolean
  error: string | null
  notice: string | null
  onChoose(role: Role): void
}

/** "Who will you play?": two role cards. Missionary creates the pair at once; Christian goes on to join. */
export function RoleChoice({ content, busy, error, notice, onChoose }: RoleChoiceProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>()
  return (
    <main className={styles.journey}>
      {notice ? (
        <p className={styles.journeyNotice} role="status">
          {notice}
        </p>
      ) : null}
      <div className={styles.journeyKicker}>{content.intro.kicker}</div>
      <h1 ref={headingRef} tabIndex={-1} className={styles.journeyTitle}>
        {content.intro.heading}
      </h1>
      <p className={styles.journeyDescription}>{content.intro.description}</p>
      <div className={styles.roleCards}>
        {ROLES.map((role) => (
          <button
            key={role}
            type="button"
            className={styles.roleChoice}
            disabled={busy}
            aria-busy={busy && role === 'missionary' ? true : undefined}
            onClick={() => onChoose(role)}
          >
            <Portrait role={role} size="large" />
            <span className={styles.roleCopy}>
              <strong>{content.roles[role].label}</strong>
              <span>{content.roles[role].description}</span>
            </span>
            <span className={styles.roleArrow} aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
      <p className={styles.fine} role="status">
        {busy ? 'Creating your pairing code…' : null}
      </p>
      <p className={styles.pairError} role="alert">
        {error ? `${error} Choose Mormon missionary to try again.` : null}
      </p>
      <details className={styles.startReading}>
        <summary>{content.resources.heading}</summary>
        {content.resources.items.map((item) => (
          <a key={item.url} className={styles.startResource} href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title} <span aria-hidden="true">↗</span>
            <span className={styles.srOnly}> (opens in a new tab)</span>
          </a>
        ))}
      </details>
    </main>
  )
}

function RoleSummary({ content, role }: { content: ConversationContent; role: Role }) {
  return (
    <dl className={styles.pairRoleSummary}>
      <div className={styles.pairRoleRow}>
        <dt>Your role</dt>
        <dd>{content.roles[role].label}</dd>
      </div>
      <div className={styles.pairRoleRow}>
        <dt>Your partner’s role</dt>
        <dd>{content.roles[other(role)].label}</dd>
      </div>
    </dl>
  )
}

interface InvitePartnerProps {
  content: ConversationContent
  role: Role
  pairCode: string | null
  codeExpired: boolean
  /** True when this browser reopened a pair it was already waiting in. */
  resumed: boolean
  canAct: boolean
  regenerating: boolean
  closing: boolean
  closeError: string | null
  onRegenerate(): void
  onChangeRoles(): void
}

/** "Invite your partner": the pairing code for the person beside you. */
export function InvitePartner({
  content,
  role,
  pairCode,
  codeExpired,
  resumed,
  canAct,
  regenerating,
  closing,
  closeError,
  onRegenerate,
  onChangeRoles,
}: InvitePartnerProps) {
  const headingRef = useHeadingFocus<HTMLHeadingElement>()
  const [copyLabel, setCopyLabel] = useState('Copy')
  const showCode = !codeExpired && pairCode

  const copy = async () => {
    if (!pairCode) return
    try {
      await navigator.clipboard.writeText(pairCode)
      setCopyLabel('Copied')
    } catch {
      setCopyLabel('Select code to copy')
    }
  }

  return (
    <main className={`${styles.journey} ${styles.pairingLayout}`}>
      <h1 ref={headingRef} tabIndex={-1} className={styles.journeyTitle}>
        {showCode ? 'Invite your partner' : 'This code has expired.'}
      </h1>
      <p className={styles.journeyDescription}>
        {showCode
          ? `Ask your partner to choose “Join your partner”${resumed ? ' on their own phone' : ''} and enter this code.`
          : 'Get a new code, then share it with your partner.'}
      </p>
      {showCode ? (
        <>
          <div className={styles.pairCodeCard}>
            <div className={styles.pairCodeTop}>
              <span className={styles.pairCodeHeading}>YOUR PAIRING CODE</span>
              <button type="button" className={styles.pairCopy} aria-label="Copy pairing code" onClick={() => void copy()}>
                {copyLabel}
              </button>
            </div>
            <div className={styles.pairCode} translate="no" data-testid="pair-code" aria-hidden="true">
              {formatPairCode(pairCode)}
            </div>
            <span className={styles.srOnly}>Pairing code {spellPairCode(pairCode)}</span>
            <p className={styles.pairShareNote}>Share with the person beside you.</p>
          </div>
          <div className={styles.pairWaiting} role="status">
            Waiting for your partner to join…
          </div>
        </>
      ) : (
        <div className={styles.journeyActions}>
          <Button disabled={!canAct} loading={regenerating} onClick={onRegenerate}>
            Get a new code
          </Button>
        </div>
      )}
      <RoleSummary content={content} role={role} />
      {showCode ? <p className={styles.pairOpenNote}>Keep this screen open while your partner joins.</p> : null}
      <p className={styles.pairError} role="alert">
        {closeError}
      </p>
      <button type="button" className={styles.quiet} disabled={closing} aria-busy={closing || undefined} onClick={onChangeRoles}>
        Change roles
      </button>
    </main>
  )
}

interface JoinPartnerProps {
  content: ConversationContent
  initialValue: string
  busy: boolean
  error: string | null
  onJoin(code: string): void
  onChangeRoles(): void
}

/** "Join your partner": the Christian enters the code from the missionary's phone. */
export function JoinPartner({ content, initialValue, busy, error, onJoin, onChangeRoles }: JoinPartnerProps) {
  const inputId = useId()
  const errorId = useId()
  const [value, setValue] = useState(initialValue)
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const shownError = localError ?? error

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (error && !busy) inputRef.current?.focus()
  }, [error, busy])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = normalizePairCode(value)
    if (!isWellFormedPairCode(normalized)) {
      setLocalError('Enter the six-digit code from your partner.')
      inputRef.current?.focus()
      return
    }
    setLocalError(null)
    onJoin(normalized)
  }

  return (
    <main className={`${styles.journey} ${styles.pairingLayout}`}>
      <div className={styles.journeyKicker}>CHRISTIAN · PAIR UP</div>
      <h1 className={styles.journeyTitle}>Join your partner</h1>
      <p className={styles.journeyDescription}>Enter the six-digit code shown on your missionary partner’s phone.</p>
      <form className={styles.joinForm} onSubmit={submit} noValidate>
        <label className={styles.codeLabel} htmlFor={inputId}>
          Pairing code
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className={styles.codeInput}
          name="pairCode"
          type="text"
          inputMode="numeric"
          enterKeyHint="go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          placeholder="000000"
          maxLength={PAIR_CODE_INPUT_MAX_LENGTH}
          value={value}
          disabled={busy}
          aria-invalid={shownError ? true : undefined}
          aria-describedby={errorId}
          onChange={(event) => {
            setValue(event.target.value.replace(/[^0-9\s-]/g, ''))
            if (localError) setLocalError(null)
          }}
        />
        <p id={errorId} className={styles.pairError} role="alert">
          {shownError}
        </p>
        <Button type="submit" loading={busy} className={styles.journeyPrimary}>
          Join pair
        </Button>
      </form>
      <RoleSummary content={content} role="christian" />
      <button type="button" className={styles.quiet} disabled={busy} onClick={onChangeRoles}>
        Change roles
      </button>
    </main>
  )
}
