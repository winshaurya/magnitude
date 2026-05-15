import type { ImagePart } from "../prompt/parts"

export interface ModelCapabilities {
  readonly vision?: boolean
}

export interface ImagePlaceholderConfig {
  readonly enabled: boolean
  readonly format?: (part: ImagePart) => string
}
