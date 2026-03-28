const FULLSCREEN_EVENT = "__synclify_fs_enter__"
const WRAPPER_ATTR = "data-synclify-fs-wrapper"

export function initFullscreenPatch(): void {
  const win = window as Window & { __synclifyFullscreenPatched?: boolean }
  if (win.__synclifyFullscreenPatched) return
  win.__synclifyFullscreenPatched = true

  const origRequestFS = Element.prototype.requestFullscreen
  if (typeof origRequestFS !== "function") {
    return
  }

    function wrapVideo(video: HTMLVideoElement): HTMLDivElement {
      const wrapper = document.createElement("div")
      wrapper.setAttribute(WRAPPER_ATTR, "")
      wrapper.style.cssText = `position:relative;width:${video.offsetWidth}px;height:${video.offsetHeight}px;background:#000`
      video.parentNode!.insertBefore(wrapper, video)
      wrapper.appendChild(video)
      video.style.width = "100%"
      video.style.height = "100%"
      return wrapper
    }

    function unwrapVideo(wrapper: Element): void {
      const video = wrapper.querySelector("video")
      if (video && wrapper.parentNode) {
        video.style.width = ""
        video.style.height = ""
        wrapper.parentNode.insertBefore(video, wrapper)
        wrapper.remove()
      }
    }

    Element.prototype.requestFullscreen = function (
      ...args: Parameters<typeof origRequestFS>
    ) {
      const el = this

      if (el instanceof HTMLVideoElement) {
        const wrapper = wrapVideo(el)

        return origRequestFS.apply(wrapper, args).then(
          (v) => {
            document.dispatchEvent(new CustomEvent(FULLSCREEN_EVENT))
            return v
          },
          (err) => {
            unwrapVideo(wrapper)
            throw err
          }
        )
      }

      return origRequestFS.apply(el, args).then(
        (v) => {
          document.dispatchEvent(new CustomEvent(FULLSCREEN_EVENT))
          return v
        },
        (err) => {
          throw err
        }
      )
    }

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      document
        .querySelectorAll(`[${WRAPPER_ATTR}]`)
        .forEach((w) => unwrapVideo(w))
    }
  })
}
