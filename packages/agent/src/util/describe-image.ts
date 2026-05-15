/**
 * Image description module — preprocesses images for non-vision models.
 *
 * When a user drops/pastes an image, `startImageDescription` fires a background
 * call to the `util/image` provider endpoint (Qwen3-VL) and caches the promise.
 *
 * Before the model stream call, `resolveImageDescriptions` awaits any pending
 * descriptions and replaces ImageParts with TextParts in the prompt.
 *
 * Completely transparent to the user — no UI indicators needed.
 */

import { Prompt, type Message, type UserMessage, type ToolResultMessage, type ImagePart, type TextPart } from '@magnitudedev/ai'
import { isEnvFlagOn } from '@magnitudedev/magnitude-client'

// =============================================================================
// Constants
// =============================================================================

const VISION_MODEL_ID = 'util/image'

const DESCRIPTION_PROMPT = `You are an image description assistant for a coding AI agent. Describe this image in detail, focusing on:
- Any UI elements, buttons, layouts, or interface components (describe their appearance, position, and labels)
- Any text content visible in the image — include code, error messages, labels, terminal output, and values VERBATIM when possible
- Any diagrams, charts, architecture drawings, or visual structures
- Any error states, warnings, stack traces, or notable visual indicators
- Any file trees, directory listings, or code editor contents

Be specific and thorough. Prioritize information a developer would need to understand and act on what's shown.`

const FALLBACK_DESCRIPTION = 'Image was uploaded but could not be analyzed.'
const TIMEOUT_MS = 15_000

// =============================================================================
// Registry — stores in-flight description promises keyed by image data URL
//
// KEY CONTRACT: Both `startImageDescription` and `resolveImageDescriptions`
// construct the key as `data:${mediaType};base64,${base64}`. They MUST use
// the same scaled image data (from autoScaleImageAttachmentIfNeeded) —
// the chat-controller ensures this by scaling before calling startImageDescription
// and before storing the ImagePart. If scaling ever becomes non-deterministic,
// keys could mismatch and trigger duplicate API calls.
// =============================================================================

const descriptionRegistry = new Map<string, Promise<string>>()

// =============================================================================
// Provider config — received from the agent runtime at startup
//
// This module does NOT read env vars directly. The coding-agent calls
// configure() with the resolved endpoint/apiKey from MagnitudeClient,
// avoiding duplication and ensuring consistency.
// =============================================================================

let configuredEndpoint: string | null = null
let configuredApiKey: string | null = null

/**
 * Configure the module with the provider endpoint and API key.
 * Called once at agent startup from createCodingAgentClient().
 * If not called, falls back to MagnitudeClient-style env var resolution
 * (using the canonical isEnvFlagOn from @magnitudedev/magnitude-client).
 */
export function configure(config: { readonly endpoint: string; readonly apiKey: string }): void {
  configuredEndpoint = config.endpoint
  configuredApiKey = config.apiKey
}

function getProviderEndpoint(): string {
  if (configuredEndpoint) return configuredEndpoint
  // Fallback: same resolution as MagnitudeClient
  const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)
  return useLocal
    ? 'http://localhost:3000/api/v1'
    : 'https://app.magnitude.dev/api/v1'
}

function getApiKey(): string | null {
  if (configuredApiKey) return configuredApiKey
  // Fallback: same resolution as MagnitudeClient
  const useLocal = isEnvFlagOn(process.env.MAGNITUDE_USE_LOCAL)
  return useLocal
    ? (process.env.MAGNITUDE_LOCAL_API_KEY ?? process.env.MAGNITUDE_API_KEY ?? null)
    : (process.env.MAGNITUDE_API_KEY ?? null)
}

// =============================================================================
// Internal: describe image via fetch() to util/image endpoint
// =============================================================================

/**
 * Call the util/image provider endpoint using plain fetch().
 * Returns the description text.
 */
