import { join } from "node:path"

export const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures")

export function fixturePath(...parts: string[]) {
  return join(FIXTURES_DIR, ...parts)
}

export async function readFixtureJson<T>(...parts: string[]) {
  return Bun.file(fixturePath(...parts)).json() as Promise<T>
}

export async function readFixtureBytes(...parts: string[]) {
  return new Uint8Array(await Bun.file(fixturePath(...parts)).arrayBuffer())
}
