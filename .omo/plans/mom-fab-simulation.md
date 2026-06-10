# Applied Materials SmartFactory FAB 300 MOM 互動式模擬

## TL;DR

> **Quick Summary**: 建構一個純前端 SPA，全參照 Applied Materials SmartFactory FAB 300 與 Critical Manufacturing MOM Platform 的 9 模組 (MES/APS/ERP/SPC/APC/WIP/SCM/Recipe/Yield) 高仿真互動式 mock，附 3 分鐘不重複且可 loop 的動態資料流。
>
> **Deliverables**:
> - 單一 `index.html` SPA，HTTP static host 可直接開啟 (esm.sh ESM，不支援 file://)
> - 9 個模組完整互動 (Sort/Filter/Drill-down/Action 按鈕)
> - 頂部「橫向事件河 + 跳動 KPI 帶」
> - D3 v7 ESM 圖表 (SVG/Canvas 混合)
> - 雙語 i18n (中英混雜，例: 「良率管理 / Yield Management」)
> - 深淺主題切換 (主視深色 / 報表淺色)
> - 180-tick epoch + 1.2s choreographed loop 轉場
> - Mulberry32 PRNG 確定性資料引擎
>
> **Estimated Effort**: XL
> **Parallel Execution**: YES — 5 waves (33 tasks + 5 reviews)
> **Critical Path**: Task 32 (scenario manifest) → Task 1 (engine) → Task 4 (shell) → Task 5-13 (modules) → F1-F5

---

## Context

### Original Request
創建一個全參照 Applied Materials SmartFactory FAB 300 完整功能流程與系統設計的 MOM (MES,APS,ERP,SPC,APC,WIP,SCM,配方管理,良率/缺陷管理)，輔以 Critical Manufacturing MOM Platform 以及更豐富直觀的 UI/UX，要純靜態網頁的互動式功能，要有高仿真的各類動態，每個可點擊元件都是有相對應作用的功能。資料持續不斷變動，不同分類的料單事件持續發送。模擬資料多用雜湊隨機組合生成。準備 3 分鐘不重複的模擬資料呈現，每 3 分鐘可重複播放動態資料。

### Interview Summary

**Key Decisions**:
- 架構: 單頁 SPA，左側 9 模組導航 + 主內容區
- 視覺: 混合 (深色主視 + 淺色報表)，主題可切換
- 規模: 大型 fab — 5 products, 100 tools, **100 lots** (25 wafers/lot) — 統一為 100 (I1 修正)
- 語言: 中英混雜 (例: 「良率管理 / Yield Management」)，i18n 切換
- D3: v7 ESM from esm.sh CDN (需 http://，不支援 file://)
- 資料時序: 啟動時決定 180-tick lot 生命週期骨架 + 每 tick 從 seed 推導隨機抖動
- Epoch 過渡: 1.2s choreographed transition (per M3/T26)
- Tick 引擎: setInterval(1000ms) + wall clock 補點

**Research Findings (Metis consultation)**:
- 必須禁用 `Math.random()` / `Date.now()`，全部走 Mulberry32 seeded PRNG
- 必須 D3 `.interrupt()` 在每次 transition 前
- 3000 DOM node 上限
- 表格虛擬滾動 (>50 列)，Canvas 用於高密度 chart (>200 點)
- 必須有 SimulationController lifecycle (start/stop/destroy)
- Wall clock 用於 simulation progression，RAF 只用於 render
- 不建構步驟 (no bundler) — 原生 `<script type="module">` + import map

### Metis Review — Identified Gaps (addressed)
- ✅ D3 v7 ESM 在 file:// 不可用 → 改用 http:// static host，明示限制
- ✅ 預生 vs 即時衝突 → 明確「skeleton 預定 + jitter 即時」
- ✅ 測試策略缺失 → NONE + agent QA MANDATORY
- ✅ Scale 數字未定 → 大型 fab (5/100/**100**/25) — 統一為 100 lots (I1 修正)
- ✅ Epoch 過渡未定 → 1.2s choreographed transition (per M3/T26)
- ✅ Tick 引擎未定 → setInterval + wall clock 補點

---

## Work Objectives

### Core Objective
建構一個純前端、HTTP-hosted 的 MOM 9 模組高仿真互動式 SPA，提供 3 分鐘不重複且可 loop 的動態資料流，作為業務展示用途。

### Concrete Deliverables
- `index.html` (單頁入口)
- `app.js` (應用入口 + SPA router)
- `engine/prng.js` (Mulberry32 + FNV-1a 雜湊)
- `engine/data-engine.js` (Lot/Equipment/Recipe 物件工廠 + skeleton 生成)
- `engine/tick-scheduler.js` (setInterval + wall clock 補點 + fade 轉場)
- `engine/dispatcher.js` (event river 料單事件發送)
- `engine/state.js` (SimulationState 中央 store)
- `i18n/zh-TW.json`, `i18n/en-US.json` (雙語字典)
- `styles/theme.css`, `styles/components.css`, `styles/modules.css`
- 9 個模組檔案 `modules/{mes,aps,erp,spc,apc,wip,scm,recipe,yield}.js`
- 頂部 `shell/event-river.js`, `shell/kpi-strip.js`, `shell/nav.js`
- `vendor/d3.v7.min.js` (備用 — 若 esm.sh 不可達)

### Definition of Done
- [ ] Playwright 開啟 `index.html` 載入完成 < 2s
- [ ] 點擊左側 9 個模組 nav 皆能切換主內容區
- [ ] 頂部事件河每秒有新事件流入 (>0 events in 10s)
- [ ] 180 tick 後 1.2s choreographed loop 回到 tick 0
- [ ] i18n toggle 切換所有 `[data-i18n]` 元素
- [ ] 主題切換改變 root class
- [ ] 60s 連續運行 memory < 200MB
- [ ] 無 `Math.random()` / `Date.now()` 出現於 src

### Must Have
- 9 模組高仿真，每個有「核心互動元件」(per draft 列表)
- 3 分鐘不重複資料 (Mulberry32 + per-tick seed)
- 1.2s choreographed loop 轉場 (per M3/T26)
- 中英雙語
- 深淺主題切換
- 每個可點擊元件都連接到對應功能 (sort/filter/dialog/navigate)
- D3 v7 從 esm.sh 載入
- `ast_grep_search` 驗證無禁用 API

### Must NOT Have (Guardrails)
- 不做 RAG/AI Copilot
- 不做真實 SECS/HSMS 協定
- 不做 multi-fab / multi-tenant
- 不做 persistence (localStorage/IndexedDB)
- 不做 real-time collaboration
- 不做 PDF / 列印匯出
- 不做 3D (WebGL/Babylon)
- 不做音效
- 模組深度嚴格限制，無 sub-screen drill-down
- 不建構步驟 (no bundler)
- 無 `Math.random()` / `Date.now()` / `new Date()` / `crypto.getRandomValues()` 隨機用途
- 無 EventBus / BaseComponent 抽象類別
- 無 README.md / JSDoc 大規模註解
- 公開版 (index.html 標題、UI 文案、README) 不出現 Applied Materials / SmartFactory / Critical Manufacturing 名稱,不複製其視覺識別 (內部計畫文件參照不受限) (P3)

### Spec Framework Integration

> OpenSpec 與 Spec Kit 框架未在目標 repo 偵測到 (`.omo/drafts/` 為本規劃 metadata 目錄，非 SDD 框架)。本工作不涉及 OpenSpec/Spec Kit 命令。

---

## 互動狀態規格 (Interaction State Matrix)

> **【2A 修】** 9 模組 + KPI 帶 + 事件河 + nav 在 5 種資料狀態下的呈現規範。全部狀態文案進 i18n 字典 (T7 加 `states.*` keys,雙語對齊)。

**通則 (General Rules)**:
- **(a) LOADING** = skeleton shimmer 區塊 (非 spinner),由 chart-kit / Table 元件內建。
- **(b) EMPTY** = 溫度文案 + 確定性預告 (引擎可精確預測首批資料抵達時點,例 Yield tick<12:「尚無缺陷記錄 — 模擬進行中,首批檢測約 tick 12 抵達」) + 灰階視覺骨架。
- **(c) ERROR** = 模組級 inline 錯誤塊,沿用 T9 boot 橫幅語彙 (錯誤訊息文字 + 重試鈕)。
- **(d) PARTIAL** = 滑動視窗未滿時 (如 SPC <50 點) 圖表靠左繪製 + 右側淡格線,不拉伸。
- **(e)** 全部狀態文案進 i18n 字典 (T7 加 `states.*` keys,雙語對齊)。

| 模組 / 區域 | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL |
|---|---|---|---|---|---|
| **MES** | Lot 表 skeleton shimmer 列 | 「尚無在製 lot — 首批約 tick 3 投入」+ 灰階表骨架 | inline 錯誤塊 + 重試鈕 | Lot 追蹤表 + Gantt 完整繪製 | 表格已部分填列,Gantt 軸靠左繪、右側淡格線 |
| **APS** | 派工甘特 row skeleton | 「尚無派工 — 等待 lot 投入」+ 灰階甘特 | inline 錯誤塊 + 重試鈕 | 100 row 甘特 + 熱力圖 | 甘特靠左繪、未排 row 淡格線 |
| **ERP** | Kanban column skeleton | 「尚無採購單 — 點 Create PO 建立」+ 灰階卡片框 | inline 錯誤塊 + 重試鈕 | BOM 樹 + 5-column kanban | 部分 column 有卡、其餘空欄淡格線 |
| **SPC** | 控制圖 shimmer 區塊 | 「尚無採樣點 — 首批約 tick 6 抵達」+ 灰階軸 | inline 錯誤塊 + 重試鈕 | X-bar/R chart + UCL/CL/LCL | <50 點靠左繪、右側淡格線不拉伸 |
| **APC** | R2R / FDC chart shimmer | 「尚無調整紀錄 — 等待首個 R2R run」+ 灰階軸 | inline 錯誤塊 + 重試鈕 | R2R 動畫 + FDC 多線圖 | 線圖靠左繪、未滿視窗右側淡格線 |
| **WIP** | 甘特 + flow shimmer | 「尚無在製 lot — 首批約 tick 3 投入」+ 灰階節點 | inline 錯誤塊 + 重試鈕 | 即時甘特 + flow 動畫 + sparkline | 甘特/ sparkline 靠左繪、右側淡格線 |
| **SCM** | supplier card + 表 skeleton | 「尚無在途料 — 等待 PO 發出」+ 灰階卡片 | inline 錯誤塊 + 重試鈕 | 10 supplier card + 在途料表 | 部分 supplier 已評分、料表部分填列 |
| **Recipe** | 參數表 + diff skeleton | 「尚無配方版本 — 點 New version 建立」+ 灰階表 | inline 錯誤塊 + 重試鈕 | 參數表 + 版本 diff | 參數表部分填列、diff 單側 |
| **Yield** | Pareto/wafer map/trend shimmer | 「尚無缺陷記錄 — 模擬進行中,首批檢測約 tick 12 抵達」+ 灰階骨架 | inline 錯誤塊 + 重試鈕 | Pareto + wafer map + trend | Pareto bar 靠左累積、trend <50 點右側淡格線 |
| **KPI 帶** | 6 卡 shimmer | 「指標計算中…」灰階數字位 | inline 錯誤塊 (單卡) | 6 KPI 數字跳動 | 部分 KPI 已算出、其餘灰階 |
| **事件河** | chip 軌 shimmer | 「尚無事件 — 首批約 tick 0-2 流入」灰階軌 | inline 錯誤塊 + 重試鈕 | chip 流動 + priority lane + `+N` | chip 軌未滿,左對齊不拉伸 |
| **nav** | 軌 skeleton (極少觸發) | N/A (nav 恆定 9 項) | nav 項 disabled + tooltip 說明 | 9 縮寫按鈕 + tooltip | N/A |

---

## Verification Strategy (MANDATORY)

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed via Playwright.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: NONE
- **Framework**: N/A
- **Agent-Executed QA**: MANDATORY for every task. Playwright scenarios in every TODO.

### QA Policy
- 工具: Playwright MCP (`skill: playwright`) 為主，curl 為輔
- 截圖: `.omo/evidence/task-{N}-{scenario-slug}.png`
- DOM 斷言: `page.locator(...)` 必須可解析

Evidence 範例路徑:
- `.omo/evidence/task-1-tick-fires.png` (Playwright 截圖顯示 tick=0→1 變化)
- `.omo/evidence/task-1-prng-determinism.json` (hash 比較結果)
- `.omo/evidence/task-5-event-river-running.png`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 0 (Design Foundation — 1 task):
└── T0: Design tokens 系統 (styles/tokens.css) — BlockedBy None

Wave 1 (Foundation — 純函式 / 無相互依賴, 7 tasks):
├── T32: Scenario manifest (scenarios/mom-fab.js) — 純資料,零依賴, BlockedBy None
├── T1: PRNG + 雜湊引擎 (engine/prng.js) — 包含 deriveTickSeed (H1 fix)
├── T2: 物件工廠 (engine/factory.js)
├── T4: Tick scheduler (engine/tick-scheduler.js) — 加 stop() + skip-not-queue 補點 (H4, M7, M4)
├── T5: Dispatcher (engine/dispatcher.js) — 加 subscribeAll / unsubscribeAll (H3)
├── T7: i18n loader + 雙語字典
└── T8: 主題 CSS 變數系統 (基於 T0 tokens)

Wave 1.5 (Skeleton + State — 依賴 T1+T2, 2 tasks):
├── T3: Lot lifecycle skeleton (engine/skeleton.js) — BlockedBy T1, T2
└── T6: SimulationState 中央 store (engine/state.js) — 含 suppressOverrides + epochCarryover (C2, H2, I3, I4)

Wave 2 (Shell — 入口 + 頂部 + 導航 + 元件, 6 tasks):
├── T9: Import map + index.html shell + D3 vendor fallback (C1, C3) — BlockedBy T0, T7, T8
├── T10: 左側模組 nav — BlockedBy T0, T9
├── T11: 頂部 KPI 帶 — BlockedBy T0, T6, T9
├── T12: 頂部事件河 — BlockedBy T0, T5, T6, T9 (M5: 50→15 chips + priority lane)
└── T14: 共用元件 (Button/Card/Dialog/Toast/Sparkline/Table) — BlockedBy T0, T9 (M6: 固定 36px 列高)

Wave 2.5 (Router):
└── T13: 主內容區 SPA router — BlockedBy T4, T9, T10, T11, T12, T14 (H4: module contract 強制 .interrupt())

Wave 3a (Modules 1-5, 5 tasks):
├── T15: MES — BlockedBy T2, T3, T5, T6, T13, T14
├── T16: APS — BlockedBy T2, T3, T5, T6, T13, T14
├── T17: ERP — BlockedBy T2, T5, T6, T13, T14
├── T18: SPC — BlockedBy T2, T3, T5, T6, T13, T14 (I4: carryover)
└── T19: APC — BlockedBy T2, T5, T6, T13, T14

Wave 3b (Modules 6-9, 4 tasks):
├── T20: WIP — BlockedBy T2, T3, T5, T6, T13, T14
├── T21: SCM — BlockedBy T2, T5, T6, T13, T14
├── T22: Recipe — BlockedBy T2, T5, T6, T13, T14 (I2: 訂閱 recipe.changed)
└── T23: Yield/Defect — BlockedBy T2, T5, T6, T13, T14 (I3: emit yield.alert, M6: 固定列高)

Wave 4 (Integration + 樣式打磨, 5 tasks):
├── T24: 模組間 cross-cutting — BlockedBy T13, T15-T23
├── T25: 報表頁淺色主題整合 — BlockedBy T0, T24
├── T26: 動畫 polish — BlockedBy T0, T24 (M3: 改 choreographed 1.2s, 非 body fade)
├── T27: Performance pass — BlockedBy T0, T24
└── T33: 響應式版面 (monitoring-first) — BlockedBy T24, Blocks F1-F4 (5C/5C-A)

Wave 5 (Resilience + Hero + Deploy — 4 tasks, 解決 9 個專家 finding):
├── T28: D3 vendor fallback + 動態 import (C1, C3) — BlockedBy T9
├── T29: Skeleton-user conflict resolver (C2) — BlockedBy T5, T6, T13
├── T30: Hero scenario 編排 (M2, tick-driven) — BlockedBy T0, T13, T15-T23
└── T31: Deploy (git init + static host) — BlockedBy T9, Blocks F5

Wave FINAL (4 parallel reviews + 1 sequential-after post-deploy smoke):
├── F1: Plan compliance audit
├── F2: Code quality review
├── F3: Real Playwright QA
├── F4: Scope fidelity check
└── F5: Post-deploy smoke test (sequential-after — BlockedBy T31 + F1-F4)

Critical Path: T32 → T2 → T3 → T15-T23 → T24 → F1-F4; deploy 分支 T31 → F5
Parallel Speedup: ~75% faster than sequential
Max Concurrent: 9 (Wave 3)
```

### Dependency Matrix
```
T0 -  -  T8,T9,T10,T11,T12,T14,T25,T26,T27,T30
T1 -  -  T2,T3,T4,T5,T6
T2 T1,T32 -  T3,T6,T15-T23
T3 T1,T2,T32 - T6,T15-T23
T4 T1 -  T13
T5 T1 - T12,T15-T23,T29
T6 T1,T2 - T11,T12,T15-T23,T29
T7 -  -  T9
T8 T0 -  T9
T9 T0,T7,T8 - T10,T11,T12,T14,T28,T31
T10 T0,T9 - T13
T11 T0,T6,T9 - T13
T12 T0,T5,T6,T9,T32 - T13
T13 T4,T9,T10,T11,T12,T14 - T15-T23,T29,T30
T14 T0,T9 - T15-T23
T15-T23 T2,T3,T5,T6,T13,T14,T32 - T24,T30
T24 T13,T15-T23 - T25,T26,T27
T25,T26,T27 T0,T24 - T30
T28 T9 - F1-F4
T29 T5,T6,T13 - F1-F4
T30 T0,T13,T15-T23,T25,T26,T27,T32 - F1-F4
T31 T9 - F5
T32 - - T2,T3,T12,T15-T23,T30
T33 T24 - F1-F4
F1-F4 (各自 deps) - F5
F5 T31,F1,F2,F3,F4 - -
```

### Agent Dispatch Summary
- **Wave 1** (7 tasks: T32, T1, T2, T4, T5, T7, T8): mostly `quick` (engine + scenario manifest) + 1 `artistry` (theme system)
- **Wave 1.5** (2 tasks: T3, T6): `unspecified-high` / `quick`
- **Wave 2** (5 tasks: T9, T10, T11, T12, T14): `quick` + 1 `visual-engineering` (nav)
- **Wave 2.5** (1 task: T13): `unspecified-high` (router)
- **Wave 3a** (5 tasks: T15-T19): `visual-engineering` + `unspecified-high`
- **Wave 3b** (4 tasks: T20-T23): `visual-engineering` + `unspecified-high`
- **Wave 4** (4 tasks: T24-T27): `unspecified-high` + `artistry` + `unspecified-high`
- **Wave 5** (4 tasks: T28, T29, T30, T31): `unspecified-high` + `visual-engineering` (hero) + `unspecified-high`+playwright (deploy)
- **FINAL** (4 parallel reviews F1-F4 + 1 sequential-after F5): `oracle` / `unspecified-high` / `unspecified-high`+playwright / `deep` / `unspecified-high`+playwright (F5 post-deploy)

---

## TODOs

> Implementation + Test = ONE Task. Never separate.
> EVERY task MUST have QA Scenarios.
> Format: bare numbers (`1.`, `2.`, ...) — NOT `T1.`, `Phase 1:`, `Task-1.`
> Final Wave: `F1.`, `F2.`, ...

- [ ] 0. Design tokens 系統 (styles/tokens.css)

  **What to do (M1 fix — 9 模組的視覺統一基石)**:
  - 定義 CSS custom properties in `styles/tokens.css`:
    - **Type scale**: `--fs-caption: 11px`, `--fs-body: 13px`, `--fs-subtitle: 15px`, `--fs-title: 20px`, `--fs-kpi: 32px`
    - **Font weights**: `--fw-body: 400`, `--fw-emphasis: 600`, `--fw-kpi: 700`
    - **Spacing scale**: `--sp-1: 4px`, `--sp-2: 8px`, `--sp-3: 12px`, `--sp-4: 16px`, `--sp-5: 24px`, `--sp-6: 32px`, `--sp-7: 48px`
    - **Border radius**: `--r-sharp: 0` (tables/data), `--r-card: 4px` (cards/buttons), `--r-dialog: 8px` (modals)
    - **Shadow scale**: `--sh-sm: 0 1px 2px rgba(0,0,0,0.2)`, `--sh-md: 0 4px 12px rgba(0,0,0,0.3)`, `--sh-lg: 0 12px 32px rgba(0,0,0,0.4)`
    - **Status LEDs**: **【6A 修】** 色點 + **形狀差異** (●正常 / ▲警告 / ■故障),色弱可辨;顏色對應 `--success/--warn/--danger/--accent/--idle`。全計畫一致採形狀差異 (●▲■),不靠純色區分
    - **Chart spec**: axis 10px Inter, grid 1px `var(--grid)`, tooltip 12px, transition 200ms ease
    - **Table spec**: row-height 36px (固定), cell-padding 8px 12px, header weight 600, zebra `var(--bg-elevated)`
    - **【4A 修】Typography tokens**: `--font-body: 'IBM Plex Sans', 'PingFang TC', 'Microsoft JhengHei', 'Noto Sans CJK TC', sans-serif`、`--font-mono: 'JetBrains Mono', ui-monospace, monospace`
    - **【3A 修】Brand tokens**: `--brand-name: 'FAB MOM'` (暫代,品牌定案後換);brand mark 規格 = `currentColor`, 24px (單色幾何 SVG mark,渲染於 `#nav-left` 48px 槽)
  - **【4A 修】新增交付物 `vendor/fonts/`**: self-host IBM Plex Sans woff2 (400/600) 與 JetBrains Mono woff2 (400/700),於 `tokens.css` 定義 `@font-face` + `font-display: swap`。**明文禁止任何 CDN 字體載入 (Google Fonts 等) — 離線 fallback 是硬需求。** CJK 不自帶 (走系統棧),理由:TC subset 數 MB + 需 build 流程,違反 no-bundler
  - 同時建立 Lucide icon sprite (挑 30 個常用 icon, SVG 1.5px stroke, 20px, currentColor)
  - 全部模組必須 import 這個檔案, 不可自行發明
  - **完成 tokens.css 時同步產出 `DESIGN.md` (repo root)**,記錄規格:type scale / spacing / color / component specs (delta 3 既有四類) — 滿足 CLAUDE.md「視覺決策必讀 DESIGN.md」規則 (該檔目前不存在)。**【DESIGN.md spec 修】產出清單擴充加入**:品牌槽規格 (48px 槽 + brand mark currentColor 24px + `--brand-name`)、字體棧 (`--font-body` / `--font-mono` + `vendor/fonts/` self-host + 禁 CDN)、互動狀態矩陣參照 (連結「## 互動狀態規格」5 態通則)、viewport 三斷點矩陣 (≥1366 / 768-1365 / <768, 見 T33)、a11y 規則 (aria-live 配置 / LED 形狀 ●▲■ / 觸標 ≥44px)

  **Must NOT do**:
  - 不允許模組自定義字級/間距
  - 不用 emoji 當 icon
  - 不用線上 icon font (避免 CORS/延遲)

  **Recommended Agent Profile**:
  - **Category**: `artistry` (設計品質)
  - **Skills**: 無
  - **Skills Evaluated but Omitted**:
    - `playwright`: 純 CSS, 無瀏覽器互動

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 0
  - Blocks: T8, T9, T10, T11, T12, T14, T25, T26, T27, T30
  - Blocked By: None

  **References**: 無 (新檔案)

  **Acceptance Criteria**:
  - [ ] tokens.css 匯出 5 種字級 + 7 種間距 + 3 種陰影 + 2 種圓角 + 30 個 Lucide SVG sprite
  - [ ] 任何後續 task grep `--fs-` `--sp-` `--r-` `--sh-` 都能在 tokens.css 找到定義
  - [ ] Playwright 載入後 `getComputedStyle(document.documentElement).getPropertyValue('--fs-kpi')` 回傳 `32px`
  - [ ] `DESIGN.md` 存在於 repo root,且涵蓋 type scale / spacing / color / component specs 四類規格,並含品牌槽 / 字體棧 / 互動狀態矩陣參照 / viewport 三斷點矩陣 / a11y 規則 (DESIGN.md spec 修)
  - [ ] (3A) `getComputedStyle(document.documentElement).getPropertyValue('--brand-name')` 回傳 `'FAB MOM'`
  - [ ] (4A) `vendor/fonts/` 存在 4 個 woff2 (IBM Plex Sans 400/600 + JetBrains Mono 400/700),tokens.css 含 `@font-face` + `font-display: swap`,無任何 CDN 字體 URL
  - [ ] (4A) offline 模式 (`page.context().setOffline(true)`) 下字體仍渲染 (self-host woff2,套用至 T28 / F3 offline 檢查)

  **QA Scenarios**:
  ```
  Scenario: token 可解析
    Tool: Playwright
    Preconditions: http server 跑起來
    Steps:
      1. page.goto('http://localhost:8000/')
      2. page.evaluate(() => ['--fs-kpi','--sp-4','--r-card','--sh-md'].map(k => getComputedStyle(document.documentElement).getPropertyValue(k)))
    Expected Result: 4 個值都非空 (e.g. "32px", "16px", "4px", "...")
    Evidence: .omo/evidence/task-0-tokens.json

  Scenario: 無模組自定義字級
    Tool: ast_grep_search
    Steps:
      1. ast_grep_search pattern "font-size: $VAL px" lang "css" paths ["styles/modules.css", "modules"]
      2. 確認 0 hits (應全部用 var(--fs-*))
    Evidence: .omo/evidence/task-0-no-raw-fontsize.txt
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/task-0-tokens.json`
  - [ ] `.omo/evidence/task-0-no-raw-fontsize.txt`

  **Commit**: YES
  - Message: `feat(styles): design token system (type/spacing/shadow/radius/icon)`
  - Files: `styles/tokens.css`
  - Pre-commit: 跑過上面兩個 QA scenario

---

- [ ] 32. Scenario Manifest 邊界 (scenarios/mom-fab.js)

  **What to do (引擎/內容分離邊界 — Approach C 核心)**:
  - 建立 `scenarios/mom-fab.js` — **純資料模組,零依賴** (不 import 任何引擎模組), 承載三類內容:
    - **(a) 領域常數**:
      - 5 products (LOGIC-A, LOGIC-B, MEM-DDR, MEM-NAND, RF-GaN)
      - 8 tool groups (Photolithography / Etch / CVD / PVD / CMP / Implant / Inspection / WetClean)
      - defect types 清單
      - 25 wafers/lot
      - KPI 閾值 (yield/throughput/oee 等門檻)
    - **(b) hero story timeline — 以 tick 為單位** (t+0/10/18/25/30 tick, 非 wall-clock 秒): 每個步驟綁定模組切換 + 高亮目標; **defect 注入綁定特定 tick** (保 PRNG 確定性)
    - **(c) 事件類型→模組路由表** (例: lot.start → MES, spc.violation → SPC, defect.detected → Yield ...)
  - 所有模組/引擎的領域常數一律 `import` 自本檔, 不在各模組寫死

  **Must NOT do (寫入計畫,使 F4 可強制執行)**:
  - 不做 plugin 系統
  - 不做 DSL
  - 不做多 scenario 載入器
  - 僅一層 JS/JSON 參數化 (single layer)

  **Recommended Agent Profile**:
  - **Category**: `quick` — 純資料, 無 UI / 無演算法
  - **Skills**: 無
  - **Skills Evaluated but Omitted**:
    - `playwright`: 純資料模組, 無瀏覽器互動

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (與 T1 平行)
  - Blocks: T2, T3, T12, T15-T23, T30
  - Blocked By: None

  **References**: 無 (新檔案 — 葉節點純資料, 不依賴任何引擎模組, 無環)

  **Acceptance Criteria**:
  - [ ] `scenarios/mom-fab.js` 匯出 5 products / 8 tool groups / defect types / 25 wafers per lot / KPI 閾值
  - [ ] hero story timeline 以 tick 為單位 (t+0/10/18/25/30), defect 注入綁定特定 tick
  - [ ] 匯出事件類型→模組路由表
  - [ ] 零依賴: grep `import` 在本檔為 0 hits (不引入任何引擎模組)
  - [ ] 無 plugin / DSL / 多 scenario 載入器 — 僅一層 JS/JSON 參數化

  **QA Scenarios**:
  ```
  Scenario: manifest 純資料完整性
    Tool: Bash (node)
    Steps:
      1. node -e "import('./scenarios/mom-fab.js').then(m => { console.log(m.products.length, m.toolGroups.length, m.heroTimeline.length); })"
    Expected Result: products === 5, toolGroups === 8, heroTimeline 有 5 個 tick 步驟
    Evidence: .omo/evidence/task-32-manifest.txt

  Scenario: 零依賴檢查
    Tool: ast_grep_search
    Steps:
      1. ast_grep_search pattern "import $$$ from $SRC" lang "javascript" path "scenarios/mom-fab.js"
    Expected Result: 0 hits (純資料, 無 import)
    Evidence: .omo/evidence/task-32-no-imports.txt
  ```

  **Commit**: YES
  - Message: `feat(scenario): mom-fab scenario manifest (domain constants + hero timeline + routing)`
  - Files: `scenarios/mom-fab.js`
  - Pre-commit: 跑過上面兩個 QA scenario

---

- [ ] 1. PRNG + 雜湊引擎 (engine/prng.js)

  **What to do**:
  - 實作 `mulberry32(seed)` function: `function mulberry32(a) { return function() { a |= 0; a = a + 0x6D2B79F5 | 0; var t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; } }`
  - 實作 `fnv1a(str)` 雜湊: 32-bit FNV-1a，回傳 unsigned int
  - 實作 `deriveSeed(namespace, id)`: 用 `fnv1a(namespace + ':' + id)` 作為 base seed，搭配 epoch seed 做 XOR
  - **【H1 修】** 實作 `deriveTickSeed(domain, tick)`: 為每個 data domain (例: `"spc.xbar"`, `"defect.xy"`, `"alarm"`, `"apc.ewma"`, `"fdc.pressure"`, `"yield.trend"`) 產生**獨立** PRNG stream。公式: `mulberry32(fnv1a(domain + ':' + tick) ^ SEED_BASE ^ epochSeed)`。這保證 SPC 抖動、defect 抖動、alarm 抖動在同一 tick 內統計獨立，但仍完全確定性
  - 實作 `hashRandomLot()`、`hashRandomEquipment()`、`hashRandomRecipe()`: 利用 `fnv1a` 從 `lotId`/`equipmentId`/`recipeId` 推出 deterministic 的 lot type/cycle time/priority
  - 模組匯出 5 個函式 (`mulberry32`, `fnv1a`, `deriveSeed`, `deriveTickSeed`, `hashRandomXxx`) + 1 個常數 `SEED_BASE = 0x5FAB300`
  - 純函式，無副作用，無外部依賴

  **Must NOT do**:
  - 不可使用 `Math.random()` / `Date.now()` / `crypto.getRandomValues()`
  - 不可引入第三方庫

  **Recommended Agent Profile**:
  - **Category**: `quick` — 純演算法，無 UI
  - **Skills**: 預設無
  - **Skills Evaluated but Omitted**:
    - `playwright`: 純邏輯，無瀏覽器互動

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1 (with T2-T9)
  - Blocks: T2, T3, T4, T5, T6, T9
  - Blocked By: None

  **References**:
  - Pattern: 無 (新模組)
  - External: Mulberry32 reference: https://gist.github.com/tommyettinger/46a3d4a8b53b7df4e8d0 (純演算法參考)
  - WHY: 確定性 PRNG 是整個模擬可重播的基石

  **Acceptance Criteria**:
  - [ ] `mulberry32(42)()` 連續呼叫 1000 次，最後一個值 = 0.6220339... (公開 reference value)
  - [ ] `fnv1a("")` = 0x811c9dc5
  - [ ] `fnv1a("a")` = 0xe40c292c
  - [ ] `deriveSeed("lot", "L-001")` 對相同輸入回傳相同值
  - [ ] `ast_grep_search` 確認 `Math.random` / `Date.now` / `crypto.getRandomValues` 在 `engine/prng.js` 為 0 hits

  **QA Scenarios**:
  ```
  Scenario: PRNG 確定性驗證
    Tool: Bash (node REPL)
    Preconditions: node 已安裝，prng.js 存在
    Steps:
      1. node -e "import('./engine/prng.js').then(m => { const r = m.mulberry32(42); const arr = []; for(let i=0;i<1000;i++) arr.push(r()); console.log(arr[arr.length-1]); })"
      2. 預期輸出末值 = 0.6220339... (與 reference 對齊)
    Expected Result: 輸出末值與 reference 一致 (容差 1e-6)
    Failure Indicators: 末值差異 > 1e-6，或拋 exception
    Evidence: .omo/evidence/task-1-prng-determinism.txt

  Scenario: 禁用 API 掃描
    Tool: Bash (grep_app_searchGitHub 本地版 — ast_grep)
    Steps:
      1. ast_grep_search pattern "Math.random()" path "engine/prng.js"
      2. ast_grep_search pattern "Date.now()" path "engine/prng.js"
      3. ast_grep_search pattern "crypto.getRandomValues" path "engine/prng.js"
    Expected Result: 三項皆 0 matches
    Evidence: .omo/evidence/task-1-no-banned-api.txt
  ```

  **Evidence to Capture**:
  - [ ] `.omo/evidence/task-1-prng-determinism.txt`
  - [ ] `.omo/evidence/task-1-no-banned-api.txt`

  **Commit**: YES
  - Message: `feat(engine): mulberry32 PRNG + fnv1a hash for deterministic simulation`
  - Files: `engine/prng.js`
  - Pre-commit: 跑過上面兩個 QA scenario

---

- [ ] 2. 物件工廠 (engine/factory.js)

  **What to do**:
  - 匯出 `createProduct(id)`: 從 5 個產品 (LOGIC-A, LOGIC-B, MEM-DDR, MEM-NAND, RF-GaN) 隨機選一個起點；含 recipeCount, priority
  - 匯出 `createLot(id, product)`: 從 product + fnv1a(id) 推出 lot size (25 wafer), priority, route (BOM 步驟序列), startStep
  - 匯出 `createEquipment(id)`: 從 100 個 tool 推 group (Photolithography / Etch / CVD / PVD / CMP / Implant / Inspection / WetClean), cycleTime
  - 匯出 `createRecipe(id, product)`: 從 product 的 step list 衍生每步的 chamber/gas/temp/time
  - 匯出 `createToolGroup(id)`: 群組 (例: 「光刻組」含 ASML-NXT, ASML-i-line, Nikon-NSR)
  - 100 lot, 100 tool, 50 recipe 預生成資料，回傳 Map<string, Object>

  **Must NOT do**: 不使用 banned API

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: 無

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 1
  - Blocks: T3, T15-T23
  - Blocked By: T1, T32

  **References**: T1 (prng.js), T32 (scenarios/mom-fab.js)

  **Acceptance Criteria**:
  - [ ] `createLot("L-001", LOGIC-A)` 回傳 `{id, product, wafers:25, priority:1-5, route:[...stepIds], startTick:0-179}`
  - [ ] `createLot("L-001", LOGIC-A)` 兩次呼叫結果 deep-equal
  - [ ] 100 lot 全部 `wafers === 25`
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)

  **QA Scenarios**:
  ```
  Scenario: Lot 確定性
    Tool: Bash (node)
    Steps:
      1. node -e "import('./engine/factory.js').then(m => { const a = m.createLot('L-001','LOGIC-A'); const b = m.createLot('L-001','LOGIC-A'); console.log(JSON.stringify(a)===JSON.stringify(b)); })"
    Expected Result: 輸出 `true`
    Evidence: .omo/evidence/task-2-lot-determinism.txt

  Scenario: 規模檢查
    Tool: Bash (node)
    Steps:
      1. import factory, 呼叫 100 次 createLot, 計算 wafers 總和
    Expected Result: 2500 (100 lot × 25 wafer)
    Evidence: .omo/evidence/task-2-scale.txt
  ```

  **Commit**: YES — `feat(engine): object factory for product/lot/equipment/recipe`

---

- [ ] 3. Lot lifecycle skeleton 生成 (engine/skeleton.js)

  **What to do**:
  - 匯出 `generateSkeleton(lots, equipment, recipes)`: 回傳 180-tick 陣列 `Array<{tick, events: Array<LotEvent>}>`
  - 每個 lot 在 skeleton 中有一序列的 start/step-transition/move/complete 事件，時間點 deterministic (由 lot id 透過 fnv1a → mulberry32)
  - 啟發式: **100 lots** (I1 統一) 平均分配 180 ticks，每 lot 約 2-5 個 step event，預期總計約 300-500 step transition / 100 wafer move / 100 lot complete
  - 不可在這裡生成 SPC 點、defect、alarm (這些是 per-tick jitter)
  - **【C2 修】** 每個 LotEvent 標記 `suppressible: true` 與 `lotId`。Dispatcher 發送前會查 `state.suppressOverrides`，若該 lot 被使用者 Hold/Scrap，則 suppress 該 lot 全部 suppressible 事件
  - 匯出 `getLotAtTick(skeleton, lotId, tick)`: 給定 lot + tick，回傳 lot 當下的狀態 (currentStep, currentEquipment, qTime)

  **Must NOT do**: 不在 skeleton 中生成隨機細節 (alarm、defect、SPC 點)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: 無

  **Parallelization**: Wave 1.5, Blocks T5, T15-T23, BlockedBy T1, T2, T32

  **References**: T1, T2, T32 (scenarios/mom-fab.js)

  **Acceptance Criteria**:
  - [ ] skeleton 長度 === 180
  - [ ] 每個 lot 在 skeleton 中至少有 1 個 start + 1 個 complete 事件
  - [ ] 啟動一次後 `JSON.stringify(skeleton)` 兩次輸出 deep-equal
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)

  **QA Scenarios**:
  ```
  Scenario: skeleton 完整
    Tool: Bash (node)
    Steps:
      1. 生成 skeleton, 統計 tick=0 與 tick=179 的 events 數量, 應 > 0
    Expected Result: tick=0 events ≥ 5 (lots starting), tick=179 events ≥ 5 (lots completing)
    Evidence: .omo/evidence/task-3-skeleton-population.txt
  ```

  **Commit**: YES — `feat(engine): 180-tick lot lifecycle skeleton generator`

---

- [ ] 4. Tick scheduler + wall clock 補點 + fade 轉場 (engine/tick-scheduler.js)

  **What to do**:
  - 匯出 `class TickScheduler`:
    - `start(onTick, onEpochEnd)`: 啟動 setInterval(1000ms)
    - **【M7 修】** `stop()`: clearInterval，釋放 callback 參照
    - `pause()` / `resume()`: 暫停 / 恢復
    - **【M4 修】** `onVisibilityChange()`: 改用 **skip-not-queue** 補點 — 計算 targetTick = floor(elapsed/1000) % 180，直接呼叫 onTick(targetTick) **一次**，不連發。慢機器/背景 tab 不會造成 tick 雪崩
    - `setEpochLength(180)`: 設定長度
    - 屬性: `currentTick`, `epochStartTime` (performance.now())
  - 在 epoch 結束 (tick 179→0) 觸發 `onEpochEnd`，呼叫方負責 1.2s choreographed 轉場 (見 T26)
  - **【M3 修】** 1.2s choreographed: onEpochEnd 觸發時依序 (1) KPI 數字 → 0 over 0.3s, (2) event river chips slide out left 0.3s, (3) content crossfade 0.3s, (4) KPI 反向 0 0.5s, (5) event river 重填
  - 使用 `performance.now()` 不用 `Date.now()`
  - **【4A 修 — epoch-reset 序列規範 (由 TickScheduler 擁有)】** tick 179→0 時依序執行下列 6 步;此 ASCII 狀態圖**必須同時以註解形式複製到 `engine/tick-scheduler.js`**:
    - (1) freeze dispatcher emits (凍結事件發送)
    - (2) `state.snapshotForEpochReset()` (H2 carryover 快照)
    - (3) `state.suppressOverrides.clear()` (T29 epoch-scoped 使用者動作清除)
    - (4) `currentTick = 0`,更新 new `epochSeed`
    - (5) 1.2s choreographed 轉場 (T26) 播放
    - (6) resume emits,tick 0 事件照常發送
    ```
    tick 179 末
       │ freeze emits
       ▼
    [SNAPSHOT] state.snapshotForEpochReset()   ← H2 carryover (SPC/yield/FDC tails)
       │
       ▼
    [CLEAR]    state.suppressOverrides.clear() ← T29 epoch-scoped user actions
       │
       ▼
    [RESET]    currentTick=0, epochSeed 更新
       │
       ▼
    [CHOREO]   1.2s choreographed 轉場 (T26)    ← emits 凍結中
       │ choreography 完成
       ▼
    [RESUME]   resume emits → tick 0 正常發送
    ```
    **順序理由**: snapshot 先於 clear (否則被 Hold 的 lot 在 carryover 裡復活);snapshot 先於 reset (否則拿到空資料閃空)。

  **Must NOT do**: 不用 `Date.now()`，不用 `requestAnimationFrame` 推進 tick

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: 無

  **Parallelization**: Wave 1, Blocks T13, T24, BlockedBy T1

  **References**: T1

  **Acceptance Criteria**:
  - [ ] `setInterval` 每 1000ms 觸發一次 onTick
  - [ ] 啟動後 5s 內 currentTick 從 0 → 5
  - [ ] 觸發 180 次後 onEpochEnd 被呼叫一次
  - [ ] 程式碼搜尋確認無 `Date.now` / `new Date()`

  **QA Scenarios**:
  ```
  Scenario: Tick 推進
    Tool: Playwright (page.evaluate + setTimeout)
    Preconditions: index.html 載入, scheduler 已 start
    Steps:
      1. page.evaluate(() => window.__SIM.scheduler.currentTick) → 預期 0
      2. setTimeout 5500ms
      3. page.evaluate(() => window.__SIM.scheduler.currentTick) → 預期 4-6 之間
    Expected Result: tick 確實推進
    Evidence: .omo/evidence/task-4-tick-advances.png + .json

  Scenario: Epoch loop
    Tool: Playwright
    Steps:
      1. 把 epochLength 暫時設為 3 (加速測試)
      2. 等 4s, 確認 onEpochEnd 被呼叫
      3. 確認 currentTick 重置為 0
    Expected Result: epoch 正常 loop, fade 觸發
    Evidence: .omo/evidence/task-4-epoch-loop.png

  Scenario: visibilitychange skip-not-queue
    Tool: Playwright
    Steps:
      1. 模擬 page hidden 10s 後再 visible (觸發 visibilitychange)
      2. 斷言 currentTick 一次跳補到 targetTick (= floor(elapsed/1000) % 180)
      3. 確認 onTick 未連發 (無 tick 雪崩)
    Expected Result: 補點一次到位, 不連發
    Evidence: .omo/evidence/task-4-visibility-catchup.json
  ```

  **Commit**: YES — `feat(engine): tick scheduler with wall clock catchup`

---

- [ ] 5. Dispatcher 事件發送器 (engine/dispatcher.js)

  **What to do**:
  - 匯出 `class Dispatcher`:
    - 訂閱: `subscribe(eventType, callback)` → unsubscribe handle
    - **【H3 修】** `subscribeAll(owner, {eventType: callback, ...})`: 將多個訂閱綁定到 owner，自動追蹤
    - **【H3 修】** `unsubscribeAll(owner)`: 一次解除 owner 全部訂閱，防止模組切換累積殘留 closure
    - 發送: `emit(eventType, payload)`
    - 支援事件類型: `lot.start`, `lot.complete`, `step.transition`, `equipment.alarm`, `equipment.idle`, `spc.violation`, `apc.adjustment`, `defect.detected`, `recipe.changed`, `yield.alert`, `po.received`, `material.in_transit`
  - 內部不存任何狀態，純 pub/sub 結構 (僅 dispatcher 內部使用，不對外暴露為 EventBus)
  - 在每 tick 從 skeleton 與 per-tick seed 衍生事件 emit 給訂閱者

  **Must NOT do**: 不暴露為全域 EventBus，dispatcher 實例由 SimulationController 持有

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, Blocks T12, T15-T23, BlockedBy T1

  **References**: T1

  **Acceptance Criteria**:
  - [ ] subscribe 與 emit 正常運作
  - [ ] 10 個訂閱者 emit 一次後 10 個 callback 都收到

  **QA Scenarios**:
  ```
  Scenario: pub/sub 基本
    Tool: Bash (node)
    Steps:
      1. import Dispatcher, 建立實例, subscribe "lot.start" 計數, emit 3 次
    Expected Result: 計數 === 3
    Evidence: .omo/evidence/task-5-pubsub.txt

  Scenario: subscribeAll / unsubscribeAll
    Tool: Bash (node)
    Steps:
      1. owner 透過 subscribeAll 綁 3 個訂閱
      2. unsubscribeAll(owner)
      3. emit 對應事件, 記錄 callback 計數
    Expected Result: unsubscribeAll 後 emit 計數不增 (殘留 closure 已清除)
    Evidence: .omo/evidence/task-5-unsubscribe-all.txt
  ```

  **Commit**: YES — `feat(engine): event dispatcher with typed events`

---

- [ ] 6. SimulationState 中央 store (engine/state.js)

  **What to do**:
  - 匯出 `class SimulationState`:
    - 屬性: `lots: Map`, `equipment: Map`, `recipes: Map`, `spcSamples: Array<{tick, product, parameter, value}>` (capped at 50 per product×param, FIFO), `defects: Array<{tick, lotId, x, y, type}>` (capped at 500), `alarms: Array`, `kpis: {wip, throughput, yield, mtbf, oee}`
    - **【C2 修】** `suppressOverrides: Map<lotId, {status: 'hold'|'scrap'|'complete', until: tick}>`: 使用者按鈕觸發的狀態覆寫。Dispatcher 發送 suppressible 事件前查表，若 lot 在 override 名單內則跳過
    - **【H2 修】** `epochCarryover: {spcTail: Array, yieldTail: Array, fdcTail: Array}`: epoch 結束時快照最近 50 個 SPC/良率/FDC 點，新 epoch 起始時 prepend 進對應 chart 的 buffer
    - 方法: `updateLot(lotId, patch)`, `addSpcSample(sample)` (含 FIFO trim), `addDefect(d)` (含 FIFO trim), `pushAlarm(alarm)`, `recomputeKpis()`, `setOverride(lotId, status, untilTick)`, `clearOverride(lotId)`, `snapshotForEpochReset()`
    - 無 reactive proxy (不需要 — modules 直接呼叫 method)
    - 在每 tick 結尾呼叫 `recomputeKpis()`

  **Must NOT do**: 無 reactive proxy / Proxy handler (避免 ES2022 性能陷阱)

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1.5, Blocks T11, T12, T15-T23, BlockedBy T1, T2

  **References**: T1, T2, T3

  **Acceptance Criteria**:
  - [ ] 100 lot 全部放進 `state.lots` 後 `state.lots.size === 100`
  - [ ] `recomputeKpis()` 後 `state.kpis.wip` 為正整數

  **QA Scenarios**:
  ```
  Scenario: 規模資料裝載
    Tool: Bash (node)
    Steps:
      1. import factory + state, 裝載 100 lot, 檢查 state.lots.size
    Expected Result: === 100
    Evidence: .omo/evidence/task-6-load.txt

  Scenario: epochCarryover snapshot + FIFO caps
    Tool: Bash (node)
    Steps:
      1. addSpcSample 裝入 60 個 SPC 樣本 (同 product×param), 斷言 FIFO cap === 50
      2. 呼叫 snapshotForEpochReset(), 斷言回傳最近 50 點 tail
    Expected Result: cap 維持 50, snapshot 為最近 50 點 tail
    Evidence: .omo/evidence/task-6-carryover-fifo.txt
  ```

  **Commit**: YES — `feat(engine): central simulation state store`

---

- [ ] 7. i18n loader + 雙語字典 (i18n/zh-TW.json + i18n/en-US.json + i18n/index.js)

  **What to do**:
  - 兩個 JSON 字典，含所有 UI 字串 key (例: `nav.mes`, `mes.lot_id`, `mes.lot_status`, `kpi.wip`, `event.lot.start`...)
  - `i18n/index.js` 匯出 `setLocale(loc)`, `t(key)`, `getLocale()`, 內存當前 locale
  - 預設 locale = `zh-TW`，混合標籤格式: `"Yield Management / 良率管理"` (en) vs `"良率管理 / Yield Management"` (zh)
  - DOM 整合: 啟動時掃描 `[data-i18n]` 元素，呼叫 `t(key)` 設 textContent
  - 切換 locale 時重掃所有 `[data-i18n]`
  - **【6A 修】** `setLocale()` 尾端呼叫 `router.refreshActive()` 強制現行模組重走 `update` 全量 reconcile,使 D3 圖表文字 (軸標籤/legend/tooltip) 同步換語言 (純 `[data-i18n]` 掃描不及 SVG 內文)
  - **【7A 修】** `t(key)` 缺 key 行為: 回傳 key 本身 + `console.warn` (per-key 去重,同一 key 只警告一次)

  **Must NOT do**: 不使用外部 i18n 庫 (i18next)，手刻極簡版即可

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, Blocks T9, T10-T14, T15-T23, BlockedBy None

  **References**: 無 (新模組)

  **Acceptance Criteria**:
  - [ ] `t("nav.mes")` 在 zh-TW 回傳 `「MES / 製造執行系統」` 或類似
  - [ ] `setLocale("en-US")` 後再次 `t("nav.mes")` 回傳英文
  - [ ] 兩個 JSON 字典所有 key 完全對齊 (用 node script 驗證)
  - [ ] (6A) `setLocale()` 觸發 `router.refreshActive()`,現行模組 D3 圖表軸標籤/legend/tooltip 文字隨之換語言
  - [ ] (7A) `t('nonexistent.key')` 回傳 `'nonexistent.key'` 本身,且 `console.warn` 對同一 key 僅警告一次 (重複呼叫不重複 warn)
  - [ ] (2A) `states.*` keys (loading / empty / error / partial 各模組文案,含 EMPTY 確定性預告) 雙語對齊,兩 JSON key 集合相同

  **QA Scenarios**:
  ```
  Scenario: 雙語一致性
    Tool: Bash (node)
    Steps:
      1. 載入兩個 JSON, 比較 key 集合, 應完全相同
    Expected Result: 兩 JSON 的 key 集合 === (差集 = ∅)
    Evidence: .omo/evidence/task-7-i18n-keys.txt

  Scenario: locale 切換圖表文字 (6A)
    Tool: Playwright
    Steps:
      1. 切到 SPC 模組
      2. setLocale('en-US') (觸發 router.refreshActive())
      3. 斷言 D3 圖表軸標籤文字已改變
    Expected Result: 圖表文字隨 locale 切換
    Evidence: .omo/evidence/task-7-locale-chart.png

  Scenario: 缺 key 降級 (7A)
    Tool: Bash (node) / Playwright
    Steps:
      1. t('nonexistent.key') → 斷言回傳 'nonexistent.key' 本身
      2. 斷言 console 出現一次 warn
      3. 重複呼叫 t('nonexistent.key'), 斷言不再 warn (per-key 去重)
    Expected Result: 回傳 key 本身, 僅 warn 一次
    Evidence: .omo/evidence/task-7-missing-key.txt
  ```

  **Commit**: YES — `feat(i18n): bilingual zh-TW/en-US dictionaries + loader`

---

- [ ] 8. 主題 CSS 變數系統 (styles/theme.css)

  **What to do**:
  - CSS custom properties on `:root` (深色) 與 `:root[data-theme="light"]` (淺色)
  - 深色: `--bg-primary: #0a1428`, `--bg-elevated: #142840`, `--text-primary: #e8f1ff`, `--accent: #00d4ff`, `--warn: #ffb547`, `--danger: #ff4d6d`, `--grid: rgba(0,212,255,0.08)`
  - 淺色 (用於報表頁): `--bg-primary: #f8fafc`, `--bg-elevated: #ffffff`, `--text-primary: #1a2332`, `--accent: #0066cc`, `--grid: rgba(0,0,0,0.05)`
  - 工具 class: `.btn`, `.btn-primary`, `.btn-ghost`, `.card`, `.kpi-card`, `.dialog`, `.badge`, `.badge-info/warn/danger/success`, `.table`, `.scroll-y`
  - 字體: monospace 用於數字 — **【4A 修】引用 T0 token `var(--font-mono)`** (定義於 tokens.css,self-host JetBrains Mono);body 文字用 `var(--font-body)`
  - 過渡: `--transition: 200ms ease`

  **Must NOT do**: 不寫模組專用 CSS (那是 modules.css 的事)

  **Recommended Agent Profile**: `artistry` (設計品質)

  **Parallelization**: Wave 1, Blocks T9-T14, T15-T23, BlockedBy None

  **References**: 無

  **Acceptance Criteria**:
  - [ ] `:root` 與 `:root[data-theme="light"]` 兩組變數
  - [ ] 切換 data-theme 後 `--bg-primary` 變數值不同

  **QA Scenarios**:
  ```
  Scenario: 主題切換
    Tool: Playwright
    Steps:
      1. page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-primary'))
      2. 切換 theme, 再 evaluate
    Expected Result: 兩個值不同
    Evidence: .omo/evidence/task-8-theme-switch.png
  ```

  **Commit**: YES — `feat(styles): theme system with dark/light CSS variables`

---

- [ ] 9. Import map + index.html shell (index.html)

  **What to do**:
  - 撰寫 `index.html`:
    - `<head>`: import map (D3 v7 從 esm.sh, 其他本地 module 從 `./`)
    - 載入順序: theme.css → components.css → modules.css → i18n/index.js → app.js
    - `<body>`: 結構 (**【3A 修】** `aside#nav-left` 頂部加 48px logo 槽 (單色幾何 SVG mark placeholder at `assets/brand-mark.svg`);`header#topbar` 左端加產品名文字,讀 CSS token `--brand-name`)
      ```
      <div id="app">
        <aside id="nav-left">
          <div id="brand-mark"><!-- 48px logo 槽: assets/brand-mark.svg, currentColor 24px --></div>
          <!-- 9 nav buttons -->
        </aside>
        <main id="main">
          <header id="topbar">
            <span id="product-name"><!-- 讀 var(--brand-name) --></span>
            <div id="kpi-strip"></div>
            <div id="event-river"></div>
          </header>
          <section id="content"></section>
        </main>
      </div>
      ```
    - `<script type="module" src="app.js">` 在 body 結尾
  - `app.js`: 啟動 SimulationController，初始 locale = `zh-TW`，初始 theme = `dark`
  - **【3A 修 — QA 合約】** `app.js` 組裝 SimulationController 時必須暴露測試鉤面 `window.__SIM = { scheduler, router, state, dispatcher, d3, playHeroStory, stopHeroStory, setEpochLength(n) }` (全計畫 QA scenarios 依賴此 8-key 合約)
  - **【D14 修 — boot 錯誤橫幅】** `app.js` 啟動時掛 `window.addEventListener('error', ...)` + `window.addEventListener('unhandledrejection', ...)` + 10s boot timeout (boot 完成則清除);任一觸發時隱藏 spinner、顯示錯誤橫幅 (含錯誤訊息文字 + `Reload` 按鈕),避免永轉 spinner
  - import map 範例:
    ```html
    <script type="importmap">
    {
      "imports": {
        "d3": "https://esm.sh/d3@7.8.5",
        "d3-": "https://esm.sh/d3@7.8.5/"
      }
    }
    </script>
    ```

  **Must NOT do**: 不使用 bundler，所有 module 直接用 `import`

  **Recommended Agent Profile**: `quick`

  **Parallelization**: Wave 1, Blocks T10-T14, T15-T23, BlockedBy T7, T8

  **References**: T7, T8

  **Acceptance Criteria**:
  - [ ] Playwright 開啟 `http://localhost:8000/` 載入完成 < 2s
  - [ ] 載入時 console 無 error
  - [ ] import map 正確解析 D3
  - [ ] Playwright `page.evaluate(() => Object.keys(window.__SIM))` 含 `scheduler / router / state / dispatcher / d3 / playHeroStory / stopHeroStory / setEpochLength` 8 個 key
  - [ ] (D14) window 'error' / 'unhandledrejection' 或 10s boot timeout 任一觸發時,spinner 隱藏且錯誤橫幅顯示 (含錯誤訊息 + Reload 按鈕)
  - [ ] (3A) 首屏可見 brand mark (`#nav-left` 頂部 48px 槽, `assets/brand-mark.svg`) + 產品名文字 (`#topbar` 左端,讀 `--brand-name`)

  **QA Scenarios**:
  ```
  Scenario: 載入成功
    Tool: Playwright
    Preconditions: http server 已起 (`python3 -m http.server 8000`)
    Steps:
      1. page.goto('http://localhost:8000/')
      2. page.wait_for_load_state('networkidle', timeout=5000)
      3. 截圖 + 檢查 console 無 error
    Expected Result: 頁面載入, 無紅字 error
    Evidence: .omo/evidence/task-9-loads.png

  Scenario: boot 錯誤橫幅 (D14)
    Tool: Playwright
    Steps:
      1. 暫時注入一個壞 module import (令 boot 失敗)
      2. 載入 index.html
      3. 斷言 10s 內錯誤橫幅顯示 (含錯誤訊息 + Reload 按鈕), 而非永轉 spinner
    Expected Result: 錯誤橫幅取代 spinner, 含 Reload 鈕
    Evidence: .omo/evidence/task-9-boot-error.png
  ```

  **Commit**: YES — `feat(shell): index.html with import map and D3 from esm.sh`

---

- [ ] 10. 左側模組 nav (shell/nav.js)

  **What to do**:
  - 9 個按鈕: MES, APS, ERP, SPC, APC, WIP, SCM, Recipe, Yield
  - **【1A 修】** 72px 窄軌上只顯示縮寫 (MES/APS/ERP/SPC/APC/WIP/SCM/RCP/YLD) + icon (SVG inline) + 鍵盤快捷鍵 (1-9);hover 與鍵盤 focus 時 tooltip 顯示雙語全名 (i18n key: `nav.{id}.full`,例「製造執行系統 / Manufacturing Execution System」)
  - 點擊觸發 `window.dispatchEvent(new CustomEvent('module:change', {detail:{id}}))` 或呼叫 `router.set(id)`
  - active 模組加上 `.active` class
  - 頂部有主題切換 + 語言切換小按鈕

  **Must NOT do**: 不在此檔案實作 router (那是 T13)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 2, Blocks T13, BlockedBy T9

  **References**: T7, T8, T9

  **Acceptance Criteria**:
  - [ ] 9 個按鈕渲染, 每個含 icon + 縮寫 (MES/APS/ERP/SPC/APC/WIP/SCM/RCP/YLD)
  - [ ] 點擊後 active class 移到該按鈕
  - [ ] 鍵盤 1-9 切換模組
  - [ ] (1A) tooltip 於 hover 與鍵盤 focus 時出現, 顯示雙語全名 (i18n key `nav.{id}.full`)

  **QA Scenarios**:
  ```
  Scenario: 模組切換
    Tool: Playwright
    Steps:
      1. page.locator('#nav-left button[data-module="mes"]').click()
      2. 檢查該按鈕 has class 'active'
      3. page.keyboard.press('2')
      4. 檢查 #nav-left button[data-module="aps"] has class 'active'
    Expected Result: 切換正常
    Evidence: .omo/evidence/task-10-nav-switch.png

  Scenario: nav tooltip (hover + keyboard focus) (1A)
    Tool: Playwright
    Steps:
      1. page.hover('#nav-left button[data-module="mes"]') → 斷言 tooltip 可見且含雙語全名 (例「製造執行系統 / Manufacturing Execution System」)
      2. page.keyboard.press('Tab') 將 focus 移至某 nav 按鈕 → 斷言 tooltip 同樣出現含雙語全名
    Expected Result: hover 與 focus 皆顯示雙語全名 tooltip
    Evidence: .omo/evidence/task-10-nav-tooltip.png
  ```

  **Commit**: YES — `feat(shell): left navigation with 9 module buttons`

---

- [ ] 11. 頂部 KPI 帶 (shell/kpi-strip.js)

  **What to do**:
  - 6 個 KPI card: WIP Count, Throughput (wafers/day), Yield %, MTBF (hr), OEE %, Alarm Active
  - 訂閱 `state.kpis` 變化 (呼叫 `state.subscribeKpis(cb)` 或 polling)
  - 每秒數字跳動 (用 count-up animation 0.8s ease-out — 與 T26 一致,動畫完整落在 1s tick 窗口內)
  - 數字顏色隨閾值變化 (例: yield < 90% 變 amber, < 80% 變 red)
  - i18n key: `kpi.wip`, `kpi.throughput`...

  **Must NOT do**: 不做 count-up 用第三方庫，自己 requestAnimationFrame

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 2, Blocks T13, T24, BlockedBy T6, T9

  **References**: T6, T7, T8

  **Acceptance Criteria**:
  - [ ] 6 個 KPI card 渲染
  - [ ] tick 推進後數字變化
  - [ ] yield < 90% 時數字變 amber

  **QA Scenarios**:
  ```
  Scenario: KPI 跳動
    Tool: Playwright
    Steps:
      1. 截圖 tick=0 的 KPI
      2. 等 10s
      3. 截圖 tick=10 的 KPI
      4. 比較至少 1 個 KPI 數字不同
    Expected Result: KPI 有動態變化
    Evidence: .omo/evidence/task-11-kpi-before.png, .omo/evidence/task-11-kpi-after.png
  ```

  **Commit**: YES — `feat(shell): KPI strip with count-up animation`

---

- [ ] 12. 頂部事件河 (shell/event-river.js)

  **What to do**:
  - 從左到右滾動的「事件帶」，每個事件是彩色 chip (依事件類型: lot.start=blue, lot.complete=green, spc.violation=red, defect.detected=amber, alarm=red-pulse, apc.adjustment=cyan, recipe.changed=purple)
  - 訂閱 dispatcher 所有事件，每秒推進
  - **【M5 修, 5C-A 更新】** chip 數由容器寬計算 = `floor(containerWidth/160)` (min 6),不再寫死 15;overflow 計入 `+N` indicator
  - **【M5 修】** Priority lane: SPC violation / alarm / defect detected 這三類事件永遠 pin 在最左側 (無視時間順序)，用紅/琥珀色 glow 強調
  - 點 chip 跳到對應模組 (例: lot.start 跳 MES, spc.violation 跳 SPC)
  - 用 per-chip CSS animation (新 chip 從右 fade-in + slide 12px, 60s 線性 drift 到左消失) — 非 container translateX
  - **【6A 修】** 事件河容器加 `role="log"` + `aria-live="off"` (每秒更新若播報會淹沒螢幕報讀器,故關閉自動播報;個別警報改由 toast 的 assertive live region 通知)

  **Must NOT do**: 不使用 WebSocket / SSE

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 2, Blocks T13, T24, BlockedBy T5, T6, T9, T32

  **References**: T5, T6, T7, T8, T32 (scenarios/mom-fab.js — 事件類型→模組路由表)

  **Acceptance Criteria**:
  - [ ] 10s 內事件河至少流入 5 個 chip
  - [ ] 點 chip 切換模組
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)

  **QA Scenarios**:
  ```
  Scenario: 事件流
    Tool: Playwright
    Steps:
      1. 計數初始 chip 數量
      2. 等 10s
      3. 計數新 chip 數量, 應 > 0
      4. 點第一個 chip, 確認模組切換
    Expected Result: 事件流持續, 點擊有反應
    Evidence: .omo/evidence/task-12-event-river.png

  Scenario: priority lane + overflow
    Tool: Playwright
    Steps:
      1. 注入一個 spc.violation 事件 + 15+ 一般事件
      2. 斷言 violation chip pin 在最左側
      3. 斷言 overflow `+N` indicator 出現
    Expected Result: violation 在最左, +N indicator 顯示
    Evidence: .omo/evidence/task-12-priority-overflow.png
  ```

  **Commit**: YES — `feat(shell): event river with scroll and drill-down`

