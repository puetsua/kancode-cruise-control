import { createCruiseControlPlugin, CRUISE_CONTROL } from "./index"

export { CRUISE_CONTROL }
export type { ClassifierLogger } from "./classifier"

/**
 * KanCode server plugin entry.
 *
 * A module must never export both `server` and `tui` — the host's plugin reader
 * rejects that. Keep any future TUI surface in a separate file.
 */
export default {
  id: "puetsua.cruise-control",
  server: createCruiseControlPlugin(),
}
