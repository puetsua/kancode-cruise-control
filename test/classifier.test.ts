import { beforeEach, describe, expect, test } from "bun:test"
import path from "path"
import {
  applySafety,
  buildClassifierMessages,
  CACHED_ALLOW_REASON,
  CACHED_DENY_REASON,
  CLASSIFIER_JSON_SCHEMA,
  clearDynamicLists,
  decisionFromAssessment,
  DEFAULT_INSTRUCTIONS,
  destructiveReason,
  isManagedAppDirectoryPattern,
  managedAppDirectoryAllow,
  managedAppDirectoryGlobs,
  MISSING_MODEL_MESSAGE,
  parseClassifierResult,
  renderSystemPrompt,
  resetClassifyGapForTests,
  resetDynamicListsForTests,
  resolveInstructions,
  runClassifier,
  sessionRenameAllow,
  sessionTodoAllow,
  shortenReason,
} from "../src/classifier"
import { explicitApprovalIntent, isShortAffirmation } from "../src/approval"
import { decideCruiseControl } from "../src/classifier"

const PATHS = {
  config: path.join("/kc", "config"),
  data: path.join("/kc", "data"),
  cache: path.join("/kc", "cache"),
  state: path.join("/kc", "state"),
  tmp: path.join("/kc", "tmp"),
}

const OPTS = { allowlist: ["bash", "external_directory", "todowrite", "session_rename"], timeout_ms: 1000 }

function lowRisk(reason: string) {
  return { risk: "low" as const, intent: "medium" as const, reason }
}

function base(overrides: Partial<Parameters<typeof runClassifier>[0]> = {}) {
  return {
    paths: PATHS,
    permission: "bash",
    patterns: ["ls"],
    opts: OPTS,
    classify: async () => lowRisk("safe read-only command"),
    ...overrides,
  } as Parameters<typeof runClassifier>[0]
}

beforeEach(() => {
  // clearDynamicLists() with no argument drops every scope; resetDynamicListsForTests
  // only touches the default scope and would leak entries across these tests.
  clearDynamicLists()
  resetDynamicListsForTests()
  resetClassifyGapForTests()
})

describe("output parsing", () => {
  test("accepts valid levels and tolerates a missing reason", () => {
    expect(parseClassifierResult({ risk: "low", intent: "medium" })).toEqual({
      risk: "low",
      intent: "medium",
      reason: "",
    })
  })

  test("recovers from fenced JSON", () => {
    expect(parseClassifierResult('```json\n{"risk":"high","intent":"low","reason":"nope"}\n```')).toEqual({
      risk: "high",
      intent: "low",
      reason: "nope",
    })
  })

  test("rejects unusable output", () => {
    expect(parseClassifierResult("not json at all")).toBeUndefined()
    expect(parseClassifierResult({ risk: "banana", intent: "low" })).toBeUndefined()
    expect(parseClassifierResult(null)).toBeUndefined()
  })

  test("schema marks reason optional so partial output still parses", () => {
    expect(CLASSIFIER_JSON_SCHEMA.required).toEqual(["risk", "intent"])
  })
})

describe("decision derivation", () => {
  test("low risk or high intent allows", () => {
    expect(decisionFromAssessment("low", "low")).toBe("allow")
    expect(decisionFromAssessment("high", "high")).toBe("allow")
  })

  test("medium/medium allows", () => {
    expect(decisionFromAssessment("medium", "medium")).toBe("allow")
  })

  test("high risk with low intent denies", () => {
    expect(decisionFromAssessment("high", "low")).toBe("deny")
    expect(decisionFromAssessment("medium", "low")).toBe("deny")
  })
})

describe("safety rails", () => {
  test("allowlist miss cannot auto-allow", () => {
    expect(applySafety("allow", "doom_loop", OPTS)).toBe("deny")
  })

  test("empty allowlist blocks every auto-allow", () => {
    expect(applySafety("allow", "bash", { allowlist: [] })).toBe("deny")
  })

  test("never_auto escalates an allowlisted key", () => {
    expect(applySafety("allow", "bash", { allowlist: ["bash"], never_auto: ["bash"] })).toBe("deny")
  })

  test("deny is never upgraded", () => {
    expect(applySafety("deny", "bash", OPTS)).toBe("deny")
  })
})