---

- [ ] 13. 主內容區 SPA router (shell/router.js)

  **What to do**:
  - `class Router`:
    - `set(moduleId)`: 卸載當前 module 視圖 (呼叫 `currentModule.destroy()`), 載入新 module
    - 模組註冊: `register('mes', () => import('../modules/mes.js'))` lazy load
    - 切換動畫: 0.2s opacity fade out → swap content → 0.2s fade in
  - 對接 `nav.js` 的點擊事件 + `event-river.js` 的 chip 點擊
  - 模組介面合約 (**【H4 修】** 強制 .interrupt()):
    ```js
    export default {
      id: 'mes',
      label: 'MES',
      init(container, ctx) { ... },   // ctx = { state, dispatcher, t, router }
      update(container, ctx, tick) { ... },  // 每 tick 呼叫
      destroy() {
        // 強制: 1. d3.select(container).selectAll('*').interrupt()
        //       2. d3.select(container).selectAll('*').remove()
        //       3. dispatcher.unsubscribeAll(this.id)
        //       4. 清掉 module 內所有 setInterval / requestAnimationFrame
      }
    }
    ```
  - 切換動畫: 0.2s opacity fade out → 呼叫 destroy() → swap content → 0.2s fade in
  - Router 在 destroy 之前必須 `interruptAll()` transitions 防止 detached DOM 上的 timer 累積
  - **【2B 修 — 渲染所有權規則】** 事件回呼可做「增量 DOM 補丁」(scoped to 該事件影響的 row/point);`update(container, ctx, tick)` 做全量 reconcile。兩條約束:
    - (a) **增量補丁必須冪等** — 隨後的全量 reconcile 會覆蓋同一區域,補丁不得依賴自身殘留 (不可累加自身上次寫入的狀態)
    - (b) **state 先行** — 事件回呼必須先 mutate state 再 patch DOM,DOM 補丁內容一律從更新後的 state 推導,禁止 DOM 與 state 分叉
  - **【6A 修 — i18n 即時取值】** 模組每次 render 一律現取 `t(key)`,禁止模組層快取譯文字串 (否則 `setLocale()` + `router.refreshActive()` 無法換掉已快取文字)

  **Must NOT do**: 不使用 hash router / History API (不需要 deep linking)

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 2, Blocks T15-T23, BlockedBy T4, T9, T10, T11, T12

  **References**: T9, T10, T11, T12

  **Acceptance Criteria**:
  - [ ] 切換模組時舊模組 destroy 被呼叫
  - [ ] 切換後新模組 content 渲染
  - [ ] destroy 釋放 D3 selections (`.remove()`)

  **QA Scenarios**:
  ```
  Scenario: Router 切換
    Tool: Playwright
    Steps:
      1. window.__SIM.router.set('mes'), 檢查 #content 內容
      2. window.__SIM.router.set('spc'), 檢查 #content 內容
      3. 檢查 console 無 leak warning
    Expected Result: 切換正常, 釋放乾淨
    Evidence: .omo/evidence/task-13-router.png

  Scenario: 快速連續切換
    Tool: Playwright
    Steps:
      1. 在 0.2s fade 進行中連點 3 個不同模組
      2. 斷言最終 content 為最後選擇的模組
      3. 斷言 console 無 error, DOM 無殘留前模組節點
    Expected Result: 最終顯示最後選擇, 無 error, 無殘留 DOM
    Evidence: .omo/evidence/task-13-rapid-switch.png
  ```

  **Commit**: YES — `feat(shell): SPA router with module lifecycle`

