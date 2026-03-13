type FullscreenRegistration = {
  element: HTMLElement
  savedParent: HTMLElement | null
}

const FULLSCREEN_EVENT = "__synclify_fs_enter__"
const WRAPPER_ATTR = "data-synclify-fs-wrapper"

const registrations = new Set<FullscreenRegistration>()

function moveToTarget(reg: FullscreenRegistration, target: Element): void {
  if (reg.element.parentElement !== target) {
    target.appendChild(reg.element)
  }
  reg.element.style.pointerEvents = "auto"
}

function restoreElement(reg: FullscreenRegistration): void {
  if (reg.element.parentElement !== reg.savedParent) {
    ;(reg.savedParent ?? document.body).appendChild(reg.element)
  }
  reg.element.style.pointerEvents = ""
}

function moveAllToFullscreenTarget(): void {
  const target = document.fullscreenElement
  if (!target || target instanceof HTMLVideoElement) return
  registrations.forEach((reg) => moveToTarget(reg, target))
}

function unwrapVideoWrappers(): void {
  document.querySelectorAll(`[${WRAPPER_ATTR}]`).forEach((wrapper) => {
    const video = wrapper.querySelector("video")
    if (video && wrapper.parentElement) {
      video.style.width = ""
      video.style.height = ""
      wrapper.parentElement.insertBefore(video, wrapper)
      wrapper.remove()
    }
  })
}

export function watchFullscreen(element: HTMLElement): () => void {
  const reg: FullscreenRegistration = {
    element,
    savedParent: element.parentElement
  }
  registrations.add(reg)

  const onFullscreenEnter = () => {
    moveAllToFullscreenTarget()
  }

  const onFullscreenChange = () => {
    const fsEl = document.fullscreenElement
    if (fsEl) {
      if (fsEl instanceof HTMLVideoElement) {
        return
      }
      moveToTarget(reg, fsEl)
    } else {
      restoreElement(reg)
      unwrapVideoWrappers()
    }
  }

  document.addEventListener(FULLSCREEN_EVENT, onFullscreenEnter)
  document.addEventListener("fullscreenchange", onFullscreenChange)

  if (
    document.fullscreenElement &&
    !(document.fullscreenElement instanceof HTMLVideoElement)
  ) {
    moveToTarget(reg, document.fullscreenElement)
  }

  return () => {
    document.removeEventListener(FULLSCREEN_EVENT, onFullscreenEnter)
    document.removeEventListener("fullscreenchange", onFullscreenChange)
    registrations.delete(reg)
    restoreElement(reg)
  }
}
