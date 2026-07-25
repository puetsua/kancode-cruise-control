import { describe, expect, test } from "bun:test"
import { execFileSync } from "child_process"
import { readFileSync } from "fs"
import path from "path"
import { pathToFileURL } from "url"

const ROOT = path.join(import.meta.dir, "..")
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"))

describe("published package shape", () => {
  test("has no runtime dependencies", () => {
    expect(pkg.dependencies ?? {}).toEqual({})
    expect(pkg.peerDependencies ?? {}).toEqual({})
  })

  test("files allowlist covers every exported path", () => {
    const entries = pkg.exports as Record<string, string | Record<string, string>>
    const targets = Object.values(entries).flatMap((entry) =>
      typeof entry === "string" ? [entry] : Object.values(entry),
    )
    expect(targets.length).toBeGreaterThan(0)
    for (const target of targets) {
      // npm always ships package.json regardless of `files`; everything else must
      // live under the allowlisted dist/ or it is exported but not published.
      if (target === "./package.json") continue
      expect(target.startsWith("./dist/")).toBe(true)
    }
    expect(pkg.files).toEqual(["dist"])
  })

  /**
   * The host `import()`s the built entrypoint. `moduleResolution: "bundler"`
   * emitted extensionless relative specifiers, which Bun tolerates and Node
   * rejects with ERR_MODULE_NOT_FOUND — a break that only appears after publish.
   */
  test("built output is importable by Node ESM", () => {
    // Absolute paths must be file:// URLs for dynamic import on Windows.
    const entry = pathToFileURL(path.join(ROOT, "dist", "server.js")).href
    const script = `import(${JSON.stringify(entry)})
      .then((m) => { if (typeof m.default?.server !== "function") { console.error("bad shape"); process.exit(1) } })
      .catch((error) => { console.error(error.code ?? error.message); process.exit(1) })`
    execFileSync("node", ["--input-type=module", "-e", script], { cwd: ROOT, stdio: "pipe" })
  })

  test("entry exports server without tui", async () => {
    const mod = (await import("../src/server")).default
    expect(mod.id).toBe("puetsua.cruise-control")
    expect(typeof mod.server).toBe("function")
    // readV1Plugin rejects a module exporting both.
    expect("tui" in mod).toBe(false)
  })
})
