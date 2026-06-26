/**
 * End-to-end voice stream test against a running opencode server.
 *
 *   bun run --cwd packages/opencode serve --port 4097 &
 *   bun run --cwd packages/voice-server script/test-stream-e2e.ts http://127.0.0.1:4097
 */
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const base = process.argv[2]?.replace(/\/+$/, "") ?? "http://127.0.0.1:4096"
const repoRoot = join(import.meta.dir, "..", "..", "..")
const envPath = join(repoRoot, ".env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "")
    if (!process.env[key]) process.env[key] = value
  }
}

const pcmPath = join(import.meta.dir, "..", "test", "fixtures", "stt", "run-the-tests.pcm")
const pcm = new Uint8Array(await Bun.file(pcmPath).arrayBuffer())

const sessionRes = await fetch(`${base}/voice/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    directory: process.cwd(),
    sessionID: "ses_voice_e2e_test",
    server: base,
  }),
})
const session = (await sessionRes.json()) as { id: string; stream: string }
if (!sessionRes.ok) throw new Error(`session failed: ${JSON.stringify(session)}`)

const wsUrl = base.replace(/^http/, "ws") + `/voice/session/${session.id}/stream`
process.stderr.write(`connecting ${wsUrl}\n`)

const events: string[] = []
await new Promise<void>((resolve, reject) => {
  const ws = new WebSocket(wsUrl)
  ws.binaryType = "arraybuffer"
  let sent = false
  ws.onopen = () => {
    process.stderr.write("ws open, waiting for ready\n")
  }
  ws.onmessage = (event) => {
    if (typeof event.data !== "string") return
    events.push(event.data)
    process.stderr.write(`← ${event.data.slice(0, 120)}\n`)
    try {
      const payload = JSON.parse(event.data) as { type?: string; text?: string; speechFinal?: boolean }
      if (payload.type === "ready" && !sent) {
        void (async () => {
          process.stderr.write("streaming pcm\n")
          for (let offset = 0; offset < pcm.byteLength; offset += 3200) {
            ws.send(pcm.slice(offset, Math.min(offset + 3200, pcm.byteLength)))
            await new Promise((r) => setTimeout(r, 20))
          }
          sent = true
          process.stderr.write(`sent ${pcm.byteLength} bytes pcm\n`)
        })()
      }
      if (payload.type === "transcript" && payload.speechFinal) {
        ws.close()
        resolve()
      }
    } catch {}
  }
  ws.onerror = () => reject(new Error("ws error"))
  ws.onclose = () => {
    if (!sent) reject(new Error("ws closed before pcm sent"))
    else resolve()
  }
  setTimeout(() => {
    ws.close()
    resolve()
  }, 30_000)
})

const transcripts = events
  .map((raw) => {
    try {
      return JSON.parse(raw) as { type?: string; text?: string }
    } catch {
      return null
    }
  })
  .filter((item) => item?.type === "transcript")

process.stderr.write(`\nresult: ${transcripts.length} transcript events\n`)
for (const item of transcripts) process.stderr.write(`  ${item?.text}\n`)
if (!transcripts.length) process.exit(1)
