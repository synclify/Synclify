type FullscreenRegistration = {
  element: HTMLElement
  savedParent: HTMLElement | null
}

const TAG = "[synclify/fullscreen]"
const FULLSCREEN_EVENT = "__synclify_fs_enter__"
const WRAPPER_ATTR = "data-synclify-fs-wrapper"

const registrations = new Set<FullscreenRegistration>()

function moveToTarget(reg: FullscreenRegistration, target: Element): void {
  console.debug(TAG, "moveToTarget", {
    element: reg.element,
    target,
    targetTag: target.tagName,
    alreadyChild: reg.element.parentElement === target
  })
  if (reg.element.parentElement !== target) {
    target.appendChild(reg.element)
  }
  reg.element.style.pointerEvents = "auto"
}

function restoreElement(reg: FullscreenRegistration): void {
  console.debug(TAG, "restoreElement", {
    element: reg.element,
    savedParent: reg.savedParent
  })
  if (reg.element.parentElement !== reg.savedParent) {
    ;(reg.savedParent ?? document.body).appendChild(reg.element)
  }
  reg.element.style.pointerEvents = ""
}

function moveAllToFullscreenTarget(): void {
  const target = document.fullscreenElement
  console.debug(TAG, "moveAllToFullscreenTarget", {
    target,
    targetTag: target?.tagName,
    registrationCount: registrations.size
  })
  if (!target || target instanceof HTMLVideoElement) return
  registrations.forEach((reg) => moveToTarget(reg, target))
}

function unwrapVideoWrappers(): void {
  document.querySelectorAll(`[${WRAPPER_ATTR}]`).forEach((wrapper) => {
    const video = wrapper.querySelector("video")
    if (video && wrapper.parentElement) {
      console.debug(TAG, "unwrapping video from wrapper", { video, wrapper })
      video.style.width = ""
      video.style.height = ""
      wrapper.parentElement.insertBefore(video, wrapper)
      wrapper.remove()
    }
  })
}

export function watchFullscreen(element: HTMLElement): () => void {
  console.debug(TAG, "watchFullscreen called", {
    element,
    parentElement: element.parentElement
  })

  const reg: FullscreenRegistration = {
    element,
    savedParent: element.parentElement
  }
  registrations.add(reg)

  const onFullscreenEnter = () => {
    console.debug(TAG, "custom event received (__synclify_fs_enter__)", {
      fullscreenElement: document.fullscreenElement,
      fullscreenElementTag: document.fullscreenElement?.tagName
    })
    moveAllToFullscreenTarget()
  }

  const onFullscreenChange = () => {
    const fsEl = document.fullscreenElement
    console.debug(TAG, "fullscreenchange fired", {
      fullscreenElement: fsEl,
      fullscreenElementTag: fsEl?.tagName
    })
    if (fsEl) {
      if (fsEl instanceof HTMLVideoElement) {
        console.debug(
          TAG,
          "skipping VIDEO fullscreenElement — waiting for wrapper"
        )
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
    console.debug(TAG, "already in fullscreen on mount", {
      fullscreenElement: document.fullscreenElement
    })
    moveToTarget(reg, document.fullscreenElement)
  }

  return () => {
    console.debug(TAG, "cleanup — removing listeners and restoring element")
    document.removeEventListener(FULLSCREEN_EVENT, onFullscreenEnter)
    document.removeEventListener("fullscreenchange", onFullscreenChange)
    registrations.delete(reg)
    restoreElement(reg)
  }
}