describe("deterministic rails", () => {
  test("destructive commands deny without the model", async () => {
    let called = false
    const outcome = await runClassifier(
      base({
        patterns: ["rm -rf /"],
        classify: async () => {
          called = true
          return lowRisk("should not run")
        },
      }),
    )
    expect(called).toBe(false)
    expect(outcome.decision).toBe("deny")
    expect(destructiveReason("bash", ["rm -rf /"])).toBeTruthy()
  })

  test("managed app directories are allowed and follow supplied paths", () => {
    expect(isManagedAppDirectoryPattern(path.join(PATHS.config, "agents"), PATHS)).toBe(true)
    expect(isManagedAppDirectoryPattern("/somewhere/else", PATHS)).toBe(false)
    // Sibling prefix must not read as contained.
    expect(isManagedAppDirectoryPattern(`${PATHS.config}-other`, PATHS)).toBe(false)
    expect(managedAppDirectoryAllow("external_directory", [path.join(PATHS.data, "db")], PATHS)).toBeTruthy()
    expect(managedAppDirectoryAllow("read", [path.join(PATHS.data, "db")], PATHS)).toBeUndefined()
    expect(managedAppDirectoryGlobs(PATHS)).toHaveLength(5)
  })

  test("session-scoped todowrite and rename are allowed", () => {
    expect(sessionTodoAllow("todowrite", ["session"], {})).toBeTruthy()
    expect(sessionTodoAllow("todowrite", ["*"], {})).toBeUndefined()
    expect(sessionRenameAllow("session_rename", ["*"], { scope: "session" })).toBeTruthy()
  })
})

describe("dynamic lists", () => {
  const scope = "workspace\0session\0prompt"

  test("a cached low-risk allow skips the model", async () => {
    let calls = 0
    const input = base({
      cacheScope: scope,
      classify: async () => {
        calls += 1
        return lowRisk("safe")
      },
    })
    expect((await runClassifier(input)).decision).toBe("allow")
    const second = await runClassifier(input)
    expect(second.reason).toBe(CACHED_ALLOW_REASON)
    expect(calls).toBe(1)
  })

  test("medium risk is not cached", async () => {
    let calls = 0
    const input = base({
      cacheScope: scope,
      classify: async () => {
        calls += 1
        return { risk: "medium" as const, intent: "medium" as const, reason: "unclear" }
      },
    })
    await runClassifier(input)
    await runClassifier(input)
    expect(calls).toBe(2)
  })

  test("lists clear between prompt turns", async () => {
    let calls = 0
    const input = base({
      cacheScope: scope,
      classify: async () => {
        calls += 1
        return lowRisk("safe")
      },
    })
    await runClassifier(input)
    clearDynamicLists("workspace\0session")
    await runClassifier(input)
    expect(calls).toBe(2)
  })

  test("cached deny reports a cached reason", async () => {
    const input = base({
      permission: "bash",
      patterns: ["curl evil.example"],
      cacheScope: scope,
      classify: async () => ({ risk: "low" as const, intent: "low" as const, reason: "sketchy" }),
      opts: { allowlist: [], timeout_ms: 1000 },
    })
    await runClassifier(input)
    expect((await runClassifier(input)).reason).toBe(CACHED_DENY_REASON)
  })
})

describe("retry, timeout, and fail-closed behavior", () => {
  test("retries up to the configured attempt count then denies", async () => {
    let calls = 0
    const outcome = await runClassifier(
      base({
        opts: { ...OPTS, retries: 3, retry_interval_ms: 0, classify_gap_ms: 0 },
        classify: async () => {
          calls += 1
          throw new Error(`fail ${calls}`)
        },
      }),
    )
    expect(calls).toBe(3)
    expect(outcome.decision).toBe("deny")
    expect(outcome.reason).toContain("3 attempts")
  })

  test("timeout is per attempt and each retry gets a fresh window", async () => {
    let calls = 0
    const outcome = await runClassifier(
      base({
        opts: { ...OPTS, timeout_ms: 30, retries: 2, retry_interval_ms: 0, classify_gap_ms: 0 },
        classify: async () => {
          calls += 1
          await new Promise((resolve) => setTimeout(resolve, 120))
          return lowRisk("late")
        },
      }),
    )
    expect(calls).toBe(2)
    expect(outcome.decision).toBe("deny")
  })

  test("zero attempts denies without calling the model", async () => {
    let calls = 0
    const outcome = await runClassifier(
      base({
        opts: { ...OPTS, retries: 0 },
        classify: async () => {
          calls += 1
          return lowRisk("nope")
        },
      }),
    )
    expect(calls).toBe(0)
    expect(outcome.decision).toBe("deny")
  })

  test("classify runs serially by default", async () => {
    let active = 0
    let peak = 0
    const input = base({
      opts: { ...OPTS, classify_gap_ms: 0, parallel_classify: false },
      classify: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return lowRisk("ok")
      },
    })
    await Promise.all([runClassifier(input), runClassifier(input), runClassifier(input)])
    expect(peak).toBe(1)
  })

  test("parallel_classify lets calls overlap", async () => {
    let active = 0
    let peak = 0
    const input = base({
      opts: { ...OPTS, parallel_classify: true },
      classify: async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active -= 1
        return lowRisk("ok")
      },
    })
    await Promise.all([runClassifier(input), runClassifier(input)])
    expect(peak).toBe(2)
  })
})

