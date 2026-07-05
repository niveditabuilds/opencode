import {
  handleVoiceHttp,
  matchVoiceStreamPath,
  runVoiceStream,
  voiceSessions,
  writeLog,
  type VoiceSocket,
} from "@opencode-ai/voice-server"
import { Effect, Queue } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import * as Socket from "effect/unstable/socket/Socket"

const OPEN = 1

function resolveVoiceRequestUrl(request: HttpServerRequest.HttpServerRequest): URL {
  if (request.url.includes("://")) return new URL(request.url)
  const host = request.headers.host
  if (!host) return new URL(request.url, "http://localhost")
  return new URL(`http://${host}${request.url.startsWith("/") ? "" : "/"}${request.url}`)
}

function createVoiceSocketBridge(
  enqueue: (item: string | Uint8Array | Socket.CloseEvent) => Effect.Effect<void>,
) {
  let readyState = OPEN
  const inbound: (string | Uint8Array)[] = []
  let inboundWake: (() => void) | undefined
  let inboundClosed = false

  const pushInbound = (message: string | Uint8Array) => {
    inbound.push(message)
    inboundWake?.()
  }

  const socket: VoiceSocket = {
    get readyState() {
      return readyState
    },
    binaryType: "arraybuffer",
    send: async (data) => {
      if (readyState !== OPEN) return
      await Effect.runPromise(enqueue(typeof data === "string" ? data : data).pipe(Effect.catch(() => Effect.void)))
    },
    close: (code, reason) => {
      readyState = WebSocket.CLOSED
      inboundClosed = true
      inboundWake?.()
      void Effect.runPromise(
        enqueue(new Socket.CloseEvent(code ?? 1000, reason ?? "")).pipe(Effect.catch(() => Effect.void)),
      )
    },
    readInbound: async () => {
      while (!inboundClosed) {
        if (inbound.length) return inbound.shift()
        await new Promise<void>((resolve) => {
          inboundWake = resolve
        })
        inboundWake = undefined
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  }

  return {
    socket,
    pushInbound,
    close: () => {
      readyState = WebSocket.CLOSED
      inboundClosed = true
      inboundWake?.()
    },
  }
}

const handleVoiceStream = Effect.fn("VoiceHttpApi.stream")(function* (
  request: HttpServerRequest.HttpServerRequest,
  voiceId: string,
) {
  const voice = voiceSessions.get(voiceId)
  if (!voice) {
    writeLog("WS", `upgrade rejected voiceId=${voiceId} reason=session not found`, { source: "sidecar" })
    return HttpServerResponse.empty({ status: 404 })
  }

  writeLog("WS", `client upgrade voiceId=${voiceId} transport=${voice.composer ? "web" : "tui"}`, {
    voiceId: voice.id,
    sessionId: voice.opencodeSessionId,
    transport: voice.composer ? "web" : "tui",
  })

  const socket = yield* Effect.orDie(request.upgrade)
  const write = yield* socket.writer
  const outbox = yield* Queue.unbounded<string | Uint8Array | Socket.CloseEvent>()
  const bridge = createVoiceSocketBridge((item) => Queue.offer(outbox, item))

  const drain = Effect.gen(function* () {
    while (true) {
      const item = yield* Queue.take(outbox)
      yield* write(item)
      if (item instanceof Socket.CloseEvent) return
    }
  })

  yield* Effect.race(
    drain,
    Effect.gen(function* () {
      yield* Effect.forkChild(
        Effect.tryPromise(() => runVoiceStream(bridge.socket, voice)).pipe(
          Effect.ensuring(Effect.sync(() => bridge.close())),
        ),
      )
      yield* socket
        .runRaw((message) => Effect.sync(() => bridge.pushInbound(message)))
        .pipe(
          Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
          Effect.ensuring(Effect.sync(() => bridge.close())),
        )
    }),
  ).pipe(
    Effect.ensuring(Effect.sync(() => bridge.close())),
    Effect.orDie,
  )

  return HttpServerResponse.empty()
})

const handleVoiceHttpRequest = Effect.fn("VoiceHttpApi.request")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  const url = resolveVoiceRequestUrl(request)
  const voiceId = matchVoiceStreamPath(url.pathname)
  if (voiceId && request.headers.upgrade?.toLowerCase() === "websocket") {
    return yield* handleVoiceStream(request, voiceId)
  }

  const body =
    request.method !== "GET" && request.method !== "HEAD" ? yield* Effect.orDie(request.text) : undefined
  const web = new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
  })
  const response = yield* Effect.promise(() => handleVoiceHttp(web))
  if (!response) return HttpServerResponse.empty({ status: 404 })
  return HttpServerResponse.fromWeb(response)
})

export const voiceRoute = HttpRouter.middleware()(
  Effect.succeed((next) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const pathname = resolveVoiceRequestUrl(request).pathname
      if (!pathname.startsWith("/voice")) return yield* next
      return yield* handleVoiceHttpRequest(request)
    }),
  ),
  { global: true },
)
