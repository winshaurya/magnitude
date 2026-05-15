import type { ToolDefinition, ValidationIssue } from "@magnitudedev/ai"
import type { Schema } from "effect"
import { Data, type Effect } from "effect"
import type { StreamingPartial } from "@magnitudedev/ai"

// --- StreamValidationError ---

export class StreamValidationError extends Data.TaggedError("StreamValidationError")<{
  readonly message: string
}> {}

// --- ToolContext ---

export interface ToolContext<TEmission = never> {
  readonly emit: [TEmission] extends [never]
    ? never
    : (emission: TEmission) => Effect.Effect<void>
}

// --- StreamHook ---

export interface StreamHook<TInput, TEmission, TStreamState, R = never> {
  readonly initial: TStreamState
  readonly onInput: (
    input: StreamingPartial<TInput>,
    state: TStreamState,
    ctx: ToolContext<TEmission>
  ) => Effect.Effect<TStreamState, StreamValidationError, R>
}

// --- HarnessTool (split into erased and concrete) ---

export interface HarnessToolErased {
  readonly definition: ToolDefinition
  readonly execute: (input: any, ctx: any) => Effect.Effect<any, any, any>
  readonly stream?: StreamHook<any, any, any, any>
  readonly emissionSchema?: Schema.Schema<any, any, any> | undefined
  readonly errorSchema?: Schema.Schema<any, any, any> | undefined
}

export interface HarnessToolConcrete<
  TInput,
  TOutput,
  TEmission,
  E,
  R,
  TStreamState = unknown,
> {
  readonly definition: ToolDefinition<TInput, TOutput>
  readonly execute: (input: TInput, ctx: ToolContext<TEmission>) => Effect.Effect<TOutput, E, R>
  readonly stream?: StreamHook<TInput, TEmission, TStreamState, R>
  readonly emissionSchema?: [TEmission] extends [never] ? undefined : Schema.Schema<TEmission, any, never>
  readonly errorSchema?: [E] extends [never] ? undefined : Schema.Schema<E, any, never>
}

export type HarnessTool<
  TInput = never,
  TOutput = never,
  TEmission = never,
  E = never,
  R = never,
> = [TInput] extends [never]
  ? HarnessToolErased
  : HarnessToolConcrete<TInput, TOutput, TEmission, E, R>

// Note: HarnessToolConcrete is NOT structurally assignable to HarnessToolErased due to
// function parameter contravariance (ToolContext<TEmission> vs unknown for ctx).
// The erased form is only constructed via defineHarnessTool, which handles the boundary.

// --- defineHarnessTool ---

interface DefineHarnessToolConfig<TInput, TOutput, TEmission, E, R, TStreamState = unknown> {
  readonly definition: ToolDefinition<TInput, TOutput>
  readonly execute: (input: TInput, ctx: ToolContext<TEmission>) => Effect.Effect<TOutput, E, R>
  readonly stream?: StreamHook<TInput, TEmission, TStreamState, R>
  readonly emissionSchema?: [TEmission] extends [never] ? undefined : Schema.Schema<TEmission, any, never>
  readonly errorSchema?: [E] extends [never] ? undefined : Schema.Schema<E, any, never>
}

export function defineHarnessTool<
  TInput,
  TOutput,
  TEmission = never,
  E = never,
  R = never,
  TStreamState = unknown,
>(
  config: DefineHarnessToolConfig<TInput, TOutput, TEmission, E, R, TStreamState>
): HarnessToolConcrete<TInput, TOutput, TEmission, E, R, TStreamState> {
  return {
    definition: config.definition,
    execute: config.execute,
    stream: config.stream,
    emissionSchema: config.emissionSchema,
    errorSchema: config.errorSchema,
  }
}
