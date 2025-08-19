#!/usr/bin/env node
import { Command } from 'commander'
import express from 'express'
import { createServer as createHttpServer } from 'http'
import inquirer from 'inquirer'
import { js13kViteConfig } from 'js13k-vite-plugins'
import fs from 'node:fs'
import path from 'node:path'
import tiged from 'tiged'
import { build, createServer as createViteServer } from 'vite'
import WebSocket, { WebSocketServer } from 'ws'

const program = new Command()

program
  .name('js13k')
  .description('CLI for js13kGames tooling')
  .showHelpAfterError()
  .configureHelp({ sortSubcommands: true, sortOptions: true })

program
  .command('dev')
  .description('Run the Vite dev server with js13k defaults')
  .action(async () => {
    const config = js13kViteConfig()
    const server = await createViteServer(config as any)
    await server.listen()

    // print URLs similar to Vite's default behavior
    if (typeof (server as any).printUrls === 'function') {
      ;(server as any).printUrls()
    }
  })

program
  .command('build')
  .description('Build the project with js13k Vite defaults')
  .action(async () => {
    const config = js13kViteConfig()
    await build(config as any)
    console.log('Build complete')
  })

program
  .command('preview')
  .description('Serve the built dist/ directory with Express')
  .action(async () => {
    const app = express()
    app.use(express.static('dist'))
    const port = Number(process.env.PORT) || 4173
    const server = createHttpServer(app)
    server.listen(port, () => {
      console.log(`Preview: http://localhost:${port}`)
    })
  })

program
  .command('create')
  .description('Scaffold a new project from the official examples')
  .action(async () => {
    async function listRemoteExamples(): Promise<string[]> {
      const url = 'https://api.github.com/repos/benallfree/js13k-cli/contents/examples'
      try {
        const res = await (globalThis as any).fetch(url, {
          headers: {
            'User-Agent': 'js13k',
            Accept: 'application/vnd.github+json',
          },
        })
        if (!res?.ok) return []
        const data = await res.json()
        if (!Array.isArray(data)) return []
        return data
          .filter((e: any) => e && e.type === 'dir' && typeof e.name === 'string')
          .map((e: any) => e.name as string)
      } catch {
        return []
      }
    }

    const cwd = process.cwd()
    const examples = await listRemoteExamples()
    if (examples.length === 0) {
      console.error('No examples found')
      process.exit(1)
    }

    const { exampleName } = await inquirer.prompt<{ exampleName: string }>([
      {
        name: 'exampleName',
        type: 'list',
        message: 'Select an example to scaffold:',
        choices: examples,
      },
    ])

    const { targetDir } = await inquirer.prompt<{ targetDir: string }>([
      {
        name: 'targetDir',
        type: 'input',
        message: 'Target directory:',
        default: exampleName,
      },
    ])

    const repo = 'benallfree/js13k-cli'
    const templatePath = `examples/${exampleName}`
    const source = `${repo}/${templatePath}`
    const emitter = tiged(source, { force: true, verbose: true })

    const absTarget = path.resolve(cwd, targetDir)
    await emitter.clone(absTarget)

    const lockfiles = ['bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']
    const found = lockfiles.find((f) => fs.existsSync(path.join(absTarget, f)))
    let installHint = ''
    if (found === 'bun.lockb' || found === 'bun.lock') installHint = 'bun install'
    else if (found === 'pnpm-lock.yaml') installHint = 'pnpm install'
    else if (found === 'package-lock.json') installHint = 'npm install'
    else if (found === 'yarn.lock') installHint = 'yarn'
    else installHint = 'bun install'

    console.log(`\nScaffolded ${exampleName} into ${path.relative(cwd, absTarget)}\n`)
    console.log(`Next steps:`)
    console.log(`  cd ${path.relative(cwd, absTarget)}`)
    console.log(`  ${installHint}`)
  })

program
  .command('relay')
  .description('WebSocket relay at /parties/relay/<room>')
  .action(async () => {
    const app = express()
    const server = createHttpServer(app)
    const rooms = new Map<string, Set<WebSocket>>()
    const port = Number(process.env.PORT) || 4321

    const wss = new WebSocketServer({ noServer: true })

    wss.on('connection', (ws: WebSocket, request: Request, room: string) => {
      let listeners = rooms.get(room)
      if (!listeners) {
        listeners = new Set()
        console.log('new room', room)
        rooms.set(room, listeners)
      }
      console.log('add connection to room', room)
      listeners.add(ws)

      ws.on('message', (data: any) => {
        console.log('rx', data.toString())
        const current = rooms.get(room)
        if (!current) return
        for (const client of current) {
          if (client !== ws) {
            // Skip the sender
            try {
              client.send(data, { binary: false })
            } catch {}
          }
        }
      })

      ws.on('close', () => {
        const current = rooms.get(room)
        if (!current) return
        console.log('remove connection from room', room)
        current.delete(ws)
        if (current.size === 0) rooms.delete(room)
      })
    })

    server.on('upgrade', (request, socket, head) => {
      const url = new URL(request.url || '/', 'http://localhost')
      const match = url.pathname.match(/^\/parties\/relay\/(.+)$/)
      if (!match) return socket.destroy()
      const room = decodeURIComponent(match[1]!)
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, room)
      })
    })

    server.listen(port, () => {
      console.log(`Relay listening on ws://localhost:${port}/parties/relay/<room>`)
    })
  })

program.parseAsync()
