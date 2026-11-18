/**
 * Runs the Vite dev server and the API proxy together, so `npm run dev` gives
 * a working app including the credentialed integrations.
 * Dependency-free alternative to concurrently.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const children = []

function run(label, command, args) {
  const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' })
  child.on('exit', (code, signal) => {
    if (signal) return
    console.log(`[dev] ${label} exited with code ${code}`)
    shutdown(code ?? 0)
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

run('proxy', process.execPath, [resolve(ROOT, 'server/index.mjs')])
run('vite', process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js')])