---

- [ ] 14. 共用元件 (components/{button,card,dialog,toast,sparkline,table}.js)

  **What to do**:
  - 6 個純函式式元件, 接受 props 回傳 HTMLElement
  - `Button({label, onClick, variant})`: 套用 .btn / .btn-primary 等
  - `Card({title, content})`: 套用 .card
  - `Dialog({title, body, onClose})`: modal, 點背景關閉, ESC 關閉, **手刻 focus trap** (focusin event 攔截 + tabindex cycling + 開啟時 focus 移至 dialog title)
  - `Toast({message, type, duration})`: 右上角浮現, 3s 自動消失。**【6A 修】** toast 掛在 `aria-live="polite"` container;警報級 toast (alarm / `spc.violation` 觸發者) 改用 `aria-live="assertive"`
  - `Sparkline({data, width, height, color})`: 純 SVG mini chart, no D3
  - **【M6 修】** `Table({columns, rows, sortable, filterable, virtual, rowHeight = 36})`: 表格, virtual 模式只渲染可見列; **固定 rowHeight 36px** (M6 fix: 不支援變動列高，Yield 模組 defect 用 2-line cell 內文 + 1-line row)
  - 全部使用 data-i18n 自動套 i18n
  - **【5C-A 修 — components/chart-kit.js】** 圖表工廠函式 (閉包,無 class、無繼承,不違反 Must NOT Have):
    - `createLineChart(config)`, `createBarChart(config)`, `createGantt(config)`, `createHeatmap(config)` — 每個回傳 `{render(container), update(data), destroy()}`
    - `destroy()` 內建 d3 `.interrupt()` + `.remove()` (H4 紀律集中於工廠)
    - config 吃 T0 tokens (axis 10px、grid、tooltip 12px、200ms transition)
    - **Coverage note**: wafer map (Canvas) 與 WIP flow 動畫等異質圖仍由模組自寫,不經 chart-kit

  **Must NOT do**: 不使用任何 UI 函式庫 (Material / Bootstrap / shadcn); chart-kit 是工廠函式,禁止演化成 class 階層或 plugin 系統

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 2, Blocks T15-T23, BlockedBy T9

  **References**: T7, T8, T9

  **Acceptance Criteria**:
  - [ ] 6 個元件 export 成功
  - [ ] Dialog 點背景關閉 + ESC 關閉
  - [ ] Table virtual 模式 1000 列只 render 30 個 DOM 節點
  - [ ] chart-kit.js 匯出 4 個工廠 (`createLineChart` / `createBarChart` / `createGantt` / `createHeatmap`),各回傳 `{render, update, destroy}`;destroy() 會 `.interrupt()` 進行中 transition 後 `.remove()`
  - [ ] (2A) chart-kit 工廠內建 empty / loading / partial 態,config 接受 `emptyText` / `predictedTick` (依互動狀態矩陣通則 a/b/d 渲染 skeleton shimmer / 確定性預告 / 靠左不拉伸)
  - [ ] (5C-A) chart-kit 工廠以 `ResizeObserver` 依容器寬重算 (響應式三斷點下圖表自適應, 見 T33)

  **QA Scenarios**:
  ```
  Scenario: Dialog 互動
    Tool: Playwright
    Steps:
      1. 觸發 dialog open (e.g. via test hook)
      2. 截圖
      3. 按 ESC
      4. 確認 dialog 消失
    Expected Result: dialog 正常開關
    Evidence: .omo/evidence/task-14-dialog.png

  Scenario: Table virtual scroll
    Tool: Playwright
    Steps:
      1. 渲染 1000 列 table with virtual=true
      2. page.evaluate(() => document.querySelectorAll('#table tbody tr').length)
    Expected Result: < 50 (僅可見列)
    Evidence: .omo/evidence/task-14-virtual-table.json

  Scenario: chart-kit 工廠
    Tool: node/Playwright
    Steps:
      1. createLineChart(config) → render(container) → update(data) → destroy()
      2. 斷言 destroy 後 container.children.length === 0
      3. 斷言無進行中 transition (.interrupt 已執行)
    Expected Result: destroy 後容器清空且無殘留 transition
    Evidence: .omo/evidence/task-14-chart-kit.json
  ```

  **Commit**: YES — `feat(components): button, card, dialog, toast, sparkline, table`