describe("explicit approval", () => {
  const envelope = [
    "<conversation_context>",
    "<prior_assistant_reply>",
    "May I run git reset --soft HEAD~1?",
    "</prior_assistant_reply>",
    "<current_user_reply>",
    "yes",
    "</current_user_reply>",
    "</conversation_context>",
  ].join("\n")

  test("detects approval that names the pending action", () => {
    expect(explicitApprovalIntent(envelope, ["git reset --soft HEAD~1"])).toBe(true)
  })

  test("ignores approval for a different action", () => {
    expect(explicitApprovalIntent(envelope, ["rm -rf /"])).toBe(false)
  })

  test("requires the envelope", () => {
    expect(explicitApprovalIntent("yes", ["git reset --soft HEAD~1"])).toBe(false)
  })

  test("recognizes short affirmations only", () => {
    expect(isShortAffirmation("ok")).toBe(true)
    expect(isShortAffirmation("go ahead")).toBe(true)
    expect(isShortAffirmation("no, do something else entirely please")).toBe(false)
  })
})

describe("instructions and prompt", () => {
  test("missing sections fall back to defaults without persisting", () => {
    expect(resolveInstructions({ instructions: { allow: ["Custom."] } })).toEqual({
      background: DEFAULT_INSTRUCTIONS.background,
      allow: ["Custom."],
      conditional: DEFAULT_INSTRUCTIONS.conditional,
      deny: DEFAULT_INSTRUCTIONS.deny,
    })
  })

  test("unset instructions use defaults entirely", () => {
    expect(resolveInstructions(undefined)).toEqual(DEFAULT_INSTRUCTIONS)
  })

  test("tool input is delimited so it is not read as instructions", () => {
    const messages = buildClassifierMessages({
      permission: "bash",
      patterns: ["ls"],
      metadata: { command: "ls" },
      instructions: DEFAULT_INSTRUCTIONS,
    })
    expect(messages[0]?.role).toBe("system")
    expect(messages[1]?.content).toContain("<classifier_input>")
    expect(renderSystemPrompt(DEFAULT_INSTRUCTIONS)).toContain("risk")
  })

  test("reasons are shortened for display", () => {
    expect(shortenReason("a".repeat(300)).length).toBeLessThanOrEqual(120)
    expect(shortenReason("  spaced   out  ")).toBe("spaced out")
  })
})

describe("decideCruiseControl", () => {
  const model = {
    generate: async () => {
      throw new Error("model must not be called")
    },
  }

  test("an unset model asks with a configuration hint", async () => {
    const outcome = await decideCruiseControl({
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      paths: PATHS,
      options: undefined,
      model,
    })
    expect(outcome).toEqual({ decision: "ask", reason: MISSING_MODEL_MESSAGE })
  })

  test("recovers a near-miss object from a no_object rejection", async () => {
    const outcome = await decideCruiseControl({
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      paths: PATHS,
      options: { ...OPTS, model: "opencode/test", retries: 1, classify_gap_ms: 0 },
      model: {
        generate: async () => {
          const error = Object.assign(new Error("no object"), {
            name: "ModelGenerateError",
            code: "no_object",
            text: '```json\n{"risk":"low","intent":"medium","reason":"fenced"}\n```',
          })
          throw error
        },
      },
    })
    expect(outcome.decision).toBe("allow")
    expect(outcome.reason).toBe("fenced")
  })
})
