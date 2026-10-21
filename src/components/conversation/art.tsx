import { useId } from 'react'
import type { Role } from '../../sessions/types'
import styles from './conversation.module.css'

/*
 * Illustrations from the approved prototype, redrawn as inline SVG so they
 * scale cleanly and stay out of the stylesheets' colour boundary (like
 * ../art.tsx). Animation classes live in conversation.module.css.
 */

const SKIN = { missionary: '#d9ae8b', christian: '#cf9d77' } as const

/** One standing figure in a 140×240 box, matching the prototype's characters. */
function Figure({ role }: { role: Role }) {
  const missionary = role === 'missionary'
  const shirt = missionary ? '#fffef5' : '#c5a575'
  const sleeve = missionary ? '#f8f6ed' : '#c5a575'
  return (
    <g>
      <g transform="rotate(9 22 152)">
        <rect x="10" y="107" width="24" height="91" rx="12" fill={sleeve} />
        <rect x="12" y="175" width="20" height="26" rx="8" fill="#d9ae8b" />
      </g>
      <g transform="rotate(-12 125 152)">
        <rect x="113" y="107" width="24" height="91" rx="12" fill={sleeve} />
        <rect x="115" y="175" width="20" height="26" rx="8" fill="#d9ae8b" />
      </g>
      <rect x="23" y="187" width="95" height="50" rx="5" fill={missionary ? '#46566a' : '#53615b'} />
      <rect x="59" y="82" width="23" height="22" fill="#c79673" />
      <path d="M20 196V125Q20 96 49 96H94Q123 96 123 125V190Q123 196 117 196H26Q20 196 20 190Z" fill={shirt} />
      <rect x="120" y="112" width="3" height="80" fill={missionary ? '#e6e4d9' : '#af9068'} />
      <path d="M53 96 71 101 89 96 84 118 71 106 58 118Z" fill={missionary ? '#e5e7df' : '#a88a62'} />
      {missionary ? (
        <>
          <path d="M72 105H78L81 163 74.5 173 68 163Z" fill="#344d65" />
          <rect x="87" y="123" width="28" height="16" rx="2" fill="#35433b" />
          <rect x="92" y="128" width="18" height="2" fill="#e3e5d9" />
          <rect x="92" y="132" width="18" height="2" fill="#a3afa2" />
        </>
      ) : null}
      <ellipse cx="41" cy="58" rx="5" ry="9" fill="#cda17e" />
      <ellipse cx="100" cy="58" rx="5" ry="9" fill="#cda17e" />
      <rect x="41" y="17" width="59" height="76" rx="25" fill={SKIN[role]} />
      <ellipse cx="57" cy="53.5" rx="2" ry="2.5" fill="#39413a" />
      <ellipse cx="83" cy="53.5" rx="2" ry="2.5" fill="#39413a" />
      <path d="M74 54V62Q74 64 72 64H70" fill="none" stroke="#bb8968" strokeWidth="2" strokeLinecap="round" />
      <path d="M65 76Q72.5 81 80 76" fill="none" stroke="#8f5d4a" strokeWidth="2" strokeLinecap="round" />
      {missionary ? (
        <g fill="#584537" transform="rotate(-4 70 29)">
          <path d="M38 49V37Q38 9 68 9H74Q103 9 103 36V41Q103 49 95 49Z" />
          <rect x="42" y="25" width="12" height="33" rx="6" />
        </g>
      ) : (
        <g fill="#343d38" transform="rotate(3 70 27)">
          <path d="M38 47V33Q38 7 64 7H78Q103 7 103 31V35Q103 47 91 47Z" />
          <rect x="42" y="23" width="12" height="33" rx="6" />
        </g>
      )}
      {missionary ? (
        <g transform="rotate(-9 18 182)">
          <rect x="1" y="160" width="34" height="45" rx="3" fill="#4b6050" />
          <rect x="31" y="160" width="4" height="45" fill="#e6dec3" />
        </g>
      ) : null}
    </g>
  )
}

/** A round head-and-shoulders portrait beside messages and on the role cards. */
export function Portrait({ role, size = 'regular' }: { role: Role; size?: 'regular' | 'large' }) {
  return (
    <span
      className={[styles.portrait, role === 'christian' ? styles.portraitChristian : '', size === 'large' ? styles.portraitLarge : '']
        .filter(Boolean)
        .join(' ')}
      aria-hidden="true"
    >
      <svg viewBox="26 14 88 88" focusable="false">
        <Figure role={role} />
      </svg>
    </span>
  )
}