async function describeImageViaFetch(imageDataUrl: string): Promise<string> {
  const endpoint = getProviderEndpoint()
  const apiKey = getApiKey()

  if (!apiKey) {
    return FALLBACK_DESCRIPTION
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL_ID,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DESCRIPTION_PROMPT },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      console.error(`[describe-image] Vision API returned ${response.status}`)
      return FALLBACK_DESCRIPTION
    }

    const data = await response.json()
    const text = data?.choices?.[0]?.message?.content
    if (typeof text === 'string' && text.trim().length > 0) {
      return text.trim()
    }

    console.error('[describe-image] Vision API returned empty content')
    return FALLBACK_DESCRIPTION
  } catch (err) {
    // Timeout, network error, etc. — graceful fallback
    console.error('[describe-image] Vision API call failed:', err instanceof Error ? err.message : String(err))
    return FALLBACK_DESCRIPTION
  } finally {
    clearTimeout(timeoutId)
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start an image description in the background and cache the promise.
 * Call this as soon as an image is uploaded/pasted.
 * If a description is already in-flight for this image, this is a no-op.
 *
 * Uses plain fetch() — works from any context (sync TUI handlers, React, etc.)
 * The promise resolves when the description is ready.
 */
export function startImageDescription(imageDataUrl: string): void {
  if (descriptionRegistry.has(imageDataUrl)) return

  const promise = describeImageViaFetch(imageDataUrl)
  descriptionRegistry.set(imageDataUrl, promise)
}

/**
 * Cancel an in-flight image description and remove it from the registry.
 * Call this when an image attachment is removed by the user.
 */
export function cancelImageDescription(imageDataUrl: string): void {
  descriptionRegistry.delete(imageDataUrl)
}

/**
 * Resolve all ImageParts in a prompt using cached descriptions from the registry.
 * Replaces each ImagePart with a TextPart containing the description.
 *
 * This should be called before `harness.runTurn(prompt)` — it awaits any
 * pending description promises and injects the results as text.
 *
 * If a description hasn't been started yet (no `startImageDescription` call),
 * it falls back to the generic placeholder.
 */
export async function resolveImageDescriptions(prompt: Prompt): Promise<Prompt> {
  let changed = false

  const messages: Message[] = []

  for (const msg of prompt.messages) {
    switch (msg._tag) {
      case 'UserMessage': {
        const parts = await resolveParts(msg.parts)
        if (parts !== msg.parts) {
          changed = true
          messages.push({ ...msg, parts } as UserMessage)
        } else {
          messages.push(msg)
        }
        break
      }
      case 'ToolResultMessage': {
        const parts = await resolveParts(msg.parts)
        if (parts !== msg.parts) {
          changed = true
          messages.push({ ...msg, parts } as ToolResultMessage)
        } else {
          messages.push(msg)
        }
        break
      }
      case 'AssistantMessage': {
        messages.push(msg)
        break
      }
    }
  }

  if (!changed) return prompt

  return Prompt.from({
    system: prompt.system,
    messages: messages as any,
  })
}

/**
 * Resolve image parts in a parts array — await cached descriptions
 * and replace ImageParts with TextParts.
 *
 * Collects all description promises first, then awaits them concurrently
 * via Promise.all for better performance when multiple images are present.
 */
async function resolveParts(
  parts: readonly (TextPart | ImagePart)[],
): Promise<readonly (TextPart | ImagePart)[]> {
  // First pass: collect all image indices and their description promises
  const imageIndices: number[] = []
  const pendingDescriptions: Promise<string>[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part._tag === 'ImagePart') {
      imageIndices.push(i)
      const imageDataUrl = `data:${part.mediaType};base64,${part.data}`
      let descriptionPromise = descriptionRegistry.get(imageDataUrl)

      if (!descriptionPromise) {
        // No prior start call — start one now
        // This handles edge cases like images in tool results
        descriptionPromise = describeImageViaFetch(imageDataUrl)
        descriptionRegistry.set(imageDataUrl, descriptionPromise)
      }

      pendingDescriptions.push(descriptionPromise)
    }
  }

  // No images to resolve — return parts unchanged
  if (imageIndices.length === 0) {
    return parts
  }

  // Await all descriptions concurrently
  const descriptions = await Promise.all(pendingDescriptions)

  // Build result array, replacing ImageParts with TextParts
  const result: (TextPart | ImagePart)[] = [...parts]
  for (let idx = 0; idx < imageIndices.length; idx++) {
    const i = imageIndices[idx]
    const part = parts[i] as ImagePart
    const description = descriptions[idx]
    const imageDataUrl = `data:${part.mediaType};base64,${part.data}`

    // Clean up the registry entry after consumption
    descriptionRegistry.delete(imageDataUrl)

    result[i] = {
      _tag: 'TextPart',
      text: `[User uploaded an image. Description: ${description}]`,
    }
  }

  return result
}
