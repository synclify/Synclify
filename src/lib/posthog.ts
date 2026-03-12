import { PostHog } from "posthog-js/dist/module.no-external"
import "posthog-js/dist/exception-autocapture"
import browser from "webextension-polyfill"
import { SOCKET_URL } from "~/types/socket"

const POSTHOG_KEY = import.meta.env.WXT_PUBLIC_POSTHOG_KEY as string
const POSTHOG_HOST =
  (import.meta.env.WXT_PUBLIC_POSTHOG_HOST as string) ||
  "https://eu.i.posthog.com"

export async function getSharedDistinctId(): Promise<string> {
  const stored = await browser.storage.local.get(["posthog_distinct_id"])
  if (stored.posthog_distinct_id) return stored.posthog_distinct_id as string
  const id = crypto.randomUUID()
  await browser.storage.local.set({ posthog_distinct_id: id })
  return id
}

type PostHogContext = "background" | "injected" | "popup"

export async function createPostHog(context: PostHogContext): Promise<PostHog> {
  const distinctId = await getSharedDistinctId()
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
