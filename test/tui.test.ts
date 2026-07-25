import { describe, expect, test } from "bun:test"
import entry, { COMMAND_ID, currentModelRef, splitModelRef, tui } from "../src/tui"
import type { TuiDialogModelProps, TuiPluginApi, TuiToast } from "../src/host-tui"

describe("model ref helpers", () => {
  test("reads the configured model", () => {
    expect(currentModelRef({ permission_modules: { cruise_control: { model: "opencode/x" } } })).toBe("opencode/x")
  })

  test("treats blank and missing as unset", () => {
    expect(currentModelRef({ permission_modules: { cruise_control: { model: "   " } } })).toBeUndefined()
    expect(currentModelRef({ permission_modules: {} })).toBeUndefined()
    expect(currentModelRef(undefined)).toBeUndefined()
  })

  test("splits on the first slash so model ids may contain slashes", () => {
    expect(splitModelRef("opencode/deepseek-v4-flash")).toEqual({
      providerID: "opencode",
      modelID: "deepseek-v4-flash",
    })
    expect(splitModelRef("ollama-cloud/org/model")).toEqual({ providerID: "ollama-cloud", modelID: "org/model" })
  })

  test("rejects refs with no usable split", () => {
    expect(splitModelRef(undefined)).toBeUndefined()
    expect(splitModelRef("bare")).toBeUndefined()
    expect(splitModelRef("/leading")).toBeUndefined()
    expect(splitModelRef("trailing/")).toBeUndefined()
  })
})

function fakeApi(config: unknown) {
  const toasts: TuiToast[] = []
  const updates: unknown[] = []
  let dialogProps: TuiDialogModelProps | undefined
  let cleared = false
  const commands: { name: string; slashName?: string; run: () => void | Promise<void> }[] = []

  const api = {
    keymap: {
      registerLayer: (layer: { commands?: typeof commands }) => {
        commands.push(...(layer.commands ?? []))
        return () => {}
      },
    },
    ui: {
      DialogModel: (props: TuiDialogModelProps) => {
        dialogProps = props
        return { kind: "dialog-model" }
      },
      dialog: {
        replace: (render: () => unknown) => {
          render()
        },
        clear: () => {
          cleared = true
        },
      },
      toast: (input: TuiToast) => {
        toasts.push(input)
      },
    },
    client: {
      config: { get: async () => ({ data: config }) },
      global: {
        config: {
          update: async (input: { config: unknown }) => {
            updates.push(input.config)
            return {}
          },
        },
      },
    },
  } as unknown as TuiPluginApi

  return { api, toasts, updates, commands, get dialogProps() { return dialogProps }, get cleared() { return cleared } }
}

describe("/cruise-control-model", () => {
  test("module exports tui without server", () => {
    expect(entry.id).toBe("puetsua.cruise-control")
    expect(typeof entry.tui).toBe("function")
    // readV1Plugin rejects a module exporting both.
    expect("server" in entry).toBe(false)
  })

  test("registers a palette command with the slash name", async () => {
    const harness = fakeApi({})
    await tui(harness.api)
    expect(harness.commands).toHaveLength(1)
    expect(harness.commands[0]!.name).toBe(COMMAND_ID)
    expect(harness.commands[0]!.slashName).toBe("cruise-control-model")
  })

  test("opens the picker seeded with the configured model", async () => {
    const harness = fakeApi({ permission_modules: { cruise_control: { model: "opencode/deepseek-v4-flash" } } })
    await tui(harness.api)
    await harness.commands[0]!.run()
    expect(harness.dialogProps?.current).toEqual({ providerID: "opencode", modelID: "deepseek-v4-flash" })
    expect(harness.toasts[0]?.message).toContain("opencode/deepseek-v4-flash")
  })

  test("reports an unset model rather than a blank picker title", async () => {
    const harness = fakeApi({})
    await tui(harness.api)
    await harness.commands[0]!.run()
    expect(harness.dialogProps?.current).toBeUndefined()
    expect(harness.dialogProps?.currentFallback).toBe("unset")
    expect(harness.toasts[0]?.message).toContain("unset")
  })

  test("selecting a model patches only the cruise_control model", async () => {
    const harness = fakeApi({})
    await tui(harness.api)
    await harness.commands[0]!.run()
    await harness.dialogProps?.onSelect?.("ollama-cloud", "kimi-k2.7-code")
    expect(harness.updates).toEqual([
      { permission_modules: { cruise_control: { model: "ollama-cloud/kimi-k2.7-code" } } },
    ])
    expect(harness.cleared).toBe(true)
    expect(harness.toasts.at(-1)?.variant).toBe("success")
  })

  test("a failed save surfaces an error and keeps the dialog open", async () => {
    const harness = fakeApi({})
    ;(harness.api.client.global.config as { update: unknown }).update = async () => {
      throw new Error("disk full")
    }
    await tui(harness.api)
    await harness.commands[0]!.run()
    await harness.dialogProps?.onSelect?.("opencode", "x")
    expect(harness.toasts.at(-1)).toMatchObject({ variant: "error", message: "disk full" })
    expect(harness.cleared).toBe(false)
  })
})