export type DoorstepPhase = 'closed' | 'knocking' | 'opening'

/**
 * The doorstep: the missionary outside a closed door, the Christian behind
 * it. `knocking` shows the knock; `opening` swings the door open.
 */
export function DoorstepScene({ phase }: { phase: DoorstepPhase }) {
  const clipId = useId()
  const label =
    phase === 'opening' ? 'The Christian opens the door to the LDS Missionary' : 'An LDS Missionary stands outside a closed front door'
  return (
    <div
      className={[styles.doorstep, phase === 'knocking' ? styles.knocking : '', phase === 'opening' ? styles.opening : '']
        .filter(Boolean)
        .join(' ')}
      role="img"
      aria-label={label}
    >
      <svg viewBox="0 0 460 245" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true">
        <defs>
          <clipPath id={clipId}>
            <rect x="276" y="27" width="112" height="186" />
          </clipPath>
        </defs>
        <rect width="460" height="245" fill="#dce8e3" />
        <rect x="170" width="290" height="245" fill="#e9e6d9" />
        <path
          d="M177 28H460M177 56H460M177 84H460M177 112H460M177 140H460M177 168H460M177 196H460"
          stroke="#dcdccf"
          strokeWidth="1.5"
        />
        <rect x="170" width="7" height="245" fill="#f7f3e7" />
        <rect y="215" width="460" height="30" fill="#bbc9ae" />
        <rect y="215" width="460" height="5" fill="#d4d6c1" />
        <rect x="266" y="17" width="132" height="206" fill="#c6ccba" />
        <rect x="268" y="19" width="128" height="202" fill="#f6f0df" />
        <rect x="276" y="27" width="112" height="186" fill="#a7b29d" />
        <g clipPath={`url(#${clipId})`}>
          <g transform="translate(264 41) scale(.93)">
            <Figure role="christian" />
          </g>
        </g>
        <g className={styles.door}>
          <rect x="276" y="27" width="112" height="186" fill="#748b75" stroke="#697e69" strokeWidth="2" />
          <rect x="289" y="44" width="86" height="152" rx="28" fill="#7b937b" stroke="#637c65" strokeWidth="2" />
          <circle cx="375" cy="126" r="4" fill="#efd6a1" stroke="#b7a078" strokeWidth="2" />
        </g>
        <g transform="translate(53 46) scale(.9)">
          <Figure role="missionary" />
        </g>
        <text className={styles.knockHand} x="232" y="128" fontSize="30">
          ✊
        </text>
        <g className={styles.knockWords}>
          <rect x="60" y="20" width="132" height="80" rx="12" fill="#c9ae6e" transform="translate(3 4)" />
          <rect x="60" y="20" width="132" height="80" rx="12" fill="#fff1bd" />
          <text x="126" y="54" textAnchor="middle" fontSize="27" fontWeight="700" fontStyle="italic" fill="#694830">
            KNOCK!
          </text>
          <text x="126" y="84" textAnchor="middle" fontSize="27" fontWeight="700" fontStyle="italic" fill="#694830">
            KNOCK!
          </text>
        </g>
      </svg>
    </div>
  )
}

/**
 * The goodbye: the Christian waves and closes the door, and the missionary
 * walks away. `elapsedMs` resumes the animation part-way, and `paused`
 * freezes it while a dialog or a lost connection interrupts.
 */