---

- [ ] 15. MES 模組 (modules/mes.js)

  **What to do**:
  - 主視圖:
    - 上半: Lot 追蹤表 (id, product, currentStep, currentEquipment, status, qTime, operator)，使用 Table 元件 (sortable, filterable, virtual)
    - 下半: 選中 lot 的生命週期 Gantt (SVG) — 顯示選中 lot 過去/現在/未來的 step 進度
  - 動作按鈕 (頂部): Start, Hold, Release, Complete, Rework, Scrap
  - 點選 lot 行後按鈕啟用，可對該 lot 執行 (顯示 toast)
  - 訂閱 dispatcher 事件 (`lot.start`, `lot.complete`, `step.transition`)
  - 每 tick 呼叫 `update()` 重繪表格 (lot 狀態變化)

  **Must NOT do**: 不做 sub-screen drill-down 超出 1 層

  **Recommended Agent Profile**: `visual-engineering` (有 Gantt + Table)

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T3, T5, T6, T13, T14, T32

  **References**: T2 (factory), T3 (skeleton), T6 (state), T13 (router), T14 (components), T32 (scenarios/mom-fab.js), T7 (i18n keys: mes.lot_id, mes.lot_status, mes.action.start, mes.action.hold, mes.action.release, mes.action.complete, mes.action.rework, mes.action.scrap)

  **Acceptance Criteria**:
  - [ ] MES 模組渲染 Lot 表格
  - [ ] 點選 lot 後 Gantt 顯示該 lot 進度
  - [ ] 6 個動作按鈕在選中 lot 後啟用
  - [ ] 點 Start/Hold 等按鈕觸發 toast + state 更新
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: MES 表格與 Gantt
    Tool: Playwright
    Steps:
      1. 切到 MES 模組
      2. 截圖, 確認表格有 ≥ 50 列
      3. 點第一列 lot
      4. 截圖, 確認 Gantt 顯示
    Expected Result: MES 正常運作
    Evidence: .omo/evidence/task-15-mes-overview.png, .omo/evidence/task-15-mes-gantt.png

  Scenario: 動作按鈕
    Tool: Playwright
    Steps:
      1. 切到 MES, 點 lot L-001
      2. 點 Hold 按鈕
      3. 確認 toast 顯示 "L-001 Hold"
      4. 確認 lot 狀態欄變 "Hold"
    Expected Result: 按鈕功能正常
    Evidence: .omo/evidence/task-15-mes-hold.png
  ```

  **Commit**: YES — `feat(module-mes): lot tracking table + lifecycle Gantt + actions`

---

- [ ] 16. APS 模組 (modules/aps.js)

  **What to do**:
  - 主視圖:
    - 上半: 派工甘特圖 (SVG, 100 equipment row, 每 row 顯示 assigned lot blocks)
    - 下半: 機台負載熱力圖 (10×10 grid, 顏色深淺 = 利用率)
  - 動作按鈕: Re-dispatch, Auto-balance, Lock schedule
  - Re-dispatch 按鈕: 觸發重新派工動畫 (1.5s ease-in-out, lot blocks 平滑移動到新機台)
  - 訂閱 dispatcher: `equipment.idle`, `lot.complete` (影響 APS)

  **Must NOT do**: 不使用 d3-drag (派工按鈕觸發而非拖曳)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T3, T5, T6, T13, T14, T32

  **References**: T2, T3, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: aps.dispatch, aps.equipment_load, aps.action.redispatch, aps.action.autobalance, aps.action.lock)

  **Acceptance Criteria**:
  - [ ] 100 機台 row 渲染, 至少 20 個 lot block 可見
  - [ ] 熱力圖顏色分布合理
  - [ ] 點 Re-dispatch 觸發 1.5s 動畫, 動畫結束後 block 位置改變
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: APS 甘特
    Tool: Playwright
    Steps:
      1. 切到 APS, 截圖
      2. 確認甘特有 100 row
      3. 點 Re-dispatch
      4. 1.5s 後截圖, 確認 block 位置改變
    Expected Result: 甘特 + 重派工正常
    Evidence: .omo/evidence/task-16-aps-gantt.png, .omo/evidence/task-16-aps-redispatch.png
  ```

  **Commit**: YES — `feat(module-aps): dispatch Gantt + load heatmap + re-dispatch`

