import { appendFileSync, mkdirSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'

// Receives devlog() lines from the app on the phone (see src/devlog.ts).
function deviceLog(): Plugin {
  return {
    name: 'device-log',
    apply: 'serve',
    configureServer(server) {
      mkdirSync('build', { recursive: true })
      server.middlewares.use('/__devlog', (req, res) => {
        let body = ''
        req.on('data', chunk => (body += chunk))
        req.on('end', () => {
          appendFileSync('build/device.log', body.replace(/\n/g, ' ') + '\n')
          res.statusCode = 204
          res.end()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [deviceLog()],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
  test: { include: ['tests/**/*.test.ts'] },
})
