import "~/style.css"

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
import { Storage } from "@plasmohq/storage"
import { Switch } from "~components/ui/switch"
import { Toaster } from "~components/ui/sonner"
import { toast } from "../node_modules/sonner/dist"
import { useEffect } from "react"
import { useForm } from "react-hook-form"
import { useStorage } from "@plasmohq/storage/hook"
import { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

export const settingsSchema = z.object({
  syncAudio: z.boolean()
})
function OptionsIndex() {
  const [settings, setSettings] = useStorage<{ syncAudio: boolean }>(
    {
      key: "settings",
      instance: new Storage({
        area: "sync"
      })
    },
    (v) => (v === undefined ? { syncAudio: false } : v)
  )

  const form = useForm<z.infer<typeof settingsSchema>>({
    resolver: zodResolver(settingsSchema),
    values: settings
  })

  useEffect(() => {
    document.documentElement.classList.add("dark")
  }, [settings, form])

  function onSubmit(values: z.infer<typeof settingsSchema>) {
    setSettings({ syncAudio: values.syncAudio })
      .then((v) => {
        toast.success("Settings saved")
      })
      .catch((e) => {
        console.error(e)
        toast.error("Failed to save settings", { description: e })
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

export default OptionsIndex
