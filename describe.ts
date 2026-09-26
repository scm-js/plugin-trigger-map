/**
 * Words for the graph: what a node is called, and the short phrase an edge carries
 * ("is set", "≥ 3", "+ 1", "Create Unit"). Everything comes from the editor — the map's
 * own names through `api.names`, the numbers through `api.consts.triggers` — so a map
 * with renamed units and switches reads the way its author wrote it.
 */
import type { PluginApi, TriggerRecord, TriggerRef, TriggerRefKind } from "@scm-js/plugin-api";
import type { Thing } from "./graph";

type T = (text: string, params?: Record<string, string | number>) => string;

/** The kind of thing, as a word for the node's first line and the list's group heading. */
export function kindLabel(t: T, kind: TriggerRefKind): string {
  switch (kind) {
    case "switch": return t("Switch");
    case "deaths": return t("Death counter");
    case "memory": return t("Memory");
    case "timer": return t("Timer");
    case "resources": return t("Resources");
    case "score": return t("Score");
    case "units": return t("Units");
    case "location": return t("Location");
    case "outcome": return t("Game end");
    case "string": return t("Text");
    case "wav": return t("Sound");
    case "aiScript": return t("AI script");
    case "cuwp": return t("Unit properties");
  }
}

/** The plural heading for a group of things in the list. */
export function kindHeading(t: T, kind: TriggerRefKind): string {
  switch (kind) {
    case "switch": return t("Switches");
    case "deaths": return t("Death counters");
    case "memory": return t("Memory (EUD)");
    case "timer": return t("Countdown timer");
    case "resources": return t("Ore and gas");
    case "score": return t("Scores");
    case "units": return t("Units");
    case "location": return t("Locations");
    case "outcome": return t("Game endings");
    case "string": return t("Text");
    case "wav": return t("Sounds");
    case "aiScript": return t("AI scripts");
    case "cuwp": return t("Unit properties");
  }
}

export function hex(address: number): string {
  return `0x${(address >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

/** Map text as one plain line: colour codes and line breaks gone, long text cut. */
export function oneLine(text: string, max = 60): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** What the thing is called. */
export function thingName(api: PluginApi, t: T, thing: Pick<Thing, "kind" | "id" | "address">): string {
  const n = api.names;
  switch (thing.kind) {
    case "switch": return n.switch(thing.id);
    case "deaths": case "units": return n.unit(thing.id);
    case "memory": return hex(thing.address ?? 0);
    case "timer": return t("Countdown timer");
    case "resources": return api.triggers.defs.choiceLabel("resource", thing.id) ?? String(thing.id);
    case "score": return api.triggers.defs.choiceLabel("score", thing.id) ?? String(thing.id);
    case "location": return n.location(thing.id);
    case "outcome": return n.action(thing.id);
    case "string": return oneLine(n.string(thing.id) ?? t("String {n}", { n: thing.id }));
    case "wav": { const path = n.string(thing.id) ?? ""; return oneLine(path.split(/[\\/]/).pop() || t("String {n}", { n: thing.id })); }
    case "aiScript": return n.aiScript(thing.id);
    case "cuwp": return t("Slot {n}", { n: thing.id + 1 });
  }
}

/** Player slots as short text: `P1`, `P1–P8`, `P1, P3, P5`. */
export function playersText(players: readonly number[]): string {
  if (players.length === 0) return "";
  const runs: string[] = [];
  let start = players[0], prev = players[0];
  const flush = () => runs.push(start === prev ? `P${start + 1}` : prev === start + 1 ? `P${start + 1}, P${prev + 1}` : `P${start + 1}–P${prev + 1}`);
  for (const p of players.slice(1)) {
    if (p === prev + 1) { prev = p; continue; }
    flush();
    start = prev = p;
  }
  flush();
  return runs.join(", ");
}

const PLAYER_KINDS = new Set<TriggerRefKind>(["deaths", "resources", "score", "units", "outcome"]);

/** The players a reference is about, as its edge shows them; the group's own name when it is only settled in the game. */
export function refPlayers(api: PluginApi, ref: TriggerRef): string {
  if (!PLAYER_KINDS.has(ref.kind) || ref.kind === "outcome") return "";
  if (ref.approximate && ref.group !== undefined) return api.names.playerGroup(ref.group);
  return playersText(ref.players);
}

/** What a condition or action does to the thing, in a few characters. */
export function refPhrase(api: PluginApi, t: T, list: readonly TriggerRecord[], trigger: number, ref: TriggerRef): string {
  const k = api.consts.triggers;
  const record = list[trigger];
  if (ref.part === "condition") {
    const c = record?.conditions[ref.slot];
    if (!c) return api.names.condition(ref.type);
    if (ref.kind === "switch") return c.comparison === k.switchState.Set ? t("is set") : t("is cleared");
    const compare = c.comparison === k.comparison.AtLeast ? "≥" : c.comparison === k.comparison.AtMost ? "≤" : c.comparison === k.comparison.Exactly ? "=" : null;
    const counted = ref.type === k.condition.Deaths || ref.type === k.condition.CountdownTimer || ref.type === k.condition.Accumulate
      || ref.type === k.condition.Score || ref.type === k.condition.Command || ref.type === k.condition.Bring;
    if (compare && counted && ref.kind !== "location") {
      const amount = ref.type === k.condition.CountdownTimer ? t("{n} s", { n: c.amount }) : String(c.amount >>> 0);
      const lead = ref.type === k.condition.Bring ? `${t("at")} ` : "";
      return `${lead}${compare} ${amount}`;
    }
    return api.names.condition(ref.type);
  }
  const a = record?.actions[ref.slot];
  if (!a) return api.names.action(ref.type);
  if (ref.kind === "switch") {
    switch (a.modifier) {
      case k.switchAction.Set: return t("set");
      case k.switchAction.Clear: return t("clear");
      case k.switchAction.Toggle: return t("toggle");
      case k.switchAction.Randomize: return t("randomize");
    }
    return api.names.action(ref.type);
  }
  if (ref.access === "write" && (ref.type === k.action.SetDeaths || ref.type === k.action.SetResources || ref.type === k.action.SetScore || ref.type === k.action.SetCountdownTimer)) {
    const amount = ref.type === k.action.SetCountdownTimer ? t("{n} s", { n: a.time }) : String(a.target >>> 0);
    const op = a.modifier === k.modifier.SetTo ? "=" : a.modifier === k.modifier.Add ? "+" : a.modifier === k.modifier.Subtract ? "−" : "?";
    return `${op} ${amount}`;
  }
  return api.names.action(ref.type);
}

/** A trigger's second line: its comment when it has one, else its conditions as text. */
export function triggerLine(api: PluginApi, trigger: TriggerRecord): string {
  const comment = api.triggers.comment(trigger);
  if (comment) return oneLine(comment, 80);
  return oneLine(api.triggers.summarize(trigger).conditions, 80);
}
