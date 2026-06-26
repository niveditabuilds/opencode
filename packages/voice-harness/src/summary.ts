export function stripMarkdownInline(text: string) {
  return text.replaceAll("**", "").replaceAll("__", "").replaceAll("`", "")
}

export function splitSentences(text: string) {
  const sentences: string[] = []
  let chunk = ""
  for (const char of text) {
    chunk += char
    if (".!?".includes(char) && chunk.trim().length > 15) {
      sentences.push(chunk.trim())
      chunk = ""
    }
  }
  if (chunk.trim()) sentences.push(chunk.trim())
  return sentences
}

export function looksLikeLongForm(text: string) {
  if (text.length > 300) return true
  if (text.split("\n").length >= 2) return true
  if (text.includes("```") || text.includes("http://") || text.includes("https://")) return true
  if (text.includes("packages/")) return true
  if (text.split("\n").filter((line) => /^[-*•]\s/.test(line.trim())).length >= 2) return true
  if (text.split(": ").length >= 3) return true
  return false
}

export function voiceSummary(text: string, maxChars = 260) {
  const stripped = text.trim()
  if (!stripped) return ""
  if (stripped.length <= 120 && !looksLikeLongForm(stripped)) return stripped

  const tail = " Details are on screen."
  const paragraphs = stripped.split("\n\n").map((part) => part.trim()).filter(Boolean)
  const first = paragraphs[0] ?? stripped
  const firstLine = first.split("\n", 1)[0]?.trim() ?? first.trim()
  const candidate = stripMarkdownInline(firstLine.length < first.length ? firstLine : first.replaceAll("\n", " "))

  const sentences = splitSentences(candidate)
  let gist = sentences[0] ?? candidate
  if (gist.length > maxChars) gist = gist.slice(0, maxChars).replace(/\s+\S*$/, "").replace(/[.,;:\-—]+$/, "")

  if (looksLikeLongForm(stripped) || stripped.length > gist.length + 40) {
    gist = `${gist.replace(/[.,;:\-—]+$/, "")}.${tail}`
  }
  return gist
}

export function speakText(text: string) {
  return voiceSummary(text)
}
