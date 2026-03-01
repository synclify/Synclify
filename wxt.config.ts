import { defineConfig } from "wxt"

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-react"],
  manifest: () => ({
    name: "Synclify - Watch in sync with your friends",
    description:
      "Create a watch party straight from your browser — works anywhere, ad-free.",
    host_permissions: [
      ...new Set([
        `${import.meta.env.WXT_SOCKET_ENDPOINT || "http://localhost:3001"}/*`,
        "http://localhost:3001/*"
      ])
    ],
    optional_host_permissions: ["https://*/*"],
    optional_permissions: ["activeTab", "https://*/*"],
    permissions: ["storage", "activeTab", "scripting", "webNavigation"],
    browser_specific_settings: {
      gecko: {
        id: "{eb8f96ca-d31a-4f74-89ad-c25045497adb}"
      }
    },
    icons: {
      128: "/icon.png"
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
    }
  })
})
