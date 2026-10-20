import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

/**
 * Builds the fetch/script Content-Security-Policy for the compiled app. The
 * exact Supabase origin is only known at build time, so it is injected as a
 * <meta> tag; frame-ancestors and other header-only directives live in
 * vercel.json.
 */
export function buildContentSecurityPolicy(env: Record<string, string>): string {
  const connect = ["'self'"]
  const images = ["'self'", 'data:']
  const supabaseUrl = env.VITE_SUPABASE_URL
  if (supabaseUrl) {
    const origin = new URL(supabaseUrl).origin
    connect.push(origin, origin.replace(/^http/, 'ws'))
    // Scenario setting images are served from Supabase Storage.
    images.push(origin)
  }
  const turnstile = Boolean(env.VITE_TURNSTILE_SITE_KEY)
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...(turnstile ? [TURNSTILE_ORIGIN] : [])],
    'style-src': ["'self'"],
    'img-src': images,
    'font-src': ["'self'", 'data:'],
    'connect-src': connect,
    'frame-src': turnstile ? [TURNSTILE_ORIGIN] : ["'none'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'self'"],
  }
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

function cspMetaPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'doorstep-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: buildContentSecurityPolicy(env) },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

interface VercelConfig {
  headers?: { source: string; headers: { key: string; value: string }[] }[]
}

/** Mirrors the global vercel.json headers so `vite preview` serves the same policy. */
function vercelGlobalHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8')) as VercelConfig
  const global = config.headers?.find((entry) => entry.source === '/(.*)')
  return Object.fromEntries((global?.headers ?? []).map(({ key, value }) => [key, value]))
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), tailwindcss(), cspMetaPlugin(env)],
    preview: {
      headers: vercelGlobalHeaders(),
    },
    build: {
      sourcemap: false,
      rolldownOptions: {
        output: {
          // Weekly content changes only invalidate the small app chunk; vendor
          // chunks keep their hashes and stay cached on returning devices.
          // The UI library stays in the app chunk: its CSS must load after
          // vendor-theme.css declares the cascade layer order, or Tailwind's
          // base layer would override the library's component layer.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 20 },
              { name: 'supabase', test: /node_modules[\\/](@supabase|iceberg-js|tslib)[\\/]/, priority: 20 },
              { name: 'vendor', test: /node_modules[\\/](?!@openai[\\/]apps-sdk-ui[\\/])/, priority: 10 },
            ],
          },
        },
      },
    },
  }
})
