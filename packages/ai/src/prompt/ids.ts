import { init } from "@paralleldrive/cuid2"

export type ToolCallId = string & { readonly __brand: "ToolCallId" }
export type ProviderToolCallId = string & { readonly __brand: "ProviderToolCallId" }

/** Default generator — produces a fresh cuid2 (8 chars). Callable as `() => ToolCallId`. */
export const createToolCallId = (() => {
  const fn = init({ length: 8 })
  return (): ToolCallId => fn() as ToolCallId
})()