export function OutroScene({ elapsedMs, paused }: { elapsedMs: number; paused: boolean }) {
  const prefix = useId()
  const skyId = `${prefix}-sky`
  const clipId = `${prefix}-door`
  const titleId = `${prefix}-title`
  const descId = `${prefix}-desc`
  return (
    <div
      className={[styles.outro, paused ? styles.outroPaused : ''].filter(Boolean).join(' ')}
      style={{ ['--outro-offset' as string]: `-${Math.round(elapsedMs)}ms` }}
    >
      <svg viewBox="0 0 640 420" role="img" aria-labelledby={`${titleId} ${descId}`} xmlns="http://www.w3.org/2000/svg">
        <title id={titleId}>Goodbye at the doorstep</title>
        <desc id={descId}>
          The Christian waves goodbye and closes the front door. The LDS Missionary turns and walks away from the home.
        </desc>
        <defs>
          <linearGradient id={skyId} x2="0" y2="1">
            <stop stopColor="#e8eee9" />
            <stop offset="1" stopColor="#f5f4ed" />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="427" y="113" width="104" height="218" rx="3" />
          </clipPath>
        </defs>
        <rect width="640" height="420" fill={`url(#${skyId})`} />
        <circle cx="108" cy="78" r="28" fill="#f8edcd" />
        <path d="M0 317H640V420H0Z" fill="#d6dfcf" />
        <path d="M347 327H554L640 420H167Z" fill="#e6e3d9" />
        <path d="M345 0H640V333H345Z" fill="#e9e7dd" />
        <path
          d="M345 48H640M345 84H640M345 120H640M345 156H640M345 192H640M345 228H640M345 264H640M345 300H640"
          stroke="#dcded2"
          strokeWidth="2"
        />
        <rect x="417" y="103" width="124" height="236" rx="4" fill="#faf8ef" />
        <rect x="427" y="113" width="104" height="218" fill="#4a5145" />
        <g clipPath={`url(#${clipId})`}>
          <g>
            <path d="M446 330V244Q479 223 511 244V330" fill="#8e9e86" />
            <rect x="470" y="214" width="17" height="22" rx="5" fill="#c99572" />
            <ellipse cx="479" cy="190" rx="25" ry="32" fill="#d6a27e" />
            <path d="M454 185Q449 150 478 150Q509 150 504 181L494 166L465 170L459 187" fill="#3c4238" />
            <circle cx="471" cy="190" r="2" fill="#3a4036" />
            <circle cx="490" cy="190" r="2" fill="#3a4036" />
            <path d="M472 205Q480 211 488 204" fill="none" stroke="#9c654f" strokeWidth="2" strokeLinecap="round" />
            <g className={styles.outroWave}>
              <path d="M502 244L519 216L517 198" fill="none" stroke="#d6a27e" strokeWidth="12" strokeLinecap="round" />
            </g>
          </g>
        </g>
        <g className={styles.outroDoor}>
          <rect x="427" y="113" width="104" height="218" fill="#73836c" />
          <rect x="440" y="129" width="78" height="116" rx="27" fill="#7c8d74" stroke="#62745d" strokeWidth="2" />
          <rect x="440" y="265" width="78" height="50" rx="3" fill="none" stroke="#62745d" strokeWidth="2" />
          <circle cx="514" cy="253" r="5" fill="#ddc38c" />
        </g>
        <rect x="410" y="331" width="139" height="9" rx="2" fill="#bbbfae" />
        <rect x="376" y="133" width="19" height="32" rx="4" fill="#69735e" />
        <rect x="381" y="139" width="9" height="20" fill="#f1dfb1" />
        <g className={styles.outroVisitor}>
          <ellipse cx="298" cy="349" rx="30" ry="6" fill="#44563a" opacity=".13" />
          <g className={styles.outroBody}>
            <g className={styles.outroLegLeft}>
              <path d="M289 282L285 343" stroke="#4c5751" strokeWidth="15" strokeLinecap="round" />
              <path d="M285 343H272" stroke="#35433a" strokeWidth="9" strokeLinecap="round" />
            </g>
            <g className={styles.outroLegRight}>
              <path d="M306 282L312 343" stroke="#4c5751" strokeWidth="15" strokeLinecap="round" />
              <path d="M312 343H300" stroke="#35433a" strokeWidth="9" strokeLinecap="round" />
            </g>
            <path d="M274 229Q297 217 320 229L318 287H276Z" fill="#fffdf5" stroke="#d8ddd1" />
            <path d="M290 226L297 237L305 226M297 237V273" fill="none" stroke="#526c56" strokeWidth="4" />
            <rect x="305" y="241" width="13" height="8" rx="1" fill="#364339" />
            <path d="M278 237L266 275M317 237L328 274" stroke="#d3a482" strokeWidth="10" strokeLinecap="round" />
            <rect x="253" y="268" width="18" height="26" rx="2" fill="#52664f" />
            <rect x="289" y="206" width="16" height="19" rx="5" fill="#c89974" />
            <ellipse cx="297" cy="183" rx="24" ry="31" fill="#d9ad88" />
            <path d="M273 180Q267 148 296 147Q325 145 322 174L310 162L285 167L279 185" fill="#62503c" />
            <circle cx="287" cy="184" r="2" fill="#394435" />
            <circle cx="304" cy="184" r="2" fill="#394435" />
            <path d="M287 200Q295 206 303 199" fill="none" stroke="#98664e" strokeWidth="2" strokeLinecap="round" />
          </g>
        </g>
        <rect className={styles.outroFade} width="640" height="420" fill="#fff" />
      </svg>
    </div>
  )
}
