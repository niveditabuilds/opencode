import { describe, expect, test } from "bun:test"

function pcmFromMessage(data: unknown) {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array()
}

describe("pcmFromMessage", () => {
  test("accepts Uint8Array from embedded websocket bridge", () => {
    const input = new Uint8Array([1, 2, 3, 4])
    expect(Array.from(pcmFromMessage(input))).toEqual([1, 2, 3, 4])
  })

  test("accepts ArrayBuffer from browser websocket", () => {
    const input = new Uint8Array([5, 6]).buffer
    expect(Array.from(pcmFromMessage(input))).toEqual([5, 6])
  })
})
