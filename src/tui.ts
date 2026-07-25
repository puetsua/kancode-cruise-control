import { CRUISE_CONTROL } from "./index.js"
import type { TuiPluginApi, TuiPluginModule } from "./host-tui.js"

export const COMMAND_ID = "permission.cruise_control.model"

type ConfigWithModules = {
  permission_modules?: Record<string, { model?: string }>
}

/** Reads the configured classifier model, or undefined when unset. */
export function currentModelRef(config: unknown): string | undefined {
  const modules = (config as ConfigWithModules | undefined)?.permission_modules
  return modules?.[CRUISE_CONTROL]?.model?.trim() || undefined
}

/** Splits `providerID/modelID`; the model id may itself contain slashes. */
export function splitModelRef(ref: string | undefined) {
  if (!ref) return undefined
  const at = ref.indexOf("/")
  if (at <= 0 || at === ref.length - 1) return undefined
  return { providerID: ref.slice(0, at), modelID: ref.slice(at + 1) }
}

/**
 * Registers `/cruise-control-model`.
 *
 * Ships with the plugin rather than the host so the command appears exactly when
 * the classifier it configures is installed. `DialogModel` comes from the host's
 * plugin UI API, so the picker is the same one the rest of KanCode uses.
 */
export const tui = async (api: TuiPluginApi) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: COMMAND_ID,
        title: "Cruise Control model",
        category: "Permission",
        namespace: "palette",
        slashName: "cruise-control-model",
        async run() {
          const response = await api.client.config.get()
          const config = (response as { data?: unknown })?.data ?? response
          const ref = currentModelRef(config)

          api.ui.toast({
            message: `Current Cruise Control model: ${ref ?? "unset"}`,
            variant: "info",
            duration: 2500,
          })

          api.ui.dialog.replace(() =>
            api.ui.DialogModel({
              title: "Cruise Control model",
              current: splitModelRef(ref),
              currentFallback: "unset",
              onSelect: async (providerID, modelID) => {
                const model = `${providerID}/${modelID}`
                try {
                  await api.client.global.config.update({
                    config: { permission_modules: { [CRUISE_CONTROL]: { model } } },
                  })
                  api.ui.toast({
                    message: `Cruise Control model set to ${model}`,
                    variant: "success",
                    duration: 3000,
                  })
                  api.ui.dialog.clear()
                } catch (error) {
                  api.ui.toast({
                    message: error instanceof Error ? error.message : "Failed to save Cruise Control model",
                    variant: "error",
                    duration: 4000,
                  })
                }
              },
            }),
          )
        },
      },
    ],
  })
}

/**
 * A module must never export both `server` and `tui` — the host's plugin reader
 * rejects that, which is why this lives in its own file.
 */
export default {
  id: "puetsua.cruise-control",
  tui,
} satisfies TuiPluginModule
