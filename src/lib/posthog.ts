import { PostHog } from "posthog-js/dist/module.no-external"
import "posthog-js/dist/exception-autocapture"
import browser from "webextension-polyfill"
import { SOCKET_URL } from "~/types/socket"

const POSTHOG_KEY = import.meta.env.WXT_PUBLIC_POSTHOG_KEY as string
const POSTHOG_HOST =
  (import.meta.env.WXT_PUBLIC_POSTHOG_HOST as string) ||
  "https://eu.i.posthog.com"
export const POSTHOG_DISTINCT_ID_STORAGE_KEY = "posthog_distinct_id"

type PostHogContext = "background" | "injected" | "popup"

let sharedDistinctIdPromise: Promise<string> | null = null

async function getStoredDistinctId(): Promise<string> {
  const stored = await browser.storage.local.get([
    POSTHOG_DISTINCT_ID_STORAGE_KEY
  ])
  const distinctId = stored[POSTHOG_DISTINCT_ID_STORAGE_KEY]

  if (typeof distinctId === "string" && distinctId.length > 0) {
    return distinctId
  }

  const id = crypto.randomUUID()
  await browser.storage.local.set({ [POSTHOG_DISTINCT_ID_STORAGE_KEY]: id })
  return id
}

export async function getSharedDistinctId(
  context: PostHogContext
): Promise<string> {
  if (!sharedDistinctIdPromise) {
    sharedDistinctIdPromise =
      context === "background"
        ? getStoredDistinctId()
        : browser.runtime
            .sendMessage({ action: "getPosthogDistinctId" })
            .then((distinctId) => {
              if (
                typeof distinctId !== "string" ||
                distinctId.length === 0
              ) {
                throw new Error("Background distinct ID unavailable")
              }
              return distinctId
            })
            .catch(() => getStoredDistinctId())
  }

  return sharedDistinctIdPromise
}

export async function createPostHog(context: PostHogContext): Promise<PostHog> {
  const distinctId = await getSharedDistinctId(context)
  const posthog = new PostHog()

  const shared = {
    api_host: `${SOCKET_URL}/m`,
    ui_host: POSTHOG_HOST,
    disable_external_dependency_loading: true,
    bootstrap: { distinctID: distinctId },
    error_tracking: { captureExtensionExceptions: true }
  } as const

  switch (context) {
    case "background":
      posthog.init(POSTHOG_KEY, {
        ...shared,
        persistence: "memory",
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true
      })
      break

    case "injected":
      posthog.init(POSTHOG_KEY, {
        ...shared,
        persistence: "memory",
        capture_pageview: false,
        autocapture: false,
        disable_session_recording: true,
        disable_surveys: true
      })
      break

    case "popup":
      posthog.init(POSTHOG_KEY, {
        ...shared,
        persistence: "localStorage",
        capture_pageview: true,
        autocapture: true
      })
      break
  }

  return posthog
}
