/**
 * ReasoningPicker — sets the main model's reasoning effort from the dashboard
 * Chat sidebar, mirroring the desktop app's composer effort radio.
 *
 * The dashboard previously only showed a read-only "Reasoning" capability
 * badge (see ModelInfoCard) with no way to actually choose the effort level —
 * unlike the desktop app, which exposes a radio in its model menu. This closes
 * that parity gap.
 *
 * Storage: the effort persists to config.yaml at `agent.reasoning_effort`
 * (the same key the TUI's `/reasoning <level>` command and the desktop radio
 * write). We read the whole config and write it back — the established
 * single-key pattern on the dashboard (see ConfigPage) — so the value lands in
 * the config the agent boots a fresh chat from. As with the model picker, the
 * running chat session adopts the change on the next `/new` or page reload;
 * we surface that hint rather than forcing a reload here.
 *
 * Profile scoping: the sidebar passes the chat profile explicitly, so this
 * reads/writes the same config the chat PTY was launched from.
 *
 * Ladder filtering: the picker normally lists all eight levels, but a route
 * that only distinguishes some of them (e.g. a Qwen chat template where
 * minimal≡low, high/max≡xhigh, ultra≡medium) can declare its real ladder at
 * `providers.<p>.models.<m>.reasoning_levels`; the picker then shows exactly
 * those levels (plus "Off"), so duplicates never masquerade as choices.
 * Routes without a declaration keep the full ladder; a currently-saved
 * level that a declaration excludes stays visible at its canonical
 * position. Stale fetch responses are dropped rather than applied: each
 * fetch carries a monotonic generation id, so even a request that revisits
 * an earlier fetch key (model A → B → A) can never overwrite a newer one.
 */

import { Select, SelectOption } from "@nous-research/ui/ui/components/select";
import { Brain } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import {
  type EffortOption,
  EFFORT_OPTIONS,
  declaredReasoningLevels,
  filterEffortOptions,
  normalizeEffort,
  VALID_EFFORTS,
} from "@/lib/reasoning-effort";

interface ReasoningPickerProps {
  /** Current model string from config — re-reads the saved effort when it
   *  changes (a different model may have been selected). */
  currentModel: string;
  /** Profile whose config should be read/written. */
  profile?: string;
  /** Bumped after the model picker saves, to re-read config in lockstep. */
  refreshKey?: number;
  /** Called after a successful change so the sidebar can show an "apply on
   *  /new or reload" notice, matching the model-switch UX. */
  onChanged?: (effort: string) => void;
}

export function ReasoningPicker({
  currentModel,
  profile,
  refreshKey = 0,
  onChanged,
}: ReasoningPickerProps) {
  const [effort, setEffort] = useState("medium");
  const [options, setOptions] = useState<ReadonlyArray<EffortOption>>(EFFORT_OPTIONS);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastFetchKeyRef = useRef("");
  const fetchSeqRef = useRef(0);

  useEffect(() => {
    const fetchKey = `${profile ?? ""}:${currentModel}:${refreshKey}`;
    if (fetchKey === lastFetchKeyRef.current) return;
    lastFetchKeyRef.current = fetchKey;
    // Monotonic generation: a fetch key can be revisited (model A → B → A),
    // so a key comparison alone cannot tell a stale request from the newest
    // one. Only the highest generation may apply its result.
    const seq = ++fetchSeqRef.current;
    void api
      .getConfig(profile)
      .then((cfg) => {
        // A newer fetch superseded this one (model/profile/refresh changed
        // mid-flight): drop the stale response instead of applying it.
        if (seq !== fetchSeqRef.current) return;
        const agent = (cfg?.agent as Record<string, unknown> | undefined) ?? {};
        const next = normalizeEffort(agent.reasoning_effort);
        setEffort(next);
        // A level saved before a declaration was added stays visible, at its
        // canonical position, so the picker never hides the in-effect value.
        setOptions(filterEffortOptions(declaredReasoningLevels(cfg, currentModel), next));
        setLoaded(true);
      })
      .catch(() => {
        // Best-effort: keep the last known value rather than blanking it. A
        // stale rejection must not enable the picker while a newer request
        // is still in flight.
        if (seq !== fetchSeqRef.current) return;
        setLoaded(true);
      });
  }, [currentModel, profile, refreshKey]);

  const onSelect = useCallback(
    (next: string) => {
      if (!VALID_EFFORTS.has(next) || next === effort) return;
      const prev = effort;
      setEffort(next); // optimistic
      setSaving(true);
      // Sparse patch: PUT /api/config deep-merges onto disk, so sending only
      // the edited key never clobbers sibling keys — and never echoes a
      // default-expanded snapshot back over values another surface changed
      // meanwhile (a CLI-pinned auxiliary slot would come back as "auto").
      void api
        .saveConfig({ agent: { reasoning_effort: next } }, profile)
        .then(() => {
          onChanged?.(next);
        })
        .catch(() => {
          setEffort(prev); // revert on failure
        })
        .finally(() => setSaving(false));
    },
    [effort, onChanged, profile],
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 text-text-tertiary">
        <Brain className="h-3.5 w-3.5" />
        <span className="text-display tracking-wider">reasoning</span>
      </div>
      <Select
        className="ml-auto min-w-0"
        disabled={!loaded || saving}
        onValueChange={onSelect}
        value={effort}
      >
        {options.map((opt) => (
          <SelectOption key={opt.value} value={opt.value}>
            {opt.label}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}
