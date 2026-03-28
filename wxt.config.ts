import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: ({ browser }) => ({
    name: "Synclify - Watch in sync with your friends",
    description:
      "Create a watch party straight from your browser — works anywhere, ad-free.",
    host_permissions: [
      ...new Set([
        `${import.meta.env.WXT_SOCKET_ENDPOINT || "http://localhost:3001"}/*`,
        "http://localhost:3001/*",
        `${import.meta.env.WXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com"}/*`
      ])
    ],
    optional_host_permissions: ["https://*/*", "http://*/*"],
    optional_permissions: ["activeTab"],
    permissions: ["storage", "activeTab", "scripting"],
    content_security_policy: {
      extension_pages: [
        "script-src 'self';",
        "object-src 'self';",
        `connect-src 'self' https://*.posthog.com https://eu.i.posthog.com http://localhost:3000 http://localhost:3001 ws://localhost:3000 ws://localhost:3001 ${import.meta.env.WXT_SOCKET_ENDPOINT || ""};`
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    },
    browser_specific_settings: {
      gecko: {
        id: "{eb8f96ca-d31a-4f74-89ad-c25045497adb}"
      }
    },
    icons: {
      128:
        browser === "firefox"
          ? "/extension-icon-firefox.png"
          : "/extension-icon.png"
    },
    web_accessible_resources: [
      {
        resources: ["injected.js"],
        matches: ["<all_urls>"]
      }
    ]
  }),
  imports: false,
  vite: () => ({
    resolve: {
      alias: {
        react: "preact/compat",
        "react-dom": "preact/compat"
      }
    },
    build: {
      target: "esnext"
    },
    esbuild: {
      charset: "ascii"
    }
  })
})
