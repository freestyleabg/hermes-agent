import { describe, it, expect } from "vitest";
import {
  EFFORT_OPTIONS,
  VALID_EFFORTS,
  declaredReasoningLevels,
  filterEffortOptions,
  normalizeEffort,
} from "./reasoning-effort";

describe("normalizeEffort", () => {
  it("treats empty/unset as the Hermes default (medium)", () => {
    expect(normalizeEffort("")).toBe("medium");
    expect(normalizeEffort(null)).toBe("medium");
    expect(normalizeEffort(undefined)).toBe("medium");
    expect(normalizeEffort("   ")).toBe("medium");
  });

  it("passes through every valid effort level", () => {
    for (const level of VALID_EFFORTS) {
      expect(normalizeEffort(level)).toBe(level);
    }
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeEffort("HIGH")).toBe("high");
    expect(normalizeEffort("  XHigh  ")).toBe("xhigh");
  });

  it("falls back to medium for unknown values", () => {
    expect(normalizeEffort("turbo")).toBe("medium");
    expect(normalizeEffort(42)).toBe("medium");
  });
});

describe("EFFORT_OPTIONS", () => {
  it("every option value is in VALID_EFFORTS (no orphan labels)", () => {
    for (const opt of EFFORT_OPTIONS) {
      expect(VALID_EFFORTS.has(opt.value)).toBe(true);
    }
  });
});

describe("declaredReasoningLevels", () => {
  const cfgWith = (provider: Record<string, unknown>) => ({ providers: { hyperqwen: provider } });

  it("returns the per-model declaration", () => {
    const cfg = cfgWith({
      default_model: "qwen3.8-27b",
      models: { "qwen3.8-27b": { context_length: 150000, reasoning_levels: ["low", "medium", "xhigh"] } },
    });
    expect(declaredReasoningLevels(cfg, "qwen3.8-27b")).toEqual(["low", "medium", "xhigh"]);
  });

  it("matches a provider-prefixed model string against the bare key", () => {
    const cfg = cfgWith({
      default_model: "qwen3.8-27b",
      models: { "qwen3.8-27b": { reasoning_levels: ["low", "xhigh"] } },
    });
    expect(declaredReasoningLevels(cfg, "hyperqwen/qwen3.8-27b")).toEqual(["low", "xhigh"]);
  });

  it("falls back to the provider-wide declaration for a model that belongs to the provider", () => {
    const cfg = cfgWith({
      default_model: "qwen3.8-27b",
      reasoning_levels: ["low", "medium", "xhigh"],
      models: { "qwen3.8-27b": { context_length: 150000 } },
    });
    expect(declaredReasoningLevels(cfg, "qwen3.8-27b")).toEqual(["low", "medium", "xhigh"]);
  });

  it("per-model declaration wins over the provider-wide one", () => {
    const cfg = cfgWith({
      default_model: "qwen3.8-27b",
      reasoning_levels: ["medium"],
      models: { "qwen3.8-27b": { reasoning_levels: ["low", "xhigh"] } },
    });
    expect(declaredReasoningLevels(cfg, "qwen3.8-27b")).toEqual(["low", "xhigh"]);
  });

  it("returns null when the model belongs to no declared provider", () => {
    const cfg = cfgWith({
      default_model: "qwen3.8-27b",
      models: { "qwen3.8-27b": { reasoning_levels: ["low"] } },
    });
    expect(declaredReasoningLevels(cfg, "gpt-6-sol")).toBeNull();
  });

  it("returns null for missing/empty config shapes", () => {
    expect(declaredReasoningLevels(null, "qwen3.8-27b")).toBeNull();
    expect(declaredReasoningLevels({}, "qwen3.8-27b")).toBeNull();
    expect(declaredReasoningLevels({ providers: { other: { models: {} } } }, "qwen3.8-27b")).toBeNull();
    expect(declaredReasoningLevels(cfgWith({ models: { "qwen3.8-27b": { reasoning_levels: [] } } }), "qwen3.8-27b")).toBeNull();
  });

  it("matches a fully-qualified stored key against the identical query string", () => {
    const cfg = { providers: { b: { models: { "a/m": { reasoning_levels: ["xhigh"] } } } } };
    expect(declaredReasoningLevels(cfg, "a/m")).toEqual(["xhigh"]);
  });

  it("never leaks a prefixed query into a bare key of another provider", () => {
    const cfg = {
      providers: {
        other: { name: "Other", models: { "qwen3.8-27b": { reasoning_levels: ["low"] } } },
      },
    };
    // The query names provider "alpha"; provider "other"'s bare key must not
    // inherit the query's ladder.
    expect(declaredReasoningLevels(cfg, "alpha/qwen3.8-27b")).toBeNull();
  });

  it("matches an unprefixed query against a prefixed key of the provider being inspected", () => {
    const cfg = { providers: { p: { models: { "p/m": { reasoning_levels: ["low", "xhigh"] } } } } };
    expect(declaredReasoningLevels(cfg, "m")).toEqual(["low", "xhigh"]);
  });

  it("matches via default_model when the model is not in the provider's map", () => {
    const cfg = { providers: { p: { default_model: "p/m", reasoning_levels: ["medium"] } } };
    expect(declaredReasoningLevels(cfg, "m")).toEqual(["medium"]);
    expect(declaredReasoningLevels(cfg, "p/m")).toEqual(["medium"]);
  });

  it("trims whitespace around model strings", () => {
    const cfg = { providers: { p: { default_model: " m ", reasoning_levels: ["low"] } } };
    expect(declaredReasoningLevels(cfg, "m")).toEqual(["low"]);
    expect(declaredReasoningLevels(cfg, " m ")).toEqual(["low"]);
  });

  it("first provider with an actual declaration wins across providers", () => {
    const cfg = {
      providers: {
        a: { models: { m: {} } }, // holds the model but declares nothing
        b: { models: { m: { reasoning_levels: ["xhigh"] } } },
      },
    };
    expect(declaredReasoningLevels(cfg, "m")).toEqual(["xhigh"]);
  });

  it("returns non-string entries raw; the filter normalizes them", () => {
    const cfg = {
      providers: { p: { models: { m: { reasoning_levels: [1, null, "LOW", "bogus", "XHigh"] } } } },
    };
    const levels = declaredReasoningLevels(cfg, "m");
    expect(levels).toEqual([1, null, "LOW", "bogus", "XHigh"]);
    expect(filterEffortOptions(levels).map((o) => o.value)).toEqual(["none", "low", "xhigh"]);
  });
});

