import { watchFullscreen } from "~/lib/fullscreen"

type MountOptions = {
  id: string
  shadow?: boolean
  watchFullscreenHost?: boolean
}

type MountedUi = {
  host: HTMLElement
  mountPoint: HTMLElement
}

declare global {
  interface Window {
    __synclifyRuntimeFlags?: Record<string, boolean>
  }
}

export function runOnce(key: string): boolean {
  const flags = (window.__synclifyRuntimeFlags ??= {})
  if (flags[key]) return false
  flags[key] = true
  return true
}

export function whenBodyReady(callback: () => void): void {
  if (document.body) {
    callback()
    return
  }

  const observer = new MutationObserver(() => {
    if (!document.body) return
    observer.disconnect()
    callback()
  })

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  })
}

export function mountUi(options: MountOptions): MountedUi {
  let host = document.getElementById(options.id) as HTMLElement | null
  if (!host) {
    host = document.createElement("div")
    host.id = options.id
    document.body.appendChild(host)
  }

  let mountPoint = host
  if (options.shadow) {
    const shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" })
    let shadowMount = shadowRoot.getElementById("app") as HTMLElement | null
    if (!shadowMount) {
      shadowMount = document.createElement("div")
      shadowMount.id = "app"
      shadowRoot.appendChild(shadowMount)
    }
    mountPoint = shadowMount
  }

  if (options.watchFullscreenHost) {
    watchFullscreen(host)
  }

  return { host, mountPoint }
}
