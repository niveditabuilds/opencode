import { type ComponentProps } from "solid-js"

export function MicIcon(props: Pick<ComponentProps<"svg">, "class" | "aria-hidden"> & { active?: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="none"
      class={props.class}
      aria-hidden={props["aria-hidden"] ?? true}
    >
      <rect
        x="7.5"
        y="3.75"
        width="5"
        height="8.75"
        rx="2.5"
        stroke="currentColor"
        stroke-width="1.25"
        fill={props.active ? "currentColor" : "none"}
        fill-opacity={props.active ? "0.15" : "0"}
      />
      <path
        d="M4.583 10a5.417 5.417 0 0 0 10.834 0M10 15.417V17.5"
        stroke="currentColor"
        stroke-width="1.25"
        stroke-linecap="round"
      />
    </svg>
  )
}

export function BrandMark(props: { class?: string }) {
  return <MicIcon class={props.class} />
}

export function BrandSplash(props: Pick<ComponentProps<"svg">, "ref" | "class">) {
  return <MicIcon class={props.class} />
}

export function BrandLogo(props: { class?: string }) {
  return (
    <div class={`inline-flex items-center gap-2.5 ${props.class ?? ""}`} data-component="voxcode-logo">
      <MicIcon class="h-[1.35em] w-[1.35em] shrink-0" />
      <span class="text-[1.35em] font-semibold tracking-tight">voxcode</span>
    </div>
  )
}

export function BrandWordmark(props: Pick<ComponentProps<"svg">, "class">) {
  return (
    <div
      class={`inline-flex items-center justify-center gap-3 ${props.class ?? ""}`}
      data-component="voxcode-wordmark"
    >
      <MicIcon class="h-8 w-8 shrink-0" />
      <span class="text-20-medium tracking-tight">Vox Code</span>
    </div>
  )
}
