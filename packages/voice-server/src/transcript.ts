export function bestTranscript(committed: string[], text: string) {
  const joined = committed.join(" ").trim()
  const segment = text.trim()
  if (!segment) return joined
  if (!joined) return segment
  if (segment.includes(joined)) return segment
  if (joined.includes(segment)) return joined
  if (segment.length < joined.length * 0.5) return joined
  return `${joined} ${segment}`.trim()
}