---

- [ ] 17. ERP 模組 (modules/erp.js)

  **What to do**:
  - 主視圖:
    - 左: BOM 展開樹 (5 products × N components, click expand)
    - 右: PO 採購單流程 (Kanban: Draft → Submitted → Approved → In Transit → Received, 5 column)
  - 動作: Create PO, Approve, Cancel
  - 訂閱: `po.received`, `material.in_transit`
  - 5 column kanban 中 lot 卡片從左到右移動 (3D card flip animation)

  **Must NOT do**: 不做多層 drill-down (BOM 展開 1 層即可)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: erp.bom, erp.po_draft, erp.po_submitted, erp.po_approved, erp.po_in_transit, erp.po_received, erp.action.create, erp.action.approve, erp.action.cancel)

  **Acceptance Criteria**:
  - [ ] BOM 樹渲染 5 product 展開
  - [ ] Kanban 5 column 渲染, 卡片在 column 間移動
  - [ ] 點 Create PO 觸發對話框, 提交後新 PO 出現在 Draft column
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: ERP kanban
    Tool: Playwright
    Steps:
      1. 切到 ERP
      2. 截圖, 確認 5 column + BOM 樹
      3. 點 Create PO, 填表單, 提交
      4. 確認新 PO 出現在 Draft
    Expected Result: ERP 正常
    Evidence: .omo/evidence/task-17-erp.png, .omo/evidence/task-17-erp-create.png
  ```

  **Commit**: YES — `feat(module-erp): BOM tree + PO kanban workflow`

---

- [ ] 18. SPC 模組 (modules/spc.js)

  **What to do**:
  - 主視圖:
    - 上: X-bar 控制圖 (SVG, 即時繪點, UCL/CL/LCL 三條線, Western Electric Rule 1-8 違規高亮)
    - 下: R chart (subgroup range)
    - 右側: 規則選擇器 (8 個 checkbox)
  - 訂閱 `spc.violation` 事件, 違規點紅色 pulse
  - 滑動視窗: 顯示最近 50 個 sample, 超出從左消失
  - 動作: Reset chart, Export (locked: no export, 改為 Print preview disabled)

  **Must NOT do**: 不做真實 ML 異常偵測 (用 Western Electric rules)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T3 (skeleton 提供 SPC 採樣點), T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: spc.xbar_chart, spc.r_chart, spc.ucl, spc.cl, spc.lcl, spc.rule_1, spc.rule_2 ... spc.rule_8, spc.action.reset)

  **Acceptance Criteria**:
  - [ ] X-bar chart 繪製, UCL/CL/LCL 三條水平線
  - [ ] 滑動視窗保留最近 50 點
  - [ ] Western Electric Rule 1 觸發時點變紅 + pulse
  - [ ] 8 個規則 checkbox 可獨立啟用/停用
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: SPC 控制圖
    Tool: Playwright
    Steps:
      1. 切到 SPC, 等 30s
      2. 截圖, 確認 ≥ 20 點繪製
      3. 確認 UCL/CL/LCL 三條線存在
    Expected Result: SPC chart 正常
    Evidence: .omo/evidence/task-18-spc-chart.png

  Scenario: 規則觸發
    Tool: Playwright (延長 epoch 加速)
    Steps:
      1. 啟用所有 8 規則
      2. 等 60s
      3. 檢查至少 1 個違規高亮
    Expected Result: 違規被標記
    Evidence: .omo/evidence/task-18-spc-violation.png
  ```

  **Commit**: YES — `feat(module-spc): X-bar/R charts with Western Electric rules`

