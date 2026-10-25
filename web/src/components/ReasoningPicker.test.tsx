// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReasoningPicker } from "@/components/ReasoningPicker";

type PendingFetch = { resolve: (cfg: unknown) => void; reject: (err: unknown) => void };

const apiMocks = vi.hoisted(() => ({
  pending: [] as PendingFetch[],
  getConfig: vi.fn((profile?: string) => {
    void profile;
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      apiMocks.pending.push({
        resolve: (cfg) => resolve(cfg as Record<string, unknown>),
        reject: (err) => reject(err as Error),
      });
    });
  }),
  saveConfig: vi.fn(async () => undefined),
}));

vi.mock("@/lib/api", () => ({
  api: {
    getConfig: apiMocks.getConfig,
    saveConfig: apiMocks.saveConfig,
  },
}));

// A minimal stand-in for the design-system Select so the tests can assert on
// the raw <select> DOM: value, disabled state, and the option list.
vi.mock("@nous-research/ui/ui/components/select", () => ({
  Select: (props: { value: string; disabled?: boolean; children?: ReactNode }) => (
    <select data-picker="reasoning" value={props.value} disabled={props.disabled}>
      {props.children}
    </select>
  ),
  SelectOption: (props: { value: string; children?: ReactNode }) => (
    <option value={props.value}>{props.children}</option>
  ),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(model: string) {
  if (root === null) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(<ReasoningPicker currentModel={model} profile="default" refreshKey={0} />);
  });
}

function select(): HTMLSelectElement {
  return container?.querySelector("select[data-picker='reasoning']") as HTMLSelectElement;
}

function optionValues(): string[] {
  return Array.from(select().querySelectorAll("option")).map((o) => o.value);
}

/** Resolve the i-th in-flight getConfig and let React process the update. */
async function settle(i: number, cfg: Record<string, unknown>) {
  apiMocks.pending[i].resolve(cfg);
  await act(async () => undefined);
}

async function fail(i: number) {
  apiMocks.pending[i].reject(new Error("offline"));
  await act(async () => undefined);
}

function cfgFor(model: string, effort: string, declared?: string[]): Record<string, unknown> {
  const provider: Record<string, unknown> = { default_model: model };
  if (declared) provider.models = { [model]: { reasoning_levels: declared } };
  return { agent: { reasoning_effort: effort }, providers: { alpha: provider } };
}

beforeEach(() => {
  apiMocks.pending.length = 0;
  apiMocks.getConfig.mockClear();
});

afterEach(() => {
  const r = root;
  if (r !== null) act(() => r.unmount());
  root = null;
  container?.remove();
  container = null;
});

describe("ReasoningPicker fetch lifecycle", () => {
  it("drops a stale success when the same fetch key is revisited (A → B → A)", async () => {
    render("a"); // fetch #0 — key :a:0
    render("b"); // fetch #1
    render("a"); // fetch #2 — revisits #0's key
    expect(apiMocks.getConfig).toHaveBeenCalledTimes(3);

    await settle(2, cfgFor("a", "xhigh", ["low", "xhigh"]));
    expect(select().value).toBe("xhigh");
    expect(select().disabled).toBe(false);
    expect(optionValues()).toEqual(["none", "low", "xhigh"]);

    // The OLDEST A response lands last with a different payload: it must be
    // ignored, not allowed to overwrite the newer one (a key comparison
    // alone cannot tell the two A requests apart — only a generation id can).
    await settle(0, cfgFor("a", "low", ["low"]));
    expect(select().value).toBe("xhigh");
    expect(optionValues()).toEqual(["none", "low", "xhigh"]);
  });

  it("keeps the picker disabled when a stale request is rejected mid-flight", async () => {
    render("a"); // fetch #0
    render("b"); // fetch #1
    render("a"); // fetch #2 — newest

    await fail(0); // oldest A rejects while the newest A is still pending
    expect(select().disabled).toBe(true);
    await fail(1); // superseded B rejects too
    expect(select().disabled).toBe(true);

    await settle(2, cfgFor("a", "medium")); // newest settles: full ladder
    expect(select().disabled).toBe(false);
    expect(select().value).toBe("medium");
  });

  it("still drops an ordinary stale response when the key changes (A → B)", async () => {
    render("a"); // fetch #0
    render("b"); // fetch #1

    await settle(0, cfgFor("a", "xhigh", ["low", "xhigh"])); // oldest lands first
    expect(select().disabled).toBe(true); // nothing may apply while #1 is in flight
    await settle(1, cfgFor("b", "low", ["low"]));
    expect(select().value).toBe("low");
    expect(optionValues()).toEqual(["none", "low"]);
  });

  it("renders the declared ladder plus Off, in canonical order", async () => {
    render("a");
    await settle(0, cfgFor("a", "xhigh", ["xhigh", "low"]));
    expect(optionValues()).toEqual(["none", "low", "xhigh"]);
    expect(select().value).toBe("xhigh");
  });

  it("keeps the full ladder when the route declares nothing", async () => {
    render("a");
    await settle(0, cfgFor("a", "max"));
    expect(optionValues().length).toBe(8);
    expect(optionValues()).toContain("max");
  });
});
