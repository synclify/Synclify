import React from "react"
import ReactDOM from "react-dom/client"
import { PostHogProvider } from "@posthog/react"
import "posthog-js/dist/posthog-recorder"

import App from "./App"
import "~/assets/style.css"
import { createPostHog } from "~/lib/posthog"

async function mount() {
  const posthog = await createPostHog("popup")

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PostHogProvider client={posthog}>
        <App />
      </PostHogProvider>
    </React.StrictMode>
  )
}

mount()