---

- [ ] 19. APC 模組 (modules/apc.js)

  **What to do**:
  - 主視圖:
    - 上: R2R (Run-to-Run) 疊代動畫 (SVG, 顯示控制器調整 recipe 參數 over lots)
    - 下: FDC 參數時序 (D3 multi-line chart, 3-5 條線: chamber pressure, RF power, gas flow, temperature)
  - 控制器切換: EWMA (λ=0.3) / PID (Kp/Ki/Kd 滑桿)
  - 訂閱 `apc.adjustment` 事件
  - 切換控制器時 R2R 動畫的調整曲線統計性不同

  **Must NOT do**: 不做真實控制理論 (用模擬公式)

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: apc.r2r, apc.fdc, apc.controller_ewma, apc.controller_pid, apc.lambda, apc.kp, apc.ki, apc.kd)

  **Acceptance Criteria**:
  - [ ] R2R 動畫顯示最近 30 lot 的調整量
  - [ ] FDC 多線圖顯示 ≥ 3 條參數時序
  - [ ] 切換 EWMA ↔ PID 後, R2R 動畫曲線形狀統計性改變 (用 hash 驗證)
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: APC 控制器切換
    Tool: Playwright
    Steps:
      1. 切到 APC, 截圖 R2R (EWMA)
      2. 切換到 PID, 截圖
      3. 計算兩截圖 hash, 應不同
    Expected Result: 切換有視覺差異
    Evidence: .omo/evidence/task-19-apc-ewma.png, .omo/evidence/task-19-apc-pid.png
  ```

  **Commit**: YES — `feat(module-apc): R2R animation + FDC + EWMA/PID switch`

---

- [ ] 20. WIP 模組 (modules/wip.js)

  **What to do**:
  - 主視圖:
    - 上: 即時 lot Gantt (100 lot, 全部 lot 在 100 tool 的進度)
    - 下: 左: lot flow 流向動畫 (SVG 節點=tool group, 邊=step transition, lot 用圓點沿邊移動), 右: queue length sparkline
  - 動作: Filter by tool group, Filter by product
  - 訂閱: `step.transition`, `lot.complete`
  - 圓點用 requestAnimationFrame 平滑移動

  **Must NOT do**: 不做真實 simulation engine (跟著 dispatcher 事件)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T3, T5, T6, T13, T14, T32

  **References**: T2, T3, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: wip.gantt, wip.flow, wip.queue_length, wip.filter.tool_group, wip.filter.product)

  **Acceptance Criteria**:
  - [ ] Gantt 顯示 ≥ 50 lot blocks
  - [ ] Flow 動畫有 ≥ 5 個圓點在移動
  - [ ] Queue sparkline 即時更新
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: WIP 動態
    Tool: Playwright
    Steps:
      1. 切到 WIP, 截圖 t=0
      2. 等 10s, 截圖 t=10
      3. 比較 flow 圓點位置不同
    Expected Result: WIP 有動態
    Evidence: .omo/evidence/task-20-wip-t0.png, .omo/evidence/task-20-wip-t10.png
  ```

  **Commit**: YES — `feat(module-wip): live lot Gantt + flow animation + queue sparkline`

---

- [ ] 21. SCM 模組 (modules/scm.js)

  **What to do**:
  - 主視圖:
    - 上: 供應商評分看板 (10 個 supplier card, 含 on-time delivery %, quality score, lead time)
    - 下: 在途 material lot table (lot id, supplier, material, qty, ETA, status)
  - 動作: Receive, Reject, Escalate
  - 訂閱: `material.in_transit`, `po.received`
  - 接收動畫: material lot 從 in_transit 移到 received, 0.5s slide

  **Must NOT do**: 不做供應商 portal / 外部整合

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: scm.supplier_scorecard, scm.material_in_transit, scm.action.receive, scm.action.reject, scm.action.escalate)

  **Acceptance Criteria**:
  - [ ] 10 supplier card 渲染
  - [ ] 物料 table 至少 10 列
  - [ ] 點 Receive 觸發 slide 動畫, lot 從 in_transit 移到 received
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: SCM 接收
    Tool: Playwright
    Steps:
      1. 切到 SCM, 截圖
      2. 點某 lot 的 Receive 按鈕
      3. 等 0.5s, 確認 lot 已從 in_transit 消失
    Expected Result: 接收正常
    Evidence: .omo/evidence/task-21-scm.png, .omo/evidence/task-21-scm-receive.png
  ```

  **Commit**: YES — `feat(module-scm): supplier scorecard + in-transit material + receive`

---

- [ ] 22. Recipe 模組 (modules/recipe.js)

  **What to do**:
  - 主視圖:
    - 上: 配方參數表 (當前選中 recipe, columns: Step / Chamber / Gas / Time(s) / Temp(°C) / Pressure(mTorr))
    - 下: 版本 diff (左: v1, 右: v2, 差異高亮 amber/green)
  - 動作: New version, Sign off, Compare
  - 訂閱: `recipe.changed` (**【I2 修】** APC 模組 (T19) 同時訂閱 `recipe.changed` 以更新 R2R 動畫的 baseline 參數；MES 模組 (T15) 訂閱以更新 lot route 中當前 step 的 recipe)
  - 簽核流程: 顯示 pending approval 列表 + 簽核人

  **Must NOT do**: 不做完整 PLM (Product Lifecycle Management) 整合

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: recipe.parameter_table, recipe.version_diff, recipe.action.new_version, recipe.action.sign_off, recipe.action.compare, recipe.chamber, recipe.gas, recipe.time, recipe.temp, recipe.pressure)

  **Acceptance Criteria**:
  - [ ] 配方參數表至少 8 step rows
  - [ ] 版本 diff 視覺化 (差異行高亮)
  - [ ] 點 Sign off 觸發 toast + state 更新
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: Recipe diff
    Tool: Playwright
    Steps:
      1. 切到 Recipe
      2. 點 Compare 按鈕
      3. 確認 v1 vs v2 兩側並列, 差異高亮
    Expected Result: diff 正常
    Evidence: .omo/evidence/task-22-recipe-diff.png
  ```

  **Commit**: YES — `feat(module-recipe): parameter table + version diff + sign-off`

---

- [ ] 23. Yield/Defect 模組 (modules/yield.js)

  **What to do**:
  - 主視圖:
    - 上: Pareto chart (SVG, defect 類型 × count, 動態累積, bar 從下往上)
    - 下左: Wafer map 熱圖 (300mm wafer 圓形, defect 累積, 顏色 = density)
    - 下右: Yield trend sparkline (最近 50 lot)
  - 動作: Drill into defect type (顯示該 type 的 lot 清單)
  - 訂閱: `defect.detected`, `yield.alert` (**【I3 修】** Yield 模組本身在每 tick 結尾呼叫 `recomputeYield()` 計算 rolling yield%, 若 < 閾值 88% 主動 emit `yield.alert` 給其他模組訂閱 (例: SPC 訂閱以在圖表加 marker))
  - Wafer map 用 Canvas 繪製 (高密度)

  **Must NOT do**: 不做真實影像辨識 (用隨機熱點)

  **Recommended Agent Profile**: `visual-engineering`

  **Parallelization**: Wave 3, Blocks T24, BlockedBy T2, T5, T6, T13, T14, T32

  **References**: T2, T6, T13, T14, T32 (scenarios/mom-fab.js), T7 (i18n: yield.pareto, yield.wafer_map, yield.trend, yield.defect_type, yield.action.drilldown)

  **Acceptance Criteria**:
  - [ ] Pareto bar ≥ 5 defect type
  - [ ] Wafer map 圓形渲染, ≥ 10 defect dot
  - [ ] Yield sparkline 即時更新
  - [ ] 點 defect type 顯示對應 lot 清單 (1 層 drill-down)
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)
  - [ ] 線圖/長條圖/甘特/熱力圖一律使用 chart-kit 工廠;grep 模組內自建 axis/tooltip 腳手架為 0 hits (Canvas wafer map 與 flow 動畫除外)
  - [ ] (2A) 互動狀態矩陣對應列全數實作 (LOADING / EMPTY / ERROR / SUCCESS / PARTIAL 五態,文案讀 `states.*` i18n key)

  **QA Scenarios**:
  ```
  Scenario: Yield 動態
    Tool: Playwright
    Steps:
      1. 切到 Yield, 截圖 t=0
      2. 等 20s, 截圖 t=20
      3. 確認 Pareto bar 高度變化, wafer map defect 數量增加
    Expected Result: 動態累積
    Evidence: .omo/evidence/task-23-yield-t0.png, .omo/evidence/task-23-yield-t20.png
  ```

  **Commit**: YES — `feat(module-yield): pareto + wafer map + trend + drill-down`

---

- [ ] 24. 模組間 cross-cutting 整合 (cross-cutting.js)

  **What to do**:
  - 確認 event-river 點擊正確切換到對應模組
  - 確認模組間資料流 (例: MES 按 Hold 後, WIP 模組下次 update 反映該 lot 為 hold 狀態)
  - 統一錯誤處理: dispatcher emit 失敗時不中斷其他訂閱者
  - 統一卸載: 模組 destroy 應移除所有 D3 selection, event listener, interval

  **Must NOT do**: 不加新模組 / 新功能

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 4, Blocks T25, T26, T27, BlockedBy T13, T15-T23

  **References**: T11, T12, T15-T23

  **Acceptance Criteria**:
  - [ ] event-river 點擊 lot.start chip 切到 MES 並 highlight 該 lot
  - [ ] MES Hold 後切到 WIP, 該 lot 狀態為 hold
  - [ ] 模組切換 5 次後 console 無 leak warning

  **QA Scenarios**:
  ```
  Scenario: 跨模組同步
    Tool: Playwright
    Steps:
      1. MES 中對 L-005 點 Hold
      2. 切到 WIP
      3. 找 L-005 row, 確認狀態 = Hold
    Expected Result: 狀態跨模組同步
    Evidence: .omo/evidence/task-24-cross-module.png
  ```

  **Commit**: YES — `fix(integration): cross-module event flow + cleanup`

---

- [ ] 25. 報表頁淺色主題整合 (styles/reports.css + 模組淺色支援)

  **What to do (7A 修 — 重定義為「淺色主題品質規格」)**:
  - **主題唯一來源 = 使用者 toggle (T8 / T10)**;Router 無任何主題邏輯 (T13 cross-ref)。**刪除**原「SPA router 依模組類型自動套用淺色」與 `data-surface="light"` 自動機制
  - **淺色主題品質規格**:淺色下表格 / 圖表 / badge 的對比與密度規格;WCAG AA 4.5:1 維持
  - `reports.css` 提供淺色變數細化 — **僅由 `data-theme="light"` 觸發** (使用者 toggle 設定),不由模組或 router 自動覆寫

  **Must NOT do**:
  - 不做 print stylesheet
  - 不在 router / 模組中自動切換主題 (無依模組類型自動套用淺色, 無 `data-surface` 自動機制);無任何模組自行覆寫 `data-theme`

  **Recommended Agent Profile**: `artistry`

  **Parallelization**: Wave 4, Blocks F1-F4, BlockedBy T24

  **References**: T8, T15-T23

  **Acceptance Criteria**:
  - [ ] (7A) 使用者 toggle 切換 light 後,SPC / Yield / Recipe 報表級畫面對比 ≥4.5:1 (WCAG AA)
  - [ ] (7A) 無模組自行覆寫 `data-theme` (主題唯一來源 = 使用者 toggle;router 無主題邏輯)

  **QA Scenarios**:
  ```
  Scenario: 淺色主題 (使用者 toggle)
    Tool: Playwright
    Steps:
      1. 使用者 toggle 切換主題為 light
      2. 切到 SPC / Yield / Recipe, 截圖, 確認報表級對比 ≥4.5:1
      3. 斷言無模組自行覆寫 data-theme (root data-theme === 'light' 一致)
    Expected Result: 淺色由 toggle 生效, 對比達標, 無模組自動覆寫
    Evidence: .omo/evidence/task-25-light-report.png
  ```

  **Commit**: YES — `feat(styles): light theme quality spec (user-toggle only)`

---

- [ ] 26. 動畫 polish (animations.css + 模組 hover/focus)

  **What to do**:
  - 統一按鈕 hover 效果: 0.15s ease-out transform: translateY(-1px) + 陰影加深
  - Card hover: 1px border accent
  - Focus ring: 2px solid var(--accent) outline-offset 2px
  - KPI 數字變化: count-up animation 0.8s ease-out
  - Modal 開關: 0.2s opacity + scale
  - 全部遵守 `prefers-reduced-motion: reduce` 停用動畫

  **Must NOT do**: 不做視差滾動 / 3D 翻轉

  **Recommended Agent Profile**: `artistry`

  **Parallelization**: Wave 4, Blocks F1-F4, BlockedBy T24

  **References**: T8

  **Acceptance Criteria**:
  - [ ] 全部按鈕 hover 有 transform
  - [ ] `prefers-reduced-motion: reduce` 媒體查詢生效

  **QA Scenarios**:
  ```
  Scenario: Hover 動畫
    Tool: Playwright
    Steps:
      1. page.hover('#nav-left button:first-child')
      2. 截圖, 確認 transform 套用
    Expected Result: hover 有效果
    Evidence: .omo/evidence/task-26-hover.png
  ```

  **Commit**: YES — `feat(styles): animation polish with reduced-motion support`

---

- [ ] 28. D3 vendor fallback + 動態 import 機制 (engine/d3-loader.js + vendor/d3.v7.min.js)

  **What to do (C1 + C3 fix — 防止 esm.sh 失敗導致 demo 全破)**:
  - 下載 `d3.v7.8.5` UMD minified bundle 至 `vendor/d3.v7.min.js` (~280KB)
  - 建立 `engine/d3-loader.js` — **使用 TOP-LEVEL AWAIT + DEFAULT EXPORT**:
    ```js
    async function loadD3() {
      try {
        return await import('https://esm.sh/d3@7.8.5');  // 優先 esm.sh
      } catch (e) {
        console.warn('esm.sh failed, falling back to vendor bundle', e);
        // 動態載入 UMD 並掛到 globalThis
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = './vendor/d3.v7.min.js';
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        return globalThis.d3;
      }
    }
    const d3 = await loadD3();  // top-level await — 阻塞 module graph 解析直到 d3 就緒
    export default d3;
    ```
  - 在 `index.html` 載入 spinner, 待 module graph 解析完成 (top-level await 阻塞 import 直到 d3 ready) 後才隱藏
  - **【C1 修】** import map 只映射 `"d3"` 一個 barrel — 禁止子模組 import (`d3-scale`, `d3-selection` 等) — 全部走 `d3.scaleLinear`, `d3.select` 形式
  - 模組 import 一律改用: `import d3 from 'd3'` (default import — **NOT** `import * as d3`),透過 import map 解析到 `./engine/d3-loader.js`
  - import map (維持不變):
    ```html
    <script type="importmap">
    { "imports": { "d3": "./engine/d3-loader.js" } }
    </script>
    ```

  **Must NOT do**:
  - 不用 `d3-scale` 等子路徑 import
  - 不假設 esm.sh 永遠可用

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: 無

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5
  - Blocks: F1-F4
  - Blocked By: T9

  **References**: T9

  **Acceptance Criteria**:
  - [ ] `vendor/d3.v7.min.js` 存在且 < 350KB
  - [ ] `loadD3()` 在 esm.sh 失敗時回傳 vendor 版本
  - [ ] Playwright 在離線模式 (`page.context().setOffline(true)`) 下載入 index.html 仍能渲染
  - [ ] grep `import.*from.*['"]d3-` 在 modules/ 為 0 hits
  - [ ] grep `import \* as d3` 在 modules/shell/components 為 0 hits (一律 default import `import d3 from 'd3'`)

  **QA Scenarios**:
  ```
  Scenario: 離線載入
    Tool: Playwright
    Preconditions: http server 跑起來
    Steps:
      1. page.context().setOffline(true)
      2. page.goto('http://localhost:8000/')
      3. 等 5s, 檢查 D3 載入成功 (window.__SIM.d3 存在)
    Expected Result: 離線下仍載入 vendor bundle
    Evidence: .omo/evidence/task-28-offline-load.png

  Scenario: 無子路徑 import
    Tool: ast_grep_search
    Steps:
      1. ast_grep_search pattern "from ['\"]d3-" lang "javascript" paths ["modules", "shell", "components", "engine"]
    Expected Result: 0 hits
    Evidence: .omo/evidence/task-28-no-subpath-imports.txt
  ```

  **Commit**: YES
  - Message: `feat(engine): D3 vendor fallback + dynamic loader for offline resilience`
  - Files: `vendor/d3.v7.min.js`, `engine/d3-loader.js`, modified `index.html`
  - Pre-commit: 跑過兩個 QA scenario

