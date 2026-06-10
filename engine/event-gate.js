// engine/event-gate.js
// C2 / T29 — Skeleton↔user conflict resolver.
//
// gateEvent(event, state) decides whether a dispatcher event is allowed to reach
// its subscribers. It is the single chokepoint that lets a user's MES action
// (Hold / Scrap / Complete) override the deterministic 180-tick skeleton so the
// operator's intent is never silently clobbered by the next scripted lifecycle
// event for the same lot.
//
// Wiring: app.js constructs the Dispatcher with a gateFn closure that binds the
// shared SimulationState, i.e. `new Dispatcher((event) => gateEvent(event, state))`.
// The dispatcher calls the gateFn for every emit; a falsy return suppresses the
// event before any subscriber sees it.
//
// Event shape the gate reads (supplied by app.js emitSkeletonTick via emit meta):
//   { type, payload, suppressible: true, lotId, tick }
// Non-skeleton emits (recipe.changed, defect.detected, yield.alert, alarms, …)
// carry no `suppressible` flag, so they are always passed through untouched.
//
// suppressOverrides is a Map<lotId, {status:'hold'|'scrap'|'complete', until:tick}>:
//   - hold     → suppress the lot's skeleton events until `until`; once the tick
//                reaches/passes `until` the override has expired and events flow
//                again AND the lot resumes (app.js's setStatusUnlessOverridden
//                lets the next lifecycle event re-stamp status:'running').
//   - scrap    → permanent suppression (until = Infinity).
//   - complete → permanent suppression (until = Infinity).
//
// This file never mutates the skeleton array (it is immutable by design) and
// never mutates state — it is a pure predicate over (event, state).

export function gateEvent(event, state) {
  // Non lot-scoped (non-suppressible) events always pass: alarms, SPC/APC/FDC
  // jitter, defects, yield alerts, PO/material, recipe sign-offs, etc.
  if (!event || !event.suppressible) return true;

  // No state or no override map → nothing to suppress.
  const overrides = state && state.suppressOverrides;
  if (!overrides) return true;

  const override = overrides.get(event.lotId);
  if (!override) return true;

  if (override.status === 'hold') {
    // Hold suppresses until the expiry tick; on/after expiry, events flow again
    // so the lot resumes its skeleton lifecycle.
    return event.tick != null && event.tick >= override.until;
  }

  if (override.status === 'scrap' || override.status === 'complete') {
    return false; // terminal — permanently suppress this lot's skeleton events.
  }

  // Unknown override status: fail open (pass) rather than silently dropping.
  return true;
}

export default gateEvent;