describe("filterEffortOptions", () => {
  const values = (opts: ReadonlyArray<{ value: string }>) => opts.map((o) => o.value);

  it("returns the full ladder when nothing is declared", () => {
    expect(values(filterEffortOptions(null))).toEqual(EFFORT_OPTIONS.map((o) => o.value));
    expect(values(filterEffortOptions([]))).toEqual(EFFORT_OPTIONS.map((o) => o.value));
  });

  it("keeps 'none' first, then the declared levels in canonical order", () => {
    // Declared in scrambled order, mixed case, with a typo'd level — the
    // output order must follow the shared ladder, and the typo is dropped.
    expect(values(filterEffortOptions(["xhigh", "LOW", "bogus", "medium"]))).toEqual([
      "none",
      "low",
      "medium",
      "xhigh",
    ]);
  });

  it("drops a declaration that contains no recognized levels (full ladder)", () => {
    expect(values(filterEffortOptions(["bogus", "turbo"]))).toEqual(EFFORT_OPTIONS.map((o) => o.value));
  });

  it("treats a 'none'-only declaration as no declaration", () => {
    expect(values(filterEffortOptions(["none"]))).toEqual(EFFORT_OPTIONS.map((o) => o.value));
  });

  it("keeps the current level visible when a declaration excludes it (canonical position)", () => {
    // Saved before the declaration was added: stays visible, no duplicates.
    expect(values(filterEffortOptions(["low", "medium", "xhigh"], "ultra"))).toEqual([
      "none",
      "low",
      "medium",
      "xhigh",
      "ultra",
    ]);
  });

  it("does not duplicate the current level when it is already declared", () => {
    expect(values(filterEffortOptions(["low", "medium", "xhigh"], "xhigh"))).toEqual([
      "none",
      "low",
      "medium",
      "xhigh",
    ]);
  });

  it("ignores an invalid current level", () => {
    expect(values(filterEffortOptions(["low"], "bogus"))).toEqual(["none", "low"]);
  });

  it("keeps the full ladder intact when there is no declaration but a current level", () => {
    expect(values(filterEffortOptions(null, "max"))).toEqual(EFFORT_OPTIONS.map((o) => o.value));
  });
});
