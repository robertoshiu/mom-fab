# F4 Scope Fidelity Check — Evidence

## Scope Locks (re-run grep, app code only; vendor/.omo exempt)
- localStorage/sessionStorage/IndexedDB/WebSocket/Worker writes: 0 real hits.
  Only hit = engine/d3-loader.js READ of 'D3_FORCE_FALLBACK' flag (QA offline seam, read-only, persists nothing). No .setItem in code (only in a comment).
- WebGL/babylon/three: 0.
- '3d' regex: only false positives — scenarios "3D NAND" (product name) + #3ddc97 hex color.
- No abstract BaseComponent; no `extends` anywhere in app code. Classes present are concrete domain classes the plan specifies (Dispatcher/TickScheduler/Router/HeroStory/KpiStrip/EventRiver).
- Dispatcher is controller-held (app.js __SIM.dispatcher); NOT a global EventBus. nav uses native CustomEvent('module:change') per plan line 960.
- Global assignments beyond __SIM: only window.__bootComplete/__bootError (D14 handshake) + d3-loader guarded __SIM.d3 set. Clean.
- Banned PRNG/time APIs (Math.random/Date.now/new Date/crypto.getRandomValues): 0 real hits (all in comments documenting absence). kpi-strip rAF is count-up (T11 allowed), not tick advance.

## Branding de-identification (delta 4)
- Applied Materials / SmartFactory / Critical Manufacturing across index.html, DEPLOY.md, i18n/*.json, all app files: 0 usages. Only mentions are de-identification GUARDRAIL notes in DESIGN.md + DEPLOY.md (forbidding the names). Clean.

## T32 Must NOT (delta 2)
- scenarios/mom-fab.js = pure frozen-data, zero imports, single-layer JS. No plugin system, no DSL, no multi-scenario loader. Confirmed by reading the file.

## Handler coverage (behavior + source)
- Live booted at :8554, 0 console errors, __SIM exactly 8 keys, d3 truthy (vendor fallback active).
- Buttons created via Button() factory each bind addEventListener('click', onClick) internally — grep counts undercount; verified each MES action btn (6) wires _runAction→setOverride; disabled-until-select gating works.
- SPC: 8 WE-rule checkboxes, change handlers fire (live toggle confirmed).
- Yield: Pareto drill-down delegated handler on _paretoHost (1-level → Dialog), bars carry cursor:pointer; canvas wafer map renders.
- All 9 modules render via real nav-button clicks; nav active-class + accesskeys work.
- No module hardcodes domain constants (8 import from scenarios; mes/aps consume factory/state objects).
