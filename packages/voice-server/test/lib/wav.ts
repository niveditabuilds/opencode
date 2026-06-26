export type WavPcm = {
  sampleRate: number
  channels: number
  pcm: Uint8Array
}

export function readWavPcm(bytes: Uint8Array): WavPcm {
  if (bytes.byteLength < 44) throw new Error("wav too short")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riff = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!)
  const wave = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)
  if (riff !== "RIFF" || wave !== "WAVE") throw new Error("invalid wav header")

  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bitsPerSample = 0
  let dataOffset = 0
  let dataSize = 0

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!)
    const chunkSize = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    if (chunkId === "fmt ") {
      channels = view.getUint16(chunkStart + 2, true)
      sampleRate = view.getUint32(chunkStart + 4, true)
      bitsPerSample = view.getUint16(chunkStart + 14, true)
    }
    if (chunkId === "data") {
      dataOffset = chunkStart
      dataSize = chunkSize
      break
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  if (!dataOffset || !sampleRate || !channels || bitsPerSample !== 16) {
    throw new Error("wav must be 16-bit PCM with a data chunk")
  }

  return {
    sampleRate,
    channels,
    pcm: bytes.slice(dataOffset, dataOffset + dataSize),
  }
}

export function writeWavPcm(input: { sampleRate: number; channels: number; pcm: Uint8Array }) {
  const blockAlign = input.channels * 2
  const byteRate = input.sampleRate * blockAlign
  const dataSize = input.pcm.byteLength
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const out = new Uint8Array(buffer)

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }

  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, input.channels, true)
  view.setUint32(24, input.sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeAscii(36, "data")
  view.setUint32(40, dataSize, true)
  out.set(input.pcm, 44)
  return out
}
