import fs from 'node:fs'
import path from 'node:path'
import { runBuild } from '../js13k/src/commands/build'

type DebounceTimers = Map<string, NodeJS.Timeout>

const REPO_ROOT = process.cwd()
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples')

// Simple sequential build queue to avoid concurrent cwd changes
let isBuilding = false
const pendingExamples: string[] = []
const pendingSet: Set<string> = new Set()

function isPathInsideDist(relativePathFromExamples: string): boolean {
  const segments = relativePathFromExamples.split(path.sep)
  return segments.includes('dist') || segments.includes('node_modules')
}

function extractExampleName(relativePathFromExamples: string): string | null {
  if (!relativePathFromExamples) return null
  const normalized = relativePathFromExamples.replace(/^\.+/, '')
  const [exampleName] = normalized.split(path.sep)
  return exampleName || null
}

function getExampleAbsolutePath(exampleName: string): string {
  return path.join(EXAMPLES_DIR, exampleName)
}

function scheduleBuildForExample(exampleName: string, debounceTimers: DebounceTimers) {
  const existingTimer = debounceTimers.get(exampleName)
  if (existingTimer) clearTimeout(existingTimer)

  const timeout = setTimeout(async () => {
    debounceTimers.delete(exampleName)
    enqueueBuild(exampleName)
  }, 200)

  debounceTimers.set(exampleName, timeout)
}

async function runBuildInExample(exampleName: string) {
  const exampleDir = getExampleAbsolutePath(exampleName)

  console.log(`[watch] change detected in "${exampleDir}" → building...`)
  const previousCwd = process.cwd()
  try {
    process.chdir(exampleDir)
    await runBuild()
    console.log(`[watch] build complete: ${exampleName}`)
  } catch (err) {
    console.error(`[watch] build failed: ${exampleName}`)
    console.error(err)
  } finally {
    process.chdir(previousCwd)
  }
}

function ensureExamplesDirExists() {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    console.error(`examples/ directory not found at ${EXAMPLES_DIR}`)
    process.exit(1)
  }
}

function startWatcher() {
  ensureExamplesDirExists()
  console.log(`[watch] monitoring: ${EXAMPLES_DIR}`)

  const debounceTimers: DebounceTimers = new Map()

  const watcher = fs.watch(EXAMPLES_DIR, { recursive: true }, (eventType, filename) => {
    if (!filename) return
    const rel = filename.toString()
    if (isPathInsideDist(rel)) return

    const exampleName = extractExampleName(rel)
    if (!exampleName) return

    // Skip if the top-level example directory itself was affected without a file
    if (exampleName.length === rel.length) return

    scheduleBuildForExample(exampleName, debounceTimers)
  })

  watcher.on('error', (err) => {
    console.error('[watch] error:', err)
  })
}

startWatcher()

function enqueueBuild(exampleName: string) {
  if (!pendingSet.has(exampleName)) {
    pendingSet.add(exampleName)
    pendingExamples.push(exampleName)
  }
  if (!isBuilding) void processQueue()
}

async function processQueue() {
  if (isBuilding) return
  isBuilding = true
  try {
    while (pendingExamples.length > 0) {
      const next = pendingExamples.shift()!
      pendingSet.delete(next)
      await runBuildInExample(next)
    }
  } finally {
    isBuilding = false
  }
}
