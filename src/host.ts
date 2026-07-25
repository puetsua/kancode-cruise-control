/**
 * Host contract, mirrored from `@kancode/plugin`.
 *
 * Declared locally rather than imported so this package has **zero runtime and
 * zero install-time dependencies** — it can be installed and built even though
 * `@kancode/plugin` is not currently published to npm. Every symbol here is a
 * type; nothing is emitted.
 *
 * Keep in sync with `packages/plugin/src/index.ts` in puetsua/kancode. The
 * `engines.opencode` range in package.json is what actually gates compatibility:
 * bump it whenever this contract changes shape.
 */

export type ModelMessage = {
  role: "system" | "user" | "assistant"
  content: string
}

export type ModelGenerateInput = {
  model: string
  messages: readonly ModelMessage[]
  schema: Record<string, unknown>
  schemaName?: string
  schemaDescription?: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  abortSignal?: AbortSignal
}

export type ModelGenerateResult<T = unknown> = {
  object: T
  model: { providerID: string; modelID: string }
  usage?: { input?: number; output?: number; total?: number }
}

export type ModelCapability = {
  generate<T = unknown>(input: ModelGenerateInput): Promise<ModelGenerateResult<T>>
}

export type PluginPaths = {
  readonly config: string
  readonly data: string
  readonly cache: string
  readonly state: string
  readonly tmp: string
}

export type PermissionModuleDecision =
  | "allow"
  | "deny"
  | "ask"
  | { decision: "allow" | "deny" | "ask"; reason?: string; metadata?: Record<string, unknown> }

export type PermissionModuleDecideInput = {
  permission: string
  patterns: readonly string[]
  metadata: Record<string, unknown>
  userPrompt?: string
  sessionContext?: readonly unknown[]
  approvalPrompt?: string
  cacheScope?: string
}

export type PermissionModuleRegistration = {
  id: string
  decide: (input: PermissionModuleDecideInput) => Promise<PermissionModuleDecision>
}

/** Only the members this plugin actually uses. */
export type PluginInput = {
  client: { config: { get: () => Promise<unknown> } }
  directory: string
  paths: PluginPaths
  model: ModelCapability
  permission: { registerModule(module: PermissionModuleRegistration): void }
}

export type Hooks = {
  "chat.message"?: (input: { sessionID: string }, output?: unknown) => Promise<void>
}

export type Plugin = (input: PluginInput) => Promise<Hooks>

/**
 * Shape the host's `readV1Plugin` validates. A module must export `server` OR
 * `tui`, never both. Mirrored so `server.ts` can `satisfies` it and a contract
 * change becomes a build failure rather than a load failure after publish.
 */
export type PluginModule = {
  id?: string
  server: Plugin
  tui?: never
}

/** Non-retryable codes; the caller must not retry these. */
export type ModelErrorCode =
  | "model_unset"
  | "model_not_found"
  | "auth"
  | "timeout"
  | "aborted"
  | "no_object"
  | "rate_limit"
  | "provider_error"
  | "budget"
  | "unavailable"

export interface ModelGenerateError extends Error {
  readonly name: "ModelGenerateError"
  readonly code: ModelErrorCode
  readonly retryable: boolean
  readonly text?: string
}
