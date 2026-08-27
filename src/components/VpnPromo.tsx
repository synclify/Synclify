import browser from "webextension-polyfill"
import { usePostHog } from "@posthog/react"
import { useCallback } from "react"
import pureVpnMark from "~/assets/purevpn-mark.svg?raw"
import { t } from "~/lib/i18n"

const PUREVPN_URL = "https://www.purevpn.com/unblock-streaming?aff=49388045"

export function VpnPromo() {
  const posthog = usePostHog()

  const openOffer = useCallback(() => {
    posthog?.capture("affiliate_clicked", {
      partner: "purevpn",
      placement: "popup_below_join_room",
      extension_version: browser.runtime.getManifest().version
    })
  }, [posthog])

  return (
    <a
      href={PUREVPN_URL}
      target="_blank"
      rel="sponsored noreferrer noopener"
      onClick={openOffer}
      className="promo-card animate-fade-in-up stagger-4 group relative mt-4 block w-full overflow-hidden rounded-xl border border-[hsl(149_66%_47%/0.2)] bg-[hsl(160_35%_9%/0.6)] px-3 py-2.5 text-left no-underline transition-colors duration-300 hover:border-[hsl(149_66%_47%/0.5)] hover:bg-[hsl(160_35%_11%/0.75)]">
      {/* Ambient signal glow */}
      <span className="pointer-events-none absolute -left-7 -top-9 h-24 w-24 rounded-full bg-[hsl(149_70%_47%)] opacity-[0.14] blur-2xl transition-opacity duration-500 group-hover:opacity-30" />

      {/* Lit top edge */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[hsl(149_85%_70%/0.25)] to-transparent" />

      {/* Sheen sweep on hover */}
      <span className="promo-sheen pointer-events-none absolute inset-y-0 left-0 w-14 bg-gradient-to-r from-transparent via-[hsl(149_85%_70%/0.14)] to-transparent" />

      {/* Disclosure — parked in the bottom-right corner, clear of the chevron above it */}
      <span className="pointer-events-none absolute bottom-1 right-2 text-[8px] font-medium uppercase leading-none tracking-[0.08em] text-muted-foreground/50">
        {t("vpnPromoAdLabel")}
      </span>

      <span className="relative flex items-center gap-2.5">
        {/* Partner mark — rendered unaltered, the knockout shows the card surface */}
        <span
          className="block h-8 w-8 shrink-0 text-white"
          dangerouslySetInnerHTML={{ __html: pureVpnMark }}
        />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-[hsl(149_60%_55%)]">
            {t("vpnPromoEyebrow")}
          </span>
          {/* pr reserves the corner the disclosure occupies, so copy can never run under it */}
          <span className="mt-1 block pr-7 text-[12px] font-semibold leading-[1.2] text-foreground">
            {t("vpnPromoTitle")}
          </span>
        </span>

        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-[hsl(149_60%_50%)] transition-transform duration-300 group-hover:translate-x-0.5">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </span>
    </a>
  )
}
