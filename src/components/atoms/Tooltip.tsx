import {
  ElementProps,
  FloatingContext,
  useClick,
  useFloating,
  useInteractions,
  useRole
} from "@floating-ui/react-dom-interactions"
import React, { cloneElement, useRef, useState } from "react"

type TooltipProps = {
  content: string
  children: React.ReactElement
  onReferenceClick?: () => void
}

const Tooltip = ({ content, children, onReferenceClick }: TooltipProps) => {
  const [open, setOpen] = useState(false)
  const { x, y, reference, floating, strategy, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "top"
  })
  const { getReferenceProps } = useInteractions([
    useClick(context, { enabled: true, toggle: false }),
    useRole(context, { role: "tooltip" }),
    useClickDelay(context, onReferenceClick)
  ])

  return (
    <>
      <div
        className={`${
          !open ? "opacity-0" : ""
        } tooltip absolute z-10 inline-block rounded-lg bg-gray-900 py-2 px-3 text-sm font-medium text-white shadow-sm transition-opacity duration-300 dark:bg-gray-700`}
        ref={floating}
        id="tooltip-default"
        role="tooltip"
        style={{
          position: strategy,
          top: y ?? 0,
          left: x ?? 0,
          width: "max-content"
        }}>
        {content}
      </div>

      {cloneElement(children, { ref: reference, ...getReferenceProps() })}
    </>
  )
}

export default Tooltip

const useClickDelay = (
  context: FloatingContext,
  onReferenceClick?: () => void
): ElementProps => {
  const timeoutRef = useRef<NodeJS.Timeout>()
  return {
    reference: {
      onClick() {
        onReferenceClick?.()
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => context.onOpenChange(false), 2000)
      }
    }
  }
}
