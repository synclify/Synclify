type DebugShieldState = {
  enabled: boolean
  blockedRedirects: Array<{
    kind: string
    detail?: string
    ts: number
  }>
}

type ListenerWrapper = EventListenerOrEventListenerObject
type CookiesApi = {
  get?: (...args: unknown[]) => unknown
  set?: (...args: unknown[]) => unknown
  remove?: (...args: unknown[]) => unknown
} & Record<string, unknown>

declare global {
  interface Window {
    __synclifyDebugShieldInstalled?: boolean
    __synclifyDebugShield?: {
      enable: () => DebugShieldState
      disable: () => DebugShieldState
      getState: () => DebugShieldState
    }
  }
}

const SUSPICIOUS_SOURCE_RE =
  /\bdebugger\b|devtools|outerWidth\s*-\s*innerWidth|outerHeight\s*-\s*innerHeight|firebug|__defineGetter__|Function\s*\(\s*["'`][^"'`]*debugger/i

const DEVTOOLS_COOKIE_RE = /(?:^|;\s*)DevTools=([^;]*)/i
const DEVTOOLS_COOKIE_WRITE_RE = /^\s*DevTools\s*=/i
const DEVTOOLS_URL_RE = /(?:^|\/)devtools(?:\?|$)/i
const DEVTOOLS_SOURCE_MAP_RE = /\/\/#\s*sourceMappingURL\s*=\s*\/devtools[^\n\r]*/gi

function sanitizeCodeString(source: string): string {
  return stripDebuggerStatements(source).replace(DEVTOOLS_SOURCE_MAP_RE, "")
}

function stripDebuggerStatements(source: string): string {
  return source.replace(/\bdebugger\b\s*;?/g, "")
}

function getFunctionSource(fn: Function): string {
  try {
    return Function.prototype.toString.call(fn)
  } catch {
    return ""
  }
}

function sanitizeCookieString(value: string): string {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part !== "" && !/^DevTools=/i.test(part))
    .join("; ")
}

function isBlockedScript(node: Node): node is HTMLScriptElement {
  if (!(node instanceof HTMLScriptElement)) return false

  const src = node.src || node.getAttribute("src") || ""
  const content = node.textContent || ""
  return (
    DEVTOOLS_URL_RE.test(src) || /sourceMappingURL\s*=\s*\/devtools/i.test(content)
  )
}

function findPropertyDescriptor(
  target: object,
  property: PropertyKey
): PropertyDescriptor | undefined {
  let current: object | null = target

  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, property)
    if (descriptor) return descriptor
    current = Object.getPrototypeOf(current)
  }

  return undefined
}

function defineGetter<T>(
  target: object,
  property: string,
  value: T | (() => T)
): void {
  try {
    Object.defineProperty(target, property, {
      get: () => (typeof value === "function" ? (value as () => T)() : value),
      configurable: true
    })
  } catch {
    // Ignore non-configurable browser properties.
  }
}

