// Writes build/app.json: app.json with the network whitelist set to the
// builder's SERVER_ORIGIN and, optionally, package_id set to PACKAGE_ID (env
// vars, else .env.local). Each self-hoster packs their own .ehpk, so the
// checked-in app.json only carries a placeholder origin, and package ids are
// unique across Even Hub.
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

// Even Hub's rule: reverse-DNS, at least two segments, each a lowercase
// letter followed by lowercase letters or digits.
export function checkPackageId(id) {
  if (!/^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(id)) {
    throw new Error(`PACKAGE_ID must look like com.yourname.glassshelf (lowercase letters and digits, no hyphens): ${id}`)
  }
  return id
}

export function buildManifest(base, origin, packageId) {
  const permissions = base.permissions.map(p =>
    p.name === 'network' && origin ? { ...p, whitelist: [normalizeOrigin(origin)] } : p,
  )
  return { ...base, ...(packageId ? { package_id: checkPackageId(packageId) } : {}), permissions }
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
  const env = readEnvFile('.env.local')
  const origin = process.env.SERVER_ORIGIN || env.SERVER_ORIGIN
  const packageId = process.env.PACKAGE_ID || env.PACKAGE_ID
  const manifest = buildManifest(base, origin, packageId)
  if (!origin) console.warn('gen-manifest: SERVER_ORIGIN not set; packing with the placeholder whitelist.')
  mkdirSync('build', { recursive: true })
  writeFileSync('build/app.json', JSON.stringify(manifest, null, 2) + '\n')
  console.log(`gen-manifest: wrote build/app.json (${manifest.package_id}, network whitelist: ${manifest.permissions.find(p => p.name === 'network')?.whitelist})`)
}
