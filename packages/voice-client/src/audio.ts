export function downsampleTo16k(input: Float32Array, inputRate: number) {
  const ratio = inputRate / 16000
  const outLen = Math.floor(input.length / ratio)
  const out = new Int16Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const idx = Math.floor(i * ratio)
    const s = Math.max(-1, Math.min(1, input[idx] ?? 0))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}