---

- [ ] 29. Skeleton-user conflict resolver (engine/event-gate.js)

  **What to do (C2 fix — 讓使用者按鈕真的有意義)**:
  - 建立 `engine/event-gate.js` 匯出 `gateEvent(event, state)`:
    ```js
    export function gateEvent(event, state) {
      if (!event.suppressible) return true;  // 非 lot-scoped 事件一律放行
      const override = state.suppressOverrides.get(event.lotId);
      if (!override) return true;
      // 若使用者已 Hold/Scrap/Complete, 抑制該 lot 的後續 skeleton 事件
      if (override.status === 'hold') {
        return event.tick < override.until ? false : true;
      }
      if (override.status === 'scrap' || override.status === 'complete') {
        return false;  // 永久抑制
      }
      return true;
    }
    ```
  - 修改 Dispatcher 的 `emit()` 流程: 在 emit 前先呼叫 `gateEvent(event, ctx.state)`, 通過才送給訂閱者
  - 修改 MES 模組 (T15) 的動作處理: 點 Hold → 呼叫 `state.setOverride(lotId, 'hold', currentTick + 30)`; 點 Release → `state.clearOverride(lotId)`; 點 Scrap/Complete → `state.setOverride(lotId, 'scrap'|'complete', Infinity)`
  - 修改 TickScheduler 的 epoch reset: 呼叫 `state.suppressOverrides.clear()` 重置所有使用者動作 (epoch-scoped 行為)
  - 增強 MES QA scenario: 點 Hold 後等 5s, 確認 lot 狀態未變回 Running

  **Must NOT do**:
  - 不直接修改 skeleton 陣列 (保持 immutable 設計)
  - 不持久化使用者動作到 localStorage (per Must NOT)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: 無

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5
  - Blocks: F1-F4
  - Blocked By: T5, T6, T13

  **References**: T5, T6, T13, T15

  **Acceptance Criteria**:
  - [ ] MES 點 Hold 後, 5s 內 lot 狀態 === 'hold' (不被 skeleton 覆蓋)
  - [ ] MES 點 Scrap 後, 該 lot 不再收到任何 `step.transition` / `lot.complete` 事件
  - [ ] epoch loop 觸發時, `state.suppressOverrides` 被清空
  - [ ] gateEvent() 對非 lot-scoped 事件 (alarm, yield.alert) 直接放行

  **QA Scenarios**:
  ```
  Scenario: Hold 真的生效
    Tool: Playwright
    Steps:
      1. 切到 MES, 點 L-001
      2. 記錄當前狀態
      3. 點 Hold 按鈕
      4. 等 5s (5 ticks)
      5. 確認 L-001 狀態欄 === 'hold'
    Expected Result: 狀態在 5 ticks 後仍為 hold
    Evidence: .omo/evidence/task-29-hold-persists.png

  Scenario: Scrap 抑制事件
    Tool: Playwright
    Steps:
      1. MES 點 L-002 → Scrap
      2. 等 10s
      3. 切到 WIP, 確認 L-002 不在進行中 lot 名單
    Expected Result: Scrap 後 WIP 看不到 L-002
    Evidence: .omo/evidence/task-29-scrap-suppresses.png

  Scenario: hold 到期恢復
    Tool: Playwright
    Steps:
      1. MES 對某 lot 設 Hold (until tick+30)
      2. 快進直到 override 過期
      3. 斷言 lot 狀態恢復 Running
    Expected Result: hold 到期後 lot 自動恢復 Running
    Evidence: .omo/evidence/task-29-hold-expiry.png

  Scenario: epoch reset 清 overrides
    Tool: Playwright
    Steps:
      1. 設一個 override (Hold)
      2. 觸發 epoch loop (epochLength 設短)
      3. 斷言 window.__SIM.state.suppressOverrides.size === 0
    Expected Result: epoch reset 後 overrides 全清
    Evidence: .omo/evidence/task-29-epoch-clear.json
  ```

  **Commit**: YES
  - Message: `feat(engine): event gate prevents skeleton from overriding user actions`
  - Files: `engine/event-gate.js`, modified `engine/dispatcher.js`, `modules/mes.js`
  - Pre-commit: 跑過兩個 QA scenario

---

- [ ] 30. Hero scenario 編排 (modules/hero-story.js + topbar 整合)

  **What to do (M2 fix — 給業務 demo 一個 30 tick 的「哇」時刻;tick-driven 版本)**:
  - 在 `topbar` 加一個 `▶ Play Demo Story` 按鈕 (在 i18n/theme toggle 旁)
  - 建立 `modules/hero-story.js` 編排 30-tick 敘事 — **時間軸以 tick 為單位,來源為 `scenarios/mom-fab.js` 的 hero story timeline (delta 2),非 setTimeout chain。** story 訂閱 scheduler 的 tick 事件,在指定 tick 觸發各步驟 (scheduler 1000ms/tick 對映實際秒數,但編排邏輯一律以 tick 計):
    1. **t+0 tick**: 從 timeline 取該 lot (scenarios manifest 指定), MES 模組高亮該 lot, 事件河推送 "L-XXX started at STEP_PHOTOLITHOGRAPHY"
    2. **t+10 tick**: SPC 模組切到前台, X-bar chart 出現 1 個 out-of-control 點 — **defect/SPC 注入綁定到 timeline 指定的特定 tick (保 PRNG 確定性,非命令式即時注入)**, 紅色 pulse, 事件河推送 "SPC violation: chamber pressure"
    3. **t+18 tick**: APC 模組切到前台, R2R 動畫顯示 controller 自動調整, 事件河推送 "APC adjustment: pressure -2.3%"
    4. **t+25 tick**: Yield 模組切到前台, Pareto bar "Pressure excursion" 增長, wafer map 顯示該 lot 區域缺陷密度增加
    5. **t+30 tick**: 切回總覽, 該 lot 已被 Yield 模組標記 "Recovered", 顯示 sparkline 回升
  - 實作細節:
    - story 透過 `scheduler` 的 tick 訂閱推進 (`onTick` → 比對 timeline tick offset),**不得用 setTimeout 串接敘事步驟**
    - 使用 `router.set('mes' | 'spc' | 'apc' | 'yield')` 自動切換
    - 模組切換時加高亮 overlay (顯示 step 名稱 + 簡短說明文字)
    - 暫停 background 事件河 (敘事期間,避免被淹沒)
    - 敘事完成後恢復正常狀態
  - 預設行為 (autoplay gate): **首次載入後,當 `scheduler.currentTick === 3` 自動播放一次** (tick 閘,非 `setTimeout(3000)`;可中斷)
  - **Replay policy (once-per-load)**: 首次載入於 tick 3 自動播放一次;**epoch loop 回到 tick 0 不重播**;之後僅由 topbar `▶ Play Demo Story` 按鈕手動觸發
  - 公開 `window.__SIM.playHeroStory()` / `stopHeroStory()` hooks

  **Must NOT do**:
  - **不得用 setTimeout 驅動敘事鏈** (story 一律由 tick 訂閱推進;`modules/hero-story.js` 內 setTimeout = 0 hits)
  - 不在 epoch loop 重播 (once-per-load;手動 replay 僅限 topbar ▶ 按鈕)
  - 不暫停 dispatcher (background 事件仍 emit, 只不過被 topbar 隱藏)
  - 不強制中斷使用者操作 (若使用者點其他模組, hero story 自動取消)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: 無

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5
  - Blocks: F1-F4
  - Blocked By: T0, T13, T15-T23, T25, T26, T27, T32

  **References**: T11, T12, T15, T18, T19, T23, T32 (scenarios/mom-fab.js — hero story timeline in tick units)

  **Acceptance Criteria**:
  - [ ] 首次載入後 `scheduler.currentTick === 3` 自動觸發 hero story (tick 閘,非 setTimeout)
  - [ ] 自 t+0 起 30 tick 內自動切換 4 個模組 (MES → SPC → APC → Yield)
  - [ ] hero timeline 來源為 scenarios/mom-fab.js (tick offsets 0/10/18/25/30),SPC defect 注入綁定特定 tick
  - [ ] 每個模組的關鍵元件 (lot row, SPC point, R2R adjust, Pareto bar) 在切換時高亮
  - [ ] topbar 顯示 `▶ Playing demo story...` 指示器
  - [ ] Replay policy: once-per-load — epoch loop 回到 tick 0 不自動重播,手動 replay 僅限 topbar ▶ 按鈕
  - [ ] 使用者點其他模組可中斷 story
  - [ ] 領域常數一律 import 自 scenarios/mom-fab.js;grep 硬編碼產品/tool group 名稱為 0 hits (i18n 字典除外)

  **QA Scenarios**:
  ```
  Scenario: 自動播放 hero story (tick-driven)
    Tool: Playwright
    Steps:
      1. page.goto('http://localhost:8000/')
      2. 等到 window.__SIM.scheduler.currentTick >= 3, 確認模組切到 MES, 某 lot 高亮
      3. 等到 currentTick >= 10, 確認切到 SPC, chart 有紅點 (注入點綁定該 tick)
      4. 等到 currentTick >= 18, 確認切到 APC, R2R 動畫播放
      5. 等到 currentTick >= 25, 確認切到 Yield
      6. 等到 currentTick >= 30, 確認切回總覽且 lot 標記 "Recovered"
    Expected Result: 30 tick 內走完 4 模組敘事 (以 currentTick 斷言,非 raw seconds)
    Evidence: .omo/evidence/task-30-hero-story.png, .omo/evidence/task-30-hero-spc.png, .omo/evidence/task-30-hero-apc.png, .omo/evidence/task-30-hero-yield.png

  Scenario: Replay policy — once-per-load
    Tool: Playwright
    Steps:
      1. 觀察首次 tick 3 自動播放
      2. 把 epochLength 設短, 等 epoch loop 回到 tick 0
      3. 確認 hero story 未自動重播 (story state idle)
      4. 點 topbar ▶ Play Demo Story, 確認手動可重播
    Expected Result: 自動播放僅一次, 手動 replay 有效
    Evidence: .omo/evidence/task-30-replay-once.png

  Scenario: user-interrupt 取消 story
    Tool: Playwright
    Steps:
      1. 在 hero story 播放中點其他模組 nav
      2. 斷言 story 取消 (story state idle)
      3. 斷言 topbar `▶ Playing demo story...` 指示器消失
    Expected Result: 使用者操作中斷 story, 指示器消失
    Evidence: .omo/evidence/task-30-interrupt.png
  ```

  **Commit**: YES
  - Message: `feat(shell): tick-driven hero story choreography for business demos`
  - Files: `modules/hero-story.js`, modified `shell/nav.js`, `index.html`
  - Pre-commit: 跑過 QA scenario

---

- [ ] 31. Deploy — git init + 靜態託管 + push 自動部署 (.github/workflows or Pages 設定)

  **What to do (補 distribution — 計畫原缺 hosting/deploy task)**:
  - `git init` 於 repo root, 建立首次 commit (所有既有檔案), 建 GitHub remote
  - 選定託管平台: **預設 GitHub Pages** (零成本零設定, root 直出 `index.html`); 或 Cloudflare Pages (二選一)
  - GitHub Pages: 設定 Pages source = 預設分支 root (`/`), 因無 bundler 故無 build step, 純檔案發布 (`index.html` 在 root)
  - `push` 觸發自動重新部署 (push-to-deploy)
  - **F3 維持 localhost 不變** — F3 步驟硬編碼 `python3 -m http.server 8000`, **不重寫**; T31 只新增公開 URL 通路, 不動本地驗證路徑

  **Must NOT do**:
  - 不引入 bundler / build step (純靜態檔案發布)
  - 不動 F3 的本地 `python3 -m http.server` 步驟
  - 不持久化 secrets 到 repo

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: `playwright` (公開 URL smoke 截圖)

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 5 (與 T28-T30 平行)
  - Blocks: F5
  - Blocked By: T9

  **References**: T9 (index.html shell), T28 (vendor fallback — esm.sh CORS/CSP 阻擋時接手)

  **Acceptance Criteria**:
  - [ ] 公開 URL 回 200 且 `index.html` 渲染, 載入時 console 無 error
  - [ ] esm.sh 在 Pages domain 下無 CORS/CSP 阻擋而正常載入 D3; 若被阻擋, T28 vendor fallback 必須接手並仍能渲染
  - [ ] `push` 後自動重新部署 (公開 URL 反映最新 commit)

  **QA Scenarios**:
  ```
  Scenario: 公開 URL 部署驗證
    Tool: Playwright
    Steps:
      1. page.goto(公開URL)
      2. page.wait_for_load_state('networkidle')
      3. 截圖 + 確認 console 無 error, D3 載入 (esm.sh 或 vendor fallback)
    Expected Result: 公開 URL 回 200, 頁面渲染, 無紅字 error
    Evidence: .omo/evidence/task-31-deployed.png
  ```

  **Commit**: YES
  - Message: `chore(deploy): git init + GitHub Pages static hosting with push-to-deploy`
  - Files: 託管設定 (Pages 設定 / `.github/workflows/*` 視平台而定)
  - Pre-commit: 跑過上面 QA scenario

---

- [ ] 33. 響應式版面 (monitoring-first) (styles/responsive.css + 模組斷點適配)

  **What to do (5C/5C-A 修 — monitoring-first 三斷點響應式)**:
  - **三斷點**:
    - **(a) ≥1366 桌面全互動** (現有規格不變);**1366-1919 降級**:KPI 6→4 + 「+2」popover、事件河 chip 數由容器寬計算 (**修改 T12 的 M5 規格:15 不再寫死,= `floor(containerWidth/160)`,min 6**)、甘特橫軸依容器壓縮
    - **(b) 768-1365 單欄化**:nav 軌保留、模組內上/下半改垂直堆疊、互動全保留
    - **(c) <768 監看儀姿態**:KPI 2×3 grid、事件河直列、每模組一張代表圖表全寬堆疊、甘特→清單視圖、hero story 保留、操作型功能 (Hold / Re-dispatch / 簽核等) 顯示「桌面版功能」notice 不假裝可用
  - 全互動元件 touch target ≥44px (<1366)
  - chart-kit 工廠以 `ResizeObserver` 依容器寬重算 (T14 acceptance 加一條)

  **Must NOT do**:
  - 不做 hamburger 收合 nav (nav 軌縮為底部 icon bar on <768 即可)
  - 不為 mobile 重做對話框複雜互動

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: 無

  **Parallelization**:
  - Can Run In Parallel: YES
  - Parallel Group: Wave 4 (與 T25-T27 平行)
  - Blocks: F1-F4
  - Blocked By: T24

  **References**: T12 (event river M5 chip 數), T14 (chart-kit ResizeObserver), T24

  **Acceptance Criteria**:
  - [ ] 1920 / 1366 / 390 三寬度截圖無橫向溢出
  - [ ] <768 操作型按鈕 (Hold / Re-dispatch / 簽核等) 顯示「桌面版功能」notice (不假裝可用)
  - [ ] 全互動元件 touch target 量測 ≥44px (<1366)
  - [ ] (5C-A) 事件河 chip 數 = `floor(containerWidth/160)` (min 6),非寫死 15

  **QA Scenarios**:
  ```
  Scenario: 三斷點無橫向溢出
    Tool: Playwright
    Steps:
      1. page.setViewportSize({width:1920,height:1080}) → 截圖, 斷言 document.documentElement.scrollWidth <= innerWidth
      2. page.setViewportSize({width:1366,height:768}) → 截圖, 斷言無 horizontal scrollbar
      3. page.setViewportSize({width:390,height:844}) → 截圖, 斷言無 horizontal scrollbar
    Expected Result: 三寬度皆無 horizontal scrollbar
    Evidence: .omo/evidence/task-33-viewport-1920.png, .omo/evidence/task-33-viewport-1366.png, .omo/evidence/task-33-viewport-390.png

  Scenario: 390 監看儀姿態
    Tool: Playwright
    Steps:
      1. page.setViewportSize({width:390,height:844})
      2. 斷言 KPI 為 2×3 grid 且事件河為直列存在
      3. 斷言操作型按鈕顯示「桌面版功能」notice
    Expected Result: KPI grid + 事件河直列存在, 操作型 notice 顯示
    Evidence: .omo/evidence/task-33-viewport-390.png
  ```

  **Commit**: YES — `feat(styles): monitoring-first responsive layout (3 breakpoints)`

