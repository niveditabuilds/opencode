import { For, Show, createEffect, createMemo, createSignal } from "solid-js"
import { voiceOutput, type VoiceDisplayState } from "./voice"

export function VoiceDebugPanel(props: {
  display: () => VoiceDisplayState
  active: () => boolean
  awaitingSpeak: () => boolean
  working: () => boolean
  sidecarUrl: () => string
  logLines: () => string[]
  lastAction: () => string
}) {
  const [logRev, setLogRev] = createSignal(0)
  createEffect(() => {
    props.active()
    props.awaitingSpeak()
    props.working()
    props.display()
    voiceOutput.speaking
    props.lastAction()
    setLogRev((n) => n + 1)
  })

  // Harness decisions / triggers / buffer flushes and the local speak/skip notes.
  const events = createMemo(() => {
    logRev()
    return props
      .logLines()
      .filter((line) => line.includes("[HARNESS]") || line.includes("[TTS]") || line.includes("[REPLY]"))
      .slice(-24)
      .reverse()
  })

  return (
    <div
      data-component="voice-debug"
      class="pointer-events-auto fixed top-2 right-2 z-[2147483647] max-h-[min(90vh,640px)] w-[min(92vw,22rem)] overflow-auto rounded-md border-2 border-red-950 bg-red-600 p-2 font-mono text-[10px] leading-snug text-white shadow-2xl"
    >
      <div class="mb-1 text-[11px] font-bold uppercase tracking-wide text-red-100">Voice debug</div>
      <div class="grid gap-0.5">
        <div>
          <span class="text-red-200">phase</span> {props.display()}
          {" · "}
          <span class="text-red-200">tts</span>{" "}
          <span class={voiceOutput.speaking ? "font-bold text-yellow-200" : ""}>
            {voiceOutput.speaking ? "ON (speaking)" : "off"}
          </span>
        </div>
        <div>
          <span class="text-red-200">active</span> {String(props.active())}
          {" · "}
          <span class="text-red-200">awaitingSpeak</span> {String(props.awaitingSpeak())}
          {" · "}
          <span class="text-red-200">working</span> {String(props.working())}
        </div>
        <div>
          <span class="text-red-200">sidecar</span> {props.sidecarUrl()}
        </div>
        <div class="break-words">
          <span class="text-red-200">last</span> {props.lastAction() || "—"}
        </div>
      </div>
      <Show when={events().length > 0}>
        <div class="mt-2 border-t border-red-800 pt-1 text-[9px]">
          <div class="mb-0.5 font-bold text-red-100">decisions · triggers · flushes</div>
          <For each={events()}>
            {(line) => (
              <div
                class="break-all whitespace-pre-wrap"
                classList={{
                  "font-semibold text-yellow-100": line.includes("[HARNESS]"),
                  "text-red-50": !line.includes("[HARNESS]"),
                }}
              >
                {line}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
