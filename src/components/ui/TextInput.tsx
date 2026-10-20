import { useId, type InputHTMLAttributes, type Ref } from 'react'
import styles from './TextInput.module.css'

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'id'> {
  label: string
  hint?: string
  /** Inline validation message; marks the field invalid when present. */
  error?: string | null
  id?: string
  ref?: Ref<HTMLInputElement>
}

/** Label, field, hint, then error, in the reference join-form order. */
export function TextInput({ label, hint, error, id, className, ...rest }: TextInputProps) {
  const generatedId = useId()
  const inputId = id ?? `input-${generatedId}`
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = `${inputId}-error`
  const describedBy = [hintId, error ? errorId : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        className={styles.control}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <p id={errorId} className={styles.error} role="alert">
        {error}
      </p>
    </div>
  )
}
