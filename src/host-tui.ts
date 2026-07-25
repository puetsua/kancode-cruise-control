/**
 * TUI host contract, mirrored from `@kancode/plugin/tui`.
 *
 * Narrowed to exactly what this plugin uses. Mirroring rather than importing
 * keeps the package free of `@opentui/*` peer dependencies — the real
 * `TuiPluginApi` is typed against OpenTUI's `Keymap`, `Renderable`, and JSX
 * types, none of which this command needs.
 *
 * `JSX.Element` is modelled as `unknown` for the same reason: the plugin never
 * constructs elements itself. It calls `api.ui.DialogModel(...)` — a function
 * the host supplies — and hands the result straight back to `dialog.replace`.
 * That is also why this file has no JSX and the package needs no JSX runtime.
 *
 * Keep in sync with `packages/plugin/src/tui.ts` in puetsua/kancode.
 */

export type TuiToast = {
  variant?: "info" | "success" | "warning" | "error"
  title?: string
  message: string
  duration?: number
}

export type TuiDialogModelProps = {
  providerID?: string
  title?: string
  current?: { providerID: string; modelID: string }
  currentFallback?: string
  onSelect?: (providerID: string, modelID: string) => void | Promise<void>
}

export type TuiDialogStack = {
  replace: (render: () => unknown, onClose?: () => void) => void
  clear: () => void
}

export type TuiKeymapCommand = {
  name: string
  title?: string
  category?: string
  /** `"palette"` surfaces the command in the host command palette. */
  namespace?: string
  slashName?: string
  slashAliases?: string[]
  desc?: string
  run: () => void | Promise<void>
}

export type TuiPluginApi = {
  keymap: {
    registerLayer: (layer: {
      commands?: TuiKeymapCommand[]
      bindings?: { key: string; cmd: string; desc?: string }[]
    }) => unknown
  }
  ui: {
    DialogModel: (props: TuiDialogModelProps) => unknown
    dialog: TuiDialogStack
    toast: (input: TuiToast) => void
  }
  client: {
    config: { get: () => Promise<unknown> }
    global: { config: { update: (input: { config: unknown }) => Promise<unknown> } }
  }
}

export type TuiPluginModule = {
  id?: string
  tui: (api: TuiPluginApi) => Promise<void>
  server?: never
}
