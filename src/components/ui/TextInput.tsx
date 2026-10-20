import { Input as VendorInput } from '@openai/apps-sdk-ui/components/Input'
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

export function TextInput({ label, hint, error, id, className, disabled = false, ...rest }: TextInputProps) {
  const generatedId = useId()
  const inputId = id ?? `input-${generatedId}`
  const hintId = hint ? `${inputId}-hint` : undefined
  const errorId = error ? `${inputId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      <VendorInput
        {...rest}
        id={inputId}
        size="3xl"
        variant="outline"
        disabled={disabled}
        invalid={Boolean(error)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={styles.control}
      />
      {error ? (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
