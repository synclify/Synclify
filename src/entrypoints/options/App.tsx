import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
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
    // Load settings from sync storage
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
    <div>
      <Toaster />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="w-96 space-y-6">
          <div>
            <h3 className="mb-4 text-lg font-medium">Settings</h3>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="syncAudio"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <FormLabel>Sync audio</FormLabel>
                    <FormDescription>
                      Sync audio volume with the other user
                    </FormDescription>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <Button className="mt-2" type="submit">
              Save
            </Button>
          </div>
        </form>
      </Form>
    </div>
  )
}

export default App