export function initDebugShield(): void {
  if (window.__synclifyDebugShieldInstalled) return
  window.__synclifyDebugShieldInstalled = true

  const state: DebugShieldState = {
    enabled: true,
    blockedRedirects: []
  }

  const wrappedListeners = new WeakMap<object, ListenerWrapper>()

  const recordBlockedRedirect = (kind: string, detail?: string) => {
    state.blockedRedirects.push({
      kind,
      detail,
      ts: Date.now()
    })
    if (state.blockedRedirects.length > 50) state.blockedRedirects.shift()
  }

  defineGetter(Navigator.prototype, "webdriver", undefined)
  defineGetter(window, "outerWidth", () => window.innerWidth)
  defineGetter(window, "outerHeight", () => window.innerHeight)

  const cookieDescriptor =
    findPropertyDescriptor(document, "cookie") ??
    findPropertyDescriptor(Document.prototype, "cookie")

  if (
    cookieDescriptor &&
    typeof cookieDescriptor.get === "function" &&
    typeof cookieDescriptor.set === "function"
  ) {
    try {
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        enumerable: cookieDescriptor.enumerable ?? true,
        get() {
          const raw = cookieDescriptor.get?.call(document) ?? ""
          return sanitizeCookieString(raw)
        },
        set(value: string) {
          if (state.enabled && DEVTOOLS_COOKIE_WRITE_RE.test(value)) {
            recordBlockedRedirect("cookie.write", value)
            cookieDescriptor.set?.call(
              document,
              "DevTools=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"
            )
            return
          }
          cookieDescriptor.set?.call(document, value)
        }
      })
    } catch {
      // Ignore non-configurable cookie implementations.
    }
  }

  const wrapCookiesApi = (cookies: CookiesApi): CookiesApi => {
    if (!cookies || typeof cookies !== "object") return cookies

    return new Proxy(cookies, {
      get(target, prop, receiver) {
        if (prop === "get" && typeof target.get === "function") {
          return (name?: string, ...args: unknown[]) => {
            if (state.enabled && name === "DevTools") return undefined
            return target.get?.call(target, name, ...args)
          }
        }

        if (prop === "set" && typeof target.set === "function") {
          return (name?: string, value?: unknown, ...args: unknown[]) => {
            if (state.enabled && name === "DevTools") {
              recordBlockedRedirect("cookie.api.set", String(value ?? ""))
              return target.remove?.call(target, "DevTools")
            }
            return target.set?.call(target, name, value, ...args)
          }
        }

        if (prop === "remove" && typeof target.remove === "function") {
          return (name?: string, ...args: unknown[]) => {
            if (state.enabled && name === "DevTools") {
              recordBlockedRedirect("cookie.api.remove", name)
            }
            return target.remove?.call(target, name, ...args)
          }
        }

        return Reflect.get(target, prop, receiver)
      }
    })
  }

  let cookiesApiValue = wrapCookiesApi((window as Window & { Cookies?: CookiesApi }).Cookies)
  Object.defineProperty(window, "Cookies", {
    configurable: true,
    enumerable: true,
    get() {
      return cookiesApiValue
    },
    set(value: CookiesApi | undefined) {
      cookiesApiValue = wrapCookiesApi(value as CookiesApi)
    }
  })

  const sanitizeCallable = <T extends Function>(fn: T, kind: string): T => {
    if (!state.enabled) return fn

    const source = getFunctionSource(fn)
    if (!source || !SUSPICIOUS_SOURCE_RE.test(source)) return fn

    const stripped = sanitizeCodeString(source)

    try {
      const recreated = window.eval(`(${stripped})`)
      if (typeof recreated === "function") {
        return recreated as T
      }
    } catch {
      recordBlockedRedirect(`sanitize.${kind}`, "recreate_failed")
    }

    const noop = function () {
      recordBlockedRedirect(`blocked.${kind}`, source.slice(0, 160))
      return undefined
    }

    return noop as unknown as T
  }

  const sweepTimers = () => {
    for (let id = 1; id <= 10000; id += 1) {
      window.clearTimeout(id)
      window.clearInterval(id)
    }
  }

  const originalEval = window.eval
  window.eval = function (code: string) {
    if (typeof code === "string") code = sanitizeCodeString(code)
    return originalEval(code)
  }

  const OriginalFunction = window.Function
  const SafeFunction = function (...args: string[]) {
    if (args.length > 0) {
      const lastIndex = args.length - 1
      const last = args[lastIndex]
      if (typeof last === "string") {
        args[lastIndex] = sanitizeCodeString(last)
      }
    }

    return OriginalFunction.apply(this, args)
  } as unknown as FunctionConstructor
  SafeFunction.prototype = OriginalFunction.prototype
  Object.setPrototypeOf(SafeFunction, OriginalFunction)
  window.Function = SafeFunction

  const wrapTimer =
    <T extends typeof window.setTimeout | typeof window.setInterval>(
      original: T,
      kind: string
    ) =>
    (
      handler: TimerHandler,
      timeout?: number,
      ...args: Array<string | number | boolean | undefined | null>
    ) => {
      if (typeof handler === "string") {
        handler = sanitizeCodeString(handler)
      } else if (typeof handler === "function") {
        handler = sanitizeCallable(handler, kind)
      }
      return original(handler, timeout, ...args)
    }

  window.setTimeout = wrapTimer(window.setTimeout, "timeout")
  window.setInterval = wrapTimer(window.setInterval, "interval")

  const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) =>
    originalRequestAnimationFrame(sanitizeCallable(callback, "raf"))

  const originalQueueMicrotask = window.queueMicrotask.bind(window)
  window.queueMicrotask = (callback) =>
    originalQueueMicrotask(sanitizeCallable(callback, "microtask"))

  const originalAddEventListener = EventTarget.prototype.addEventListener
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener

  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) {
    if (!listener) {
      return originalAddEventListener.call(this, type, listener, options)
    }

    let wrapped: ListenerWrapper = listener
    if (typeof listener === "function") {
      wrapped = sanitizeCallable(listener, `listener.${type}`) as EventListener
    } else if (typeof listener.handleEvent === "function") {
      const safeHandleEvent = sanitizeCallable(
        listener.handleEvent,
        `listener.${type}.handleEvent`
      )
      wrapped = {
        handleEvent: safeHandleEvent
      }
    }

    wrappedListeners.set(listener as object, wrapped)
    return originalAddEventListener.call(this, type, wrapped, options)
  }

  EventTarget.prototype.removeEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) {
    const wrapped =
      listener && typeof listener === "object"
        ? wrappedListeners.get(listener)
        : listener && typeof listener === "function"
          ? wrappedListeners.get(listener)
          : undefined

    return originalRemoveEventListener.call(
      this,
      type,
      wrapped ?? listener,
      options
    )
  }

  const originalAppendChild = Node.prototype.appendChild
  Node.prototype.appendChild = function <T extends Node>(node: T): T {
    if (state.enabled && isBlockedScript(node)) {
      recordBlockedRedirect("script.append", node.src || node.textContent || "")
      return node
    }
    return originalAppendChild.call(this, node)
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(
    node: T,
    child: Node | null
  ): T {
    if (state.enabled && isBlockedScript(node)) {
      recordBlockedRedirect("script.insertBefore", node.src || node.textContent || "")
      return node
    }
    return originalInsertBefore.call(this, node, child)
  }

  const originalReplaceChild = Node.prototype.replaceChild
  Node.prototype.replaceChild = function <T extends Node>(
    node: T,
    child: Node
  ): Node {
    if (state.enabled && isBlockedScript(node)) {
      recordBlockedRedirect("script.replaceChild", node.src || node.textContent || "")
      return child
    }
    return originalReplaceChild.call(this, node, child)
  }

  const originalDocumentWrite = document.write.bind(document)
  document.write = (...args: string[]) => {
    const sanitized = args.map((arg) =>
      state.enabled ? sanitizeCodeString(arg) : arg
    )
    return originalDocumentWrite(...sanitized)
  }

  const originalCreateElement = Document.prototype.createElement
  Document.prototype.createElement = function (
    tagName: string,
    options?: ElementCreationOptions
  ): HTMLElement {
    const element = originalCreateElement.call(this, tagName, options)

    if (state.enabled && tagName.toLowerCase() === "script") {
      const script = element as HTMLScriptElement
      const textDescriptor =
        findPropertyDescriptor(script, "text") ??
        findPropertyDescriptor(HTMLScriptElement.prototype, "text")
      if (textDescriptor?.set && textDescriptor.configurable) {
        Object.defineProperty(script, "text", {
          ...textDescriptor,
          set(value: string) {
            textDescriptor.set?.call(script, sanitizeCodeString(value))
          }
        })
      }
    }

    return element
  }

  const scriptSrcDescriptor = findPropertyDescriptor(
    HTMLScriptElement.prototype,
    "src"
  )
  if (scriptSrcDescriptor?.set && scriptSrcDescriptor.configurable) {
    Object.defineProperty(HTMLScriptElement.prototype, "src", {
      ...scriptSrcDescriptor,
      set(value: string) {
        if (state.enabled && DEVTOOLS_URL_RE.test(value)) {
          recordBlockedRedirect("script.src", value)
          scriptSrcDescriptor.set?.call(this, "")
          return
        }
        scriptSrcDescriptor.set?.call(this, value)
      }
    })
  }

  const originalSetAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name: string, value: string) {
    if (
      state.enabled &&
      this instanceof HTMLScriptElement &&
      name.toLowerCase() === "src" &&
      DEVTOOLS_URL_RE.test(value)
    ) {
      recordBlockedRedirect("script.setAttribute", value)
      return
    }

    return originalSetAttribute.call(
      this,
      name,
      this instanceof HTMLScriptElement && name.toLowerCase() === "text"
        ? sanitizeCodeString(value)
        : value
    )
  }

  const guard = (kind: string, original: (...args: unknown[]) => unknown) => {
    return (...args: unknown[]) => {
      if (state.enabled) {
        const firstArg = args[0]
        recordBlockedRedirect(
          kind,
          typeof firstArg === "string" ? firstArg : undefined
        )
        return undefined
      }
      return original(...args)
    }
  }

  const locationProto = Object.getPrototypeOf(window.location) as {
    assign?: (url: string) => void
    replace?: (url: string) => void
    reload?: () => void
  }

  if (typeof locationProto.assign === "function") {
    locationProto.assign = guard("location.assign", locationProto.assign) as (
      url: string
    ) => void
  }
  if (typeof locationProto.replace === "function") {
    locationProto.replace = guard("location.replace", locationProto.replace) as (
      url: string
    ) => void
  }
  if (typeof locationProto.reload === "function") {
    locationProto.reload = guard("location.reload", locationProto.reload) as () => void
  }

  const hrefDescriptor = Object.getOwnPropertyDescriptor(locationProto, "href")
  if (hrefDescriptor?.set && hrefDescriptor.configurable) {
    Object.defineProperty(locationProto, "href", {
      ...hrefDescriptor,
      set(value: string) {
        if (state.enabled) {
          recordBlockedRedirect("location.href", value)
          return
        }
        hrefDescriptor.set?.call(window.location, value)
      }
    })
  }

  const hashDescriptor = Object.getOwnPropertyDescriptor(locationProto, "hash")
  if (hashDescriptor?.set && hashDescriptor.configurable) {
    Object.defineProperty(locationProto, "hash", {
      ...hashDescriptor,
      set(value: string) {
        if (state.enabled) {
          recordBlockedRedirect("location.hash", value)
          return
        }
        hashDescriptor.set?.call(window.location, value)
      }
    })
  }

  history.back = guard("history.back", history.back.bind(history)) as () => void
  history.forward = guard(
    "history.forward",
    history.forward.bind(history)
  ) as () => void
  history.go = guard("history.go", history.go.bind(history)) as (
    delta?: number
  ) => void
  history.pushState = guard(
    "history.pushState",
    history.pushState.bind(history)
  ) as typeof history.pushState
  history.replaceState = guard(
    "history.replaceState",
    history.replaceState.bind(history)
  ) as typeof history.replaceState

  const originalOpen = window.open.bind(window)
  window.open = guard("window.open", originalOpen) as typeof window.open

  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url

    if (state.enabled && DEVTOOLS_URL_RE.test(url)) {
      recordBlockedRedirect("fetch.devtools", url)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            version: 3,
            sources: [],
            mappings: "",
            names: [],
            sourcesContent: [],
            sourceRoot: "",
            file: ""
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        )
      )
    }

    return originalFetch(input, init)
  }) as typeof window.fetch

  sweepTimers()

  try {
    const currentCookies = cookieDescriptor?.get?.call(document) ?? ""
    if (DEVTOOLS_COOKIE_RE.test(currentCookies)) {
      cookieDescriptor?.set?.call(
        document,
        "DevTools=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/"
      )
    }
  } catch {
    // Ignore cookie clearing failures.
  }

  const api = {
    enable: () => {
      state.enabled = true
      sweepTimers()
      return api.getState()
    },
    disable: () => {
      state.enabled = false
      return api.getState()
    },
    getState: () => ({
      enabled: state.enabled,
      blockedRedirects: [...state.blockedRedirects]
    })
  }

  window.__synclifyDebugShield = api
}
