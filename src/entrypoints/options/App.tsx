import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage
} from "~/components/ui/form"
import { Button } from "~/components/ui/button"
import { Switch } from "~/components/ui/switch"
import { Toaster } from "~/components/ui/sonner"
import { toast } from "sonner"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import browser from "webextension-polyfill"
import logo from "~/assets/logo.svg?raw"

export const settingsSchema = z.object({
  syncAudio: z.boolean()
})

function App() {
  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    defaultValues: { syncAudio: false }
  })

  useEffect(() => {
    document.documentElement.classList.add("dark")
    browser.storage.sync.get("settings").then((result) => {
      if (result.settings) {
        form.reset(result.settings as z.infer<typeof settingsSchema>)
      }
    })
  }, [form])

  function onSubmit(values: z.infer<typeof settingsSchema>) {
    browser.storage.sync
      .set({ settings: { syncAudio: values.syncAudio } })
      .then(() => {
        toast.success("Settings saved")
      })
      .catch((e) => {
        console.error(e)
        toast.error("Failed to save settings", { description: String(e) })
      })
  }

  return (
    <div className="dark relative flex min-h-screen items-start justify-center bg-background">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute left-1/2 top-0 h-60 w-96 -translate-x-1/2 rounded-full opacity-10 blur-3xl"
        style={{ background: "hsl(38 92% 55%)" }}
      />

      <Toaster />

      <div className="relative z-10 w-full max-w-md px-6 py-12">
        {/* Logo */}
        <div className="animate-fade-in-up mb-10">
          <div
            dangerouslySetInnerHTML={{ __html: logo }}
            className="mx-auto w-40 opacity-90"
          />
        </div>

        {/* Settings card */}
        <div className="animate-fade-in-up stagger-1">
          <h2 className="mb-6 text-[11px] font-medium uppercase tracking-[0.25em] text-secondary-foreground">
            Settings
          </h2>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="syncAudio"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-4 py-4 transition-colors hover:border-[hsl(38_92%_55%/0.25)]">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        Sync audio
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Sync volume with the other viewer
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        className="data-[state=checked]:bg-[hsl(38_92%_55%)]"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full rounded-lg bg-[hsl(38_92%_55%)] py-5 text-sm font-semibold tracking-wide text-[hsl(220_20%_6%)] shadow-lg shadow-[hsl(38_92%_55%/0.15)] transition-all hover:bg-[hsl(38_80%_50%)] hover:shadow-[hsl(38_92%_55%/0.25)]">
                Save Settings
              </Button>
            </form>
          </Form>
        </div>

        {/* Footer */}
        <div className="animate-fade-in stagger-3 mt-10 text-center">
          <a
            href="https://synclify.party"
            target="about:blank"
            className="text-[11px] text-muted-foreground transition-colors hover:text-[hsl(38_92%_55%)]">
            synclify.party
          </a>
        </div>
      </div>
    </div>
  )
}

export default App
