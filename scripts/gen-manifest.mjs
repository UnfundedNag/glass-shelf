// Writes build/app.json: app.json with the network whitelist set to the
// builder's SERVER_ORIGIN (env var, else .env.local). Each self-hoster packs
// their own .ehpk, so the checked-in app.json only carries a placeholder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function normalizeOrigin(raw) {
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error(`SERVER_ORIGIN is not a URL: ${raw}`)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`SERVER_ORIGIN must be http(s): ${raw}`)
  }
  if (url.pathname !== '/' || url.search || url.hash || url.username) {
    throw new Error(`SERVER_ORIGIN must be an origin only (no path, query or credentials): ${raw}`)
  }
  return url.origin
}

export function buildManifest(base, origin) {
  const permissions = base.permissions.map(p =>
    p.name === 'network' ? { ...p, whitelist: [normalizeOrigin(origin)] } : p,
  )
  return { ...base, permissions }
}

function readEnvFile(path) {
  if (!existsSync(path)) return {}
  const env = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return env
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = JSON.parse(readFileSync('app.json', 'utf8'))
  const origin = process.env.SERVER_ORIGIN || readEnvFile('.env.local').SERVER_ORIGIN
  const manifest = origin ? buildManifest(base, origin) : base
  if (!origin) console.warn('gen-manifest: SERVER_ORIGIN not set; packing with the placeholder whitelist.')
  mkdirSync('build', { recursive: true })
  writeFileSync('build/app.json', JSON.stringify(manifest, null, 2) + '\n')
  console.log(`gen-manifest: wrote build/app.json (network whitelist: ${manifest.permissions.find(p => p.name === 'network')?.whitelist})`)
}
