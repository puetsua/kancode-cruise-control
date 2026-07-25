# @puetsua/kancode-cruise-control

An LLM permission classifier for [KanCode](https://github.com/puetsua/kancode). It rates each gated tool action for **risk** and **user intent**, then auto-allows or denies — so routine work proceeds without prompting while anything unclear still reaches you.

Registers the permission module id `cruise_control`.

## Install

```bash
kancode plugin @puetsua/kancode-cruise-control
```

Or add it to `kancode.json` yourself:

```jsonc
{
  "plugin": ["@puetsua/kancode-cruise-control"],
  "permission": { "bash": "cruise_control", "edit": "cruise_control" },
  "permission_modules": {
    "cruise_control": { "model": "opencode/deepseek-v4-flash" }
  }
}
```

A model **must** be configured. Without one the module asks you to approve manually and hints at `/cruise-control-model`; it never silently allows.

## How a decision is made

Evaluation short-circuits in this order, so most decisions never reach the model:

1. **Destructive deny** — `rm -rf`, `DROP DATABASE`, `TRUNCATE`, force-push to main, `mkfs`, `dd of=/dev/…`. This is a pattern-matched backstop for common forms, not a sandbox: obfuscated equivalents can slip past it, so the model and your `allowlist` remain the real controls.
2. **Managed app directories** — `external_directory` inside KanCode's own config/data/cache/state/tmp roots.
3. **Session-scoped todo / rename** — session state, not filesystem writes.
4. **Per-prompt cache** — decisions learned earlier in the same turn (deny wins over allow).
5. **Explicit approval** — you answered a short "ok"/"go ahead" to an assistant permission ask naming this action.
6. **Model classification** — structured `{risk, intent, reason}`, then:
   - `risk: low` **or** `intent: high` → allow
   - `risk: medium` **and** `intent: medium` → allow
   - otherwise → deny
7. **Safety rails** — a candidate allow is downgraded unless the permission is on `allowlist` and absent from `never_auto`.

**Failure always denies.** Timeouts, provider errors, and unparseable output fail closed. Only `risk: low` outcomes are cached, and the cache clears on every new user message.

The classifier sees a filtered view: your messages plus tool names and truncated arguments. It never sees assistant text, reasoning, or tool results. Tool input is wrapped in a delimited block so it cannot be read as instructions.

## Options

All under `permission_modules.cruise_control`:

| Option | Default | Meaning |
| --- | --- | --- |
| `model` | *(required)* | `providerID/modelID` used to classify |
| `instructions` | built-in | `background` / `allow` / `conditional` / `deny` string arrays |
| `allowlist` | common tools | Permissions eligible for auto-allow; `[]` disables auto-allow entirely |
| `never_auto` | `[]` | Permissions that always escalate, even on allow |
| `timeout_ms` | `8000` | Per-attempt budget for the model call |
| `retries` | `3` | Max attempts including the first |
| `retry_interval_ms` | `2000` | Delay between attempts |
| `parallel_classify` | `false` | Allow concurrent classification |
| `classify_gap_ms` | `250` | Minimum gap between serialized calls |
| `dynamic_list` | enabled | `{ enabled, max_size }` for the per-prompt cache |

Only sections you set are used; missing ones fall back to built-in defaults. Defaults are **applied, never written into your config**, so improvements ship with the plugin instead of going stale in a file you never edited.

## Disabling

```jsonc
{ "plugin_enabled": { "puetsua.cruise-control": false } }
```

If the plugin is missing or fails to install, KanCode degrades to asking you normally — it does not deny.

## Compatibility

Requires a KanCode host that provides the plugin model capability (`input.model`) and `permission.registerModule`. No `engines` gate is declared: KanCode's compatibility check is skipped entirely for `0.x` hosts, so a range there would be inert today and misleading tomorrow. On a host without the capability the module registers but every decision fails closed to deny.

This package has **no runtime dependencies**. The host contract is mirrored as types in `src/host.ts`.

## License

MIT