---

- [ ] 27. Performance pass (engine/perf.js + 各模組優化)

  **What to do**:
  - 為大表 (>50 列) 加入 virtual scroll
  - 為高密度 chart (>200 點) 改 Canvas
  - D3 transition 前必 `.interrupt()`
  - **【9B 修】** 記憶體監控改由 QA 端 CDP 量測 (Playwright `Performance.getMetrics` 的 `JSHeapUsedSize`),runtime code 不依賴瀏覽器私有 heap API
  - Tab 切到背景時 `requestAnimationFrame` 自然暫停, 回前景時用 wall clock 補點
  - 統計 DOM node 總數, 確保 < 3000

  **Must NOT do**: 不引入 web worker (太複雜, 純 RAF 已足夠)

  **Recommended Agent Profile**: `unspecified-high`

  **Parallelization**: Wave 4, Blocks F1-F4, BlockedBy T24

  **References**: T15-T23, T4 (wall clock)

  **Acceptance Criteria**:
  - [ ] 60s 連續運行 memory < 200MB
  - [ ] DOM node < 3000
  - [ ] 切換模組後 D3 selection 全部 `.remove()`

  **QA Scenarios**:
  ```
  Scenario: 記憶體穩定性
    Tool: Playwright (CDP)
    Steps:
      1. const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable')
      2. 取 baseline: const m0 = await cdp.send('Performance.getMetrics') → 讀 JSHeapUsedSize metric (取樣 3 次取中位數)
      3. 跑 5 epoch (15 min, 加速模式 epochLength=3s)
      4. 再取 const m1 = await cdp.send('Performance.getMetrics') → JSHeapUsedSize (取樣 3 次取中位數)
    Expected Result: 差值 < 10MB (±15% 容差)
    Evidence: .omo/evidence/task-27-memory.json

  Scenario: DOM 計數
    Tool: Playwright
    Steps:
      1. page.evaluate(() => document.querySelectorAll('*').length)
    Expected Result: < 3000
    Evidence: .omo/evidence/task-27-dom-count.json
  ```

  **Commit**: YES — `perf: virtual scroll, canvas for high-density, interrupt on transition`

---

## Final Verification Wave (MANDATORY)

- [ ] F1. **Plan Compliance Audit** — `oracle`
  讀 plan 全文, 驗證:
  - Must Have 9 項全部實作 (grep 對應檔案)
  - Must NOT Have 12 項全部未違反 (grep 禁用模式)
  - 9 模組檔案存在且每個 export `default { id, label, init, update, destroy }`
  - evidence/ 資料夾存在且每 task 至少 1 個 evidence 檔
  - **【delta 3】** `[ -f DESIGN.md ]` — DESIGN.md 存在於 repo root 且涵蓋 type scale / spacing / color / component specs 四類規格

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  - 跑 `ast_grep_search` 確認:
    - `Math.random` 在 src/ 為 0 hits
    - `Date.now` 在 src/ 為 0 hits (除了可能的 debug log)
    - `new Date()` 在 src/ 為 0 hits
    - `from ['"]d3-` 子路徑 import 為 0 hits (C1 修)
    - `font-size: <num>px` (非 var) 在 styles/ 為 0 hits (M1 修)
    - `padding/margin: <num>px` 在 styles/ 為 0 hits (M1 修)
  - 確認無 console.log 在 production code
  - 確認無 `as any` / `@ts-ignore` (因為這是 JS, 不適用)
  - 確認 import map 正確 (C1 修: 只映射 "d3" barrel)
  - 確認 vendor/d3.v7.min.js 存在 (C3 修)
  - 確認所有 module 都有 destroy method 且呼叫 .interrupt() + unsubscribeAll() (H4 修)
  - 確認 3000 DOM node 上限
  - 確認 200MB 記憶體上限
  - **【H3 修, 9B CDP 化】** 跑 dispatcher leak test: 切換模組 20 次, 以 CDP `Performance.getMetrics` 的 `JSHeapUsedSize` (取樣 3 次取中位數、±15% 容差) 確認 heap growth < 5MB;另以 `cdp.send('Memory.getDOMCounters')` 驗 detached nodes 不增長
  - **【C2 修】** 確認 event-gate.js 被 dispatcher 呼叫, MES Hold 後狀態持續
  - **【H1 修】** 確認 deriveTickSeed 存在, 同 tick 內 SPC 與 defect PRNG 序列獨立
  - **【M2 修】** 確認 hero-story.js 存在且會自動播放 (tick 閘 currentTick === 3)
  - **【M2 修, tick 化】** grep `setTimeout` 在 `modules/hero-story.js` 為 0 hits — 敘事鏈必須由 scheduler tick 訂閱驅動, 不得用 setTimeout 串接
  - **【6A 修】** 深色主題 4.5:1 對比審計:`text-primary` / `accent` / `warn` / `danger` on `bg-primary` / `bg-elevated` 全組合對比 ≥4.5:1 (WCAG AA)
  - **【6A 修】** 確認 status LED 採形狀差異 (●▲■) 而非純色區分;Toast 採 `aria-live` (polite / 警報級 assertive);事件河容器 `role="log"` + `aria-live="off"`;觸標 ≥44px (<1366,見 T33 cross-reference)

  Output: `Banned API [0 hits] | Destroy [N/N] | Memory [PASS/FAIL] | DOM [PASS/FAIL] | A11y [PASS/FAIL] | VERDICT`

- [ ] F3. **Real Manual QA via Playwright** — `unspecified-high` + `playwright` skill
  啟動 `python3 -m http.server 8000` 在 repo root, 然後:
  - 載入 index.html, 截圖初始狀態
  - **【C3 修】** 設定 `page.context().setOffline(true)` 後重新載入, 確認仍能渲染 (vendor fallback)
  - 9 模組各切一次, 截圖
  - 點擊每個模組的至少 3 個互動元件, 截圖
  - **【C2 修】** MES 對某 lot 點 Hold, 等 5s, 確認狀態仍為 hold (非 skeleton 覆蓋)
  - 切換 i18n, 截圖
  - 切換主題, 截圖
  - 跑 3 分鐘 (180 tick), 期間每 30s 截圖一次
  - 確認 epoch 結束時 1.2s choreographed 轉場觸發 (M3 修)
  - 點擊 event river chip, 確認模組切換
  - 驗證 hash 確定性: 取得 tick=0, 90, 179 的 state hash, 確認唯一
  - 跑 2 個 epoch, 確認 tick=0 (epoch 1) 與 tick=0 (epoch 2) hash 相同
  - **【H1 修】** 統計 tick=50 的 SPC 樣本與 defect 樣本相關係數, 確認 |r| < 0.1 (獨立)
  - **【H2 修】** epoch 邊界截圖, 確認 SPC chart 仍顯示 carryover 點 (非閃空)
  - **【M2 修, tick-gated】** 等到 `window.__SIM.scheduler.currentTick >= 3`, 確認 hero story 自動播放 + story 狀態 active (切到 MES → SPC → APC → Yield); 斷言以 currentTick 為準, 非 raw 秒數
  - **【2A 修】** `page.goto` 後立即 (tick 0-2) 切到 Yield, 斷言 empty state 文案顯示 (確定性預告「尚無缺陷記錄 …約 tick 12 抵達」) 而非空白 SVG, evidence `.omo/evidence/f3-empty-state.png`
  - **【5C-A 修】** 以 `page.setViewportSize` 跑 1366×768 viewport 掃描一輪 (9 模組各截圖), 確認無橫向溢出
  - **【5C-A 修】** 三斷點 viewport (1920×1080 / 1366×768 / 390×844) 各斷言無 horizontal scrollbar (`document.documentElement.scrollWidth <= innerWidth`)

  Output: `Scenarios [N/N pass] | Loop [PASS/FAIL] | Determinism [PASS/FAIL] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  - 讀每個 task 的 "What to do" 與 "Must NOT do"
  - 讀對應實作檔案
  - 驗證 1:1: 該做的都做了, 不該做的都沒做
  - 檢查 scope locks: grep `localStorage`, `IndexedDB`, `WebSocket`, `babylonjs`, `WebGL`, `3d` 確認 0 hits
  - 檢查無 abstract BaseComponent, 無 EventBus 對外暴露
  - 檢查每個 clickable element 都有對應 handler (grep `addEventListener` 數量 >= button 數量)
  - **【delta 4 — 品牌去識別化】** grep 公開檔案 (index.html, UI 文案, README) 確認 `Applied Materials` / `SmartFactory` / `Critical Manufacturing` = 0 hits (內部計畫文件參照不受限)
  - **【delta 2 — T32 Must NOT】** grep `scenarios/` 確認無 plugin 系統 / DSL / 多 scenario 載入器模式 (僅一層 JS/JSON 參數化)

  Output: `Tasks [N/N compliant] | Scope Locks [N/N clean] | Handlers [N/N bound] | Branding [0 hits] | VERDICT`

- [ ] F5. **Post-deploy Smoke Test** — `unspecified-high` + `playwright` skill
  **(sequential-after — BlockedBy T31 + F1-F4;在部署上線且 F1-F4 通過後才跑)**
  範圍 = **公開 URL only** (warm cache, 不限速連線):
  - `page.goto(公開URL)` + `page.wait_for_load_state('networkidle')`, 量測載入 < 2s
  - 9 模組各切換一次, 確認渲染
  - hero story 在公開 URL 自動播放 (tick 閘) — 切到 MES → SPC → APC → Yield
  - **離線 fallback 不在此驗證** — offline `setOffline(true)` 檢查沿用 F3/T28 的本地路徑, F5 不重複
  - 冷網路 esm.sh 延遲不設硬數字 (僅 warm cache 量測)

  Output: `Public URL [200] | Load <2s [PASS/FAIL] | 9 Modules [N/N] | Hero Autoplay [PASS/FAIL] | VERDICT`
  Evidence: `.omo/evidence/f5-post-deploy-smoke.png`

---

## Commit Strategy

- 每個 task 1 commit, message: `feat(<scope>): <desc>` 或 `fix(<scope>): <desc>` 或 `perf(<scope>): <desc>`
- Wave 0 commit: `feat(styles): design token system (T0)`
- Wave 1-2 commits 為 `feat(engine:)` / `feat(shell:)` / `feat(components:)` / `feat(i18n:)` / `feat(styles:)`
- Wave 3 commits 為 `feat(module-XXX):`
- Wave 4 commits 為 `fix(integration):` / `feat(styles):` / `perf:`
- Wave 1 scenario commit: `feat(scenario): mom-fab scenario manifest` (T32)
- Wave 5 commits: `feat(engine): D3 vendor fallback` (T28), `feat(engine): event gate` (T29), `feat(shell): hero story` (T30), `chore(deploy): git init + GitHub Pages` (T31)
- Final wave 不 commit (review only)

---

## Success Criteria

### Verification Commands

```bash
# 啟動 http server (背景)
python3 -m http.server 8000 &

# 載入首頁, 確認 < 2s 載入
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:8000/

# 確認禁用 API 0 hits
ast_grep_search pattern "Math.random" lang "javascript" paths ["engine", "modules", "shell", "components"]
ast_grep_search pattern "Date.now" lang "javascript" paths ["engine", "modules", "shell", "components"]

# 確認 9 模組檔案存在
ls modules/{mes,aps,erp,spc,apc,wip,scm,recipe,yield}.js

# 確認 evidence 存在
ls .omo/evidence/ | wc -l
```

### Final Checklist
- [ ] 9 模組全實作
- [ ] 3 分鐘 loop 正常 + 1.2s choreographed 轉場 (M3)
- [ ] i18n 切換正常
- [ ] 主題切換正常
- [ ] 0 banned API hits
- [ ] Memory < 200MB (H3: dispatcher unsubscribe 強制)
- [ ] DOM < 3000
- [ ] 點擊所有 clickable 都有反應 (C2: Hold/Scrap 真的有效)
- [ ] event-river 點擊可切模組 (M5: 15 chips + priority lane)
- [ ] **【C3 修】** Offline 載入仍能渲染 (vendor fallback)
- [ ] **【C1 修】** 0 d3 subpath imports
- [ ] **【H1 修】** SPC 與 defect PRNG 序列獨立
- [ ] **【H2 修】** epoch 邊界 SPC chart 不閃空
- [ ] **【M1 修】** 0 raw font-size/padding in styles (全部走 tokens)
- [ ] **【M2 修】** hero story 自動播放
- [ ] **【H4 修】** module destroy() 強制 .interrupt() + unsubscribeAll()

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | (outside voice declined by user, both reviews) |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 11 issues, 0 critical gaps open (1 found → fixed via D14) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (FULL) | score: 6/10 → 9/10, 7 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

Eng review 2026-06-10: Step 0 scope confirmed at full scale (office-hours D6 honored). 11 findings adjudicated — Architecture 4 (1A d3-loader top-level await/default export, 2B event=incremental patch + update(tick)=full reconcile state-first, 3A window.__SIM 8-key QA contract, 4A epoch-reset sequence + ASCII diagram), Code Quality 3 (5C-A chart factory closures, 6A locale refreshActive, 7A t() missing-key policy), Test 1 (8A: 12 QA scenarios, coverage 69% → 97%), Performance 2 (9B CDP memory QA, 10A count-up 0.8s), critical gap 1 (D14 boot error banner). Test plan artifact: `~/.gstack/projects/mom-fab/quito-unknown-eng-review-test-plan-20260610.md`.

Design review 2026-06-10: completeness 6/10 → 9/10, 7 decisions folded — P1 nav 縮寫+雙語 tooltip (1A)、P2 互動狀態矩陣 12 列×五態 + chart-kit 內建態 (2A)、P4 品牌槽 `--brand-name` token + 軌頂 logo (3A)、P4 字體棧 self-host IBM Plex Sans/JetBrains Mono + 系統 CJK,禁 CDN 字體 (4A)、P6 新增 T33 三斷點響應式 monitoring-first 含 mobile (5C/5C-A,使用者選擇含 mobile)、P6 a11y 四件包 aria-live/LED 形狀/深色對比審計/44px touch (6A)、P7 主題唯一來源 = 使用者 toggle,T25 重定義 (7A)。品牌名為有意識延後 (placeholder 機制已入計畫,非阻塞)。Pass 3 (journey) 與 Pass 5 (design system) 無新發現。

**VERDICT:** ENG + DESIGN CLEARED — ready to implement. (CEO review optional, not run.)

NO UNRESOLVED DECISIONS
