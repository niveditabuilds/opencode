/**
 * Generate committed voice test fixtures using XAI_API_KEY from repo-root .env.
 *
 *   bun run --cwd packages/voice-server script/generate-fixtures.ts
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "test", "fixtures")
const STT_DIR = join(ROOT, "stt")
const TTS_DIR = join(ROOT, "tts")

const STT_PHRASE = "Run the tests."
const TTS_PHRASE = "Hello world."

function loadRepoEnv() {
  const envPath = join(import.meta.dir, "..", "..", "..", ".env")
  if (!existsSync(envPath)) return
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

async function convertMp3ToSttWav(mp3: Uint8Array, outputBase: string, sampleRate: number) {
  const { readWavPcm } = await import("../test/lib/wav.ts")
  const mp3Path = `${outputBase}.mp3`
  const wavPath = `${outputBase}.wav`
  const pcmPath = `${outputBase}.pcm`
  await Bun.write(mp3Path, mp3)

  const proc = Bun.spawn(
    ["ffmpeg", "-y", "-i", mp3Path, "-ar", String(sampleRate), "-ac", "1", "-f", "wav", wavPath],
    { stdout: "ignore", stderr: "pipe" },
  )
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 400)}`)

  const wav = new Uint8Array(await Bun.file(wavPath).arrayBuffer())
  const { pcm } = readWavPcm(wav)
  await Bun.write(pcmPath, pcm)
  await Bun.file(mp3Path).delete()
  return { wavPath, pcmPath, pcmBytes: pcm.byteLength }
}

async function main() {
  loadRepoEnv()
  const { XaiBatchTts } = await import("../src/tts.ts")
  const { STT_SAMPLE_RATE } = await import("../src/xai.ts")

  mkdirSync(STT_DIR, { recursive: true })
  mkdirSync(TTS_DIR, { recursive: true })

  const tts = new XaiBatchTts()

  process.stderr.write(`generating STT fixture phrase="${STT_PHRASE}"\n`)
  const sttMp3 = await tts.synthesize(STT_PHRASE)
  if (!sttMp3.byteLength) throw new Error("STT source TTS returned empty audio")
  const sttBase = join(STT_DIR, "run-the-tests")
  const stt = await convertMp3ToSttWav(sttMp3, sttBase, STT_SAMPLE_RATE)
  await Bun.write(
    join(STT_DIR, "run-the-tests.json"),
    JSON.stringify(
      {
        phrase: STT_PHRASE,
        sampleRate: STT_SAMPLE_RATE,
        channels: 1,
        encoding: "pcm16",
        pcmBytes: stt.pcmBytes,
        wav: "run-the-tests.wav",
        pcm: "run-the-tests.pcm",
      },
      null,
      2,
    ),
  )

  process.stderr.write(`generating TTS fixture phrase="${TTS_PHRASE}"\n`)
  const helloMp3 = await tts.synthesize(TTS_PHRASE)
  if (!helloMp3.byteLength) throw new Error("TTS fixture returned empty audio")
  await Bun.write(join(TTS_DIR, "hello-world.mp3"), helloMp3)
  await Bun.write(
    join(TTS_DIR, "hello-world.json"),
    JSON.stringify(
      {
        phrase: TTS_PHRASE,
        format: "mp3",
        bytes: helloMp3.byteLength,
      },
      null,
      2,
    ),
  )

  process.stderr.write("generating second TTS fixture for speech-plan smoke\n")
  const offerMp3 = await tts.synthesize("Want me to give you more details?")
  await Bun.write(join(TTS_DIR, "offer-phrase.mp3"), offerMp3)
  await Bun.write(
    join(TTS_DIR, "offer-phrase.json"),
    JSON.stringify(
      {
        phrase: "Want me to give you more details?",
        format: "mp3",
        bytes: offerMp3.byteLength,
      },
      null,
      2,
    ),
  )

  await Bun.write(
    join(ROOT, "manifest.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        stt: ["stt/run-the-tests.json"],
        tts: ["tts/hello-world.json", "tts/offer-phrase.json"],
      },
      null,
      2,
    ),
  )

  process.stderr.write(`fixtures written under ${ROOT}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
