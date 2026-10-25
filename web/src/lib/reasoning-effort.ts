import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_VALUES,
  type ReasoningEffortValue,
} from "@hermes/shared";

/**
 * Pure reasoning-effort helpers shared by the dashboard ReasoningPicker.
 *
 * Kept DOM-free so the node-environment vitest harness can cover the
 * resolution logic without loading React or the UI kit.
 *
 * Values come from @hermes/shared (hermes_constants.VALID_REASONING_EFFORTS
 * plus `none`, thinking-off). An empty/unset config value means the Hermes
 * default.
 */

export interface EffortOption {
  value: string;
  label: string;
}

const EFFORT_LABELS: Record<ReasoningEffortValue, string> = {
  none: "Off (no thinking)",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

/** `none` first, then the seven levels ascending — the shared value order. */
export const EFFORT_OPTIONS: ReadonlyArray<EffortOption> = REASONING_EFFORT_VALUES.map(
  (value) => ({ value, label: EFFORT_LABELS[value] }),
);

export const VALID_EFFORTS: ReadonlySet<string> = new Set(REASONING_EFFORT_VALUES);

/** Normalize a raw `agent.reasoning_effort` config value to a selectable
 *  option. Empty/unknown → `medium` (Hermes' default when unset). */
export function normalizeEffort(raw: unknown): string {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) return DEFAULT_REASONING_EFFORT;
  return VALID_EFFORTS.has(value) ? value : DEFAULT_REASONING_EFFORT;
}

/** Whether a configured model string (`stored` — a provider `models` map key
 *  or its `default_model`) names the same model as the query.
 *
 * Both bare (`qwen3.8-27b`) and provider-prefixed (`hyperqwen/qwen3.8-27b`)
 * forms occur in config and UI model strings. The rules are deliberately
 * conservative:
 * - an unprefixed query matches a bare stored string, or a stored string
 *   whose suffix after "/" is the same model (the key belongs to the
 *   provider being inspected, so its prefix can be ignored);
 * - a prefixed query matches the full stored string exactly (the string
 *   pins its own provider), or a BARE stored string only when that provider
 *   is the one named in the query — a bare key from an unrelated provider
 *   must never inherit that provider's ladder. `providerNames` carries the
 *   provider's config key and display name for that last comparison.
 */
function sameModel(query: string, stored: string, providerNames: readonly string[] = []): boolean {
  const q = query.trim();
  const v = stored.trim();
  if (!q || !v) return false;

  if (!q.includes("/")) {
    return v === q || (v.includes("/") && v.slice(v.indexOf("/") + 1) === q);
  }

  const i = q.indexOf("/");
  const prefix = q.slice(0, i);
  const model = q.slice(i + 1);
  if (v.includes("/")) return v === q;
  return v === model && providerNames.some((n) => n.trim().toLowerCase() === prefix.toLowerCase());
}

/**
 * The per-route display ladder declared in config, or `null` when the route
 * declares none.
 *
 * Some routes only *distinguish* a few of the canonical levels — Qwen3.8's
 * chat template maps `minimal` → `low`, `high`/`max` → `xhigh`, and `ultra`
 * → `medium`'s no-instruction behavior, so showing all eight rows presents
 * duplicates as distinct choices. A provider can declare the levels its
 * route actually distinguishes at `providers.<p>.models.<m>.reasoning_levels`
 * (per model) or `providers.<p>.reasoning_levels` (provider-wide, applies to
 * any model that belongs to that provider's map or is its default). The
 * first provider that actually declares levels wins.
 */
export function declaredReasoningLevels(
  cfg: Record<string, unknown> | null | undefined,
  model: string,
): ReadonlyArray<unknown> | null {
  const providers = cfg?.providers;
  if (!providers || typeof providers !== "object" || !String(model).trim()) return null;

  const q = String(model);

  for (const [key, value] of Object.entries(providers as Record<string, unknown>)) {
    const provider = value as
      | undefined
      | {
          name?: unknown;
          default_model?: unknown;
          reasoning_levels?: unknown;
          models?: Record<string, unknown> | null;
        };
    if (!provider || typeof provider !== "object") continue;

    // Provider identities for prefixed-query matching: the config key and,
    // when different, the display name.
    const names = [key];
    if (typeof provider.name === "string" && provider.name.trim()) names.push(provider.name);

    let belongs = typeof provider.default_model === "string" && sameModel(q, provider.default_model, names);
    let modelEntry: Record<string, unknown> | null = null;
    for (const [mKey, entry] of Object.entries(provider.models ?? {})) {
      if (sameModel(q, mKey, names)) {
        belongs = true;
        if (modelEntry === null && entry && typeof entry === "object") {
          modelEntry = entry as Record<string, unknown>;
        }
      }
    }

    if (modelEntry) {
      const levels = modelEntry.reasoning_levels;
      if (Array.isArray(levels) && levels.length > 0) return levels;
    }
    if (belongs) {
      const levels = provider.reasoning_levels;
      if (Array.isArray(levels) && levels.length > 0) return levels;
    }
  }

  return null;
}

/**
 * Picker rows for a declared ladder: `none` (thinking off) always stays —
 * every route can disable thinking — plus exactly the declared levels, in
 * canonical order. No declaration, or a declaration with no recognized
 * levels, returns the full ladder: a missing/typo'd declaration can never
 * hide a level the route supports. A level that is currently in effect but
 * not in the declaration (saved before it was added) stays visible at its
 * canonical position.
 */
export function filterEffortOptions(supported: ReadonlyArray<unknown> | null, current?: string): ReadonlyArray<EffortOption> {
  const known = new Set<string>();
  if (supported && supported.length > 0) {
    for (const raw of supported) {
      const v = String(raw ?? "").trim().toLowerCase();
      if (v !== "none" && VALID_EFFORTS.has(v)) known.add(v);
    }
  }

  const allowed = new Set<string>();
  if (known.size === 0) {
    for (const opt of EFFORT_OPTIONS) allowed.add(opt.value);
  } else {
    allowed.add("none");
    for (const level of known) allowed.add(level);
  }

  if (current) {
    const c = String(current).trim().toLowerCase();
    if (VALID_EFFORTS.has(c)) allowed.add(c);
  }

  return EFFORT_OPTIONS.filter((opt) => allowed.has(opt.value));
}
