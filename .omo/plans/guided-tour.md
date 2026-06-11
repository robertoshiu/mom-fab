<!-- /autoplan restore point: ~/.gstack/projects/mom-fab/main-autoplan-restore-20260611-233018.md -->
# Plan — 作業流程功能自動導覽說明系統 (Guided Workflow Tour System)

> Goal: 把 mom-fab 從「會動的 MOM 模擬儀表板」改造為「最頂配的作業流程功能自動導覽說明網站」——
> 任何訪客打開網站,不需要任何半導體製造背景,都能被自動導覽帶著理解每個模組的作業流程、
> 每個功能的用途、以及整座工廠從訂單到良率的端到端流程。

## Premises

- P-1: 本站的價值是「展示 + 教學」:訪客是評審/招聘方/同業,不是真正的 fab 操作員。導覽的目標讀者是**第一次看到 MOM 系統的人**。
- P-2: 既有 hero story(30-tick 自動敘事)是「事件發生了什麼」的 demo,不是「這個畫面怎麼用」的說明。兩者互補,不互斥。
- P-3: 站台無 build step、無框架、token-only CSS、雙語 i18n——導覽系統必須遵守同一套紀律(native ESM、DESIGN.md instrument-grade、i18n 全覆蓋)。
- P-4: 「最頂配」= 完整度:全 9 模組 + shell 都有導覽、自動/手動雙模式、進度持久化、無障礙、雙語、三斷點、reduced-motion,不是只做一條 happy-path tour。

## Scope — 六個交付物

### D1. Tour Engine (`engine/tour-engine.js`)
- 宣告式步驟序列器:步驟 = `{ id, module, anchor, placement, advance, i18nKey }`。
- 雙模式:**Auto**(計時自動前進,預設 7s/步,hover/focus 暫停)與 **Manual**(上一步/下一步/跳過)。
- 跨模組步驟:透過 `router.set(module, focus)` + 等待 module mount(`router.onModuleChanged` + 2×rAF settle)再定位 anchor。
- anchor 以 `data-tour="<id>"` 屬性標記(shell 與各模組 DOM 加標),engine 用 `[data-tour=...]` 查找;找不到 → 該步驟優雅降級為置中卡片(不中斷)。
- 進度持久化:`localStorage` key `momfab.tour.v1` = `{ completed: {tourId: bool}, dismissed: bool, lastStep }`。
- 與 hero story 互斥協調:tour 啟動時呼叫 `stopHeroStory()`;hero autoplay gate 讓位給 first-visit 導覽(導覽完成/跳過後 hero 才有 autoplay 資格)。
- 中斷語義:使用者真實 nav 點擊(`module:change`)= 退出導覽(與 hero story 同語義);Esc = 退出;退出記錄 lastStep 供「繼續導覽」。
- `window.__SIM` 增加 `startTour(id)`, `stopTour()`, `tourState()`(QA 契約)。

### D2. Spotlight + Coach-mark 元件 (`components/spotlight.js`)
- 全螢幕 overlay + SVG mask 挖洞聚焦目標元素(8px padding、`--r-card` 圓角、hairline 描邊呼吸動畫對齊 `--tick`)。
- 錨定 callout 卡片:title(engraved label)、body、步驟計數 `3/12`、進度 hairline bar、Prev/Next/Skip 按鈕、auto-mode 倒數環。
- 卡片定位:目標四側自動擇優(viewport 內優先),`<768` 一律 bottom-sheet。
- 目標自動 scroll into view(`behavior: smooth`,reduced-motion 時 instant)。
- A11y:overlay `role=dialog` + `aria-modal`、focus trap、`aria-live=polite` 唸出步驟文案、Tab 循環、Esc 關閉;觸控目標 ≥44px。
- 視覺全 token:cyan 只用於聚焦描邊(「活的焦點」語義),禁止漸層發光;dim 背景 = `--bg-inset` @ 0.7 不透明度遮罩。

### D3. 導覽內容 (`scenarios/tours.js` — 純資料)
- **T-onboarding「初次見面」**(~10 步):nav 軌、9 模組是什麼、KPI strip 怎麼讀、事件河與 priority lane、主題/語言切換、▶ demo 鈕、鍵盤 1-9。
- **T-grandtour「一片晶圓的旅程」**(~18 步,跨模組):依生產流程串 9 模組——ERP 訂單/BOM → APS 派工 → MES 批次追蹤 → Recipe 配方版本 → WIP 在製分析 → SPC 管制圖與 WE rules → APC R2R 調整 → Yield Pareto/晶圓圖 → SCM 物料供應。每步聚焦該模組核心畫面元素並說明「這一步在真實 fab 解決什麼問題」。
- **T-<module> × 9**(每模組 4-7 步):模組內部作業流程說明,例如 SPC:管制圖怎麼讀 → 8 條 WE rules → 違規 chip 出現時會發生什麼 → Ack 工作流;MES:批次表 → 生命週期甘特 → Hold/Scrap/Complete 與 event gate 的關係。
- 文案雙語齊備(`tour.*` namespace,zh-TW 為主、en-US 對齊),語氣:精密儀器的原廠導覽手冊,不是行銷話術。

### D4. Guide Hub(導覽中心)
- nav 軌新增 `?` 按鈕(theme/locale toggle 同區):開啟 dialog 列出全部 11 條導覽 + 完成狀態 LED(●/○)+「重設進度」。
- 各模組 panel head 角落新增「explain this」icon 觸發該模組導覽(contextual entry)。
- topbar 導覽進行中顯示 `▶ 導覽中…` 指示(複用 hero indicator 樣式語彙)。

### D5. 自動觸發策略
- 首訪(localStorage 無記錄)→ boot 完成 + tick 2 自動彈出「歡迎卡」:「開始導覽 / 自動播放全程 / 略過」三鍵;選自動播放 = T-onboarding + T-grandtour 連播(Auto mode)。
- 略過後永不再自動彈出(dismissed 持久化),但 Guide Hub 永遠可手動啟動。
- `?sim=...`/QA 模式與 `prefers-reduced-motion` 下不自動彈出 auto-play,改為 manual 預設。

### D6. i18n + QA + 部署
- `tour.*` 全 key 雙語;`onLocaleChange` 時當前 callout 即時重繪。
- QA:`node tools/serve.mjs` + /qa 流程驗證——首訪彈卡、11 條 tour 每條走完、跨模組步驟 mount 等待、Esc/中斷語義、雙語切換、三斷點、reduced-motion、focus trap。
- 既有 GitHub Pages 部署流程更新。

## NOT in scope
- 真實後端、使用者帳號、分析埋點。
- 影片/音訊導覽。
- hero story 重寫(只做互斥協調,不動其 30-tick 敘事)。
- 第三方 tour library(Shepherd/Driver.js 等):離線限制 + token 紀律 + 既有 router/focus 整合需求,自建薄引擎(預估 <400 行)比改裝第三方便宜。

## What already exists(槓桿)
- hero-story.js:跨模組編排、caption overlay、nav.setActiveSilent、中斷語義——tour engine 直接沿用同一套模式。
- router focus payload(T24):tour 步驟可帶 focus 讓模組自己 highlight 實體。
- dialog.js / toast.js / button.js:Guide Hub dialog 直接複用。
- i18n onLocaleChange、tokens.css、responsive 三斷點骨架。
- scenarios/mom-fab.js 的宣告式 timeline 前例(heroTimeline)→ tours.js 同風格。

## Milestones
1. **M1 引擎+元件**:tour-engine.js + spotlight.js + data-tour 錨點佈標(shell 先)。
2. **M2 內容**:tours.js 全 11 條 + i18n 雙語文案 + 各模組錨點佈標。
3. **M3 入口**:Guide Hub、? 鈕、首訪歡迎卡、hero 互斥協調。
4. **M4 硬化**:三斷點、a11y、reduced-motion、中斷/恢復、QA 全項、部署。

## Risks
- R1 模組 DOM 動態 mount → anchor 時序:以 onModuleChanged + double-rAF + anchor 輪詢(上限 2s)解;找不到降級置中卡。
- R2 與 epoch choreography(1.2s 凍結窗)撞期:tour 步驟切換避開 choreography window(scheduler 暴露 isChoreographing 或監聽既有 hook)。
- R3 文案量大(11 tours × 雙語):宣告式資料 + i18n key 規約先定,內容可並行產出。
- R4 mobile <768 是「監看儀」姿態,部分桌面功能隱藏 → 對應步驟需 viewport 條件(`desktopOnly: true` 跳過並以一張說明卡代替)。

---

# PHASE 1 — CEO REVIEW (via /autoplan, SELECTIVE EXPANSION, single-model `[subagent-only]`)

> Codex CLI hit its usage limit (resets 2026-07-08) — all dual-voice slots degrade to
> Claude subagent only. Single critical findings from the one available voice are
> flagged regardless (per degradation matrix).

## Success criterion (added per review)
一個零半導體背景的冷訪客,在 90 秒內能說出「這是什麼系統、它在做什麼、為什麼可信」。
Kill criterion:若 grand tour 在真人試看時撐不過 90 秒注意力,砍自動模式預設,保留 contextual 入口。

## Step 0A — Premise Challenge
- **P-1(受眾=評審/招聘方)**:成立,與專案記憶一致(portfolio demo)。推論修正:此受眾**反感被劫持畫面**——首訪不得用置中 modal 接管(見 D5 修訂)。
- **P-2(hero story 與導覽互補)**:原計畫實作上把導覽排在 hero 之前(autoplay gate 讓位),與 P-2 矛盾。**修訂**:hero story 維持首訪 tick-3 autoplay(它是 30 秒可信度鉤子),導覽邀請卡以非阻斷形式共存;使用者啟動導覽才 stopHeroStory()。
- **P-3(無 build、token 紀律、i18n 全覆蓋)**:已驗證(repo 實況相符)。
- **P-4(最頂配=完整度)**:保留全 11 條導覽(/goal 明示「最頂配」;autoplan 原則:不砍完整計畫的 scope)。但**優先序修訂**:T-onboarding + T-grandtour 是品質天花板所在,9 條模組導覽是同一宣告式資料的邊際產出,步數上限收緊為 4-6 步/條以控 i18n 總量。單聲道異議(Claude voice 主張砍 9 條)記錄為 taste decision,見 Decision Audit Trail #3。

## Step 0B — Existing Code Leverage
| 子問題 | 既有資產 | 沿用方式 |
|---|---|---|
| 跨模組切換+等 mount | hero-story.js 的 router.set + onModuleChanged 模式 | 抽出共用原語(見 0C-bis 裁決) |
| 模組內實體聚焦 | router focus payload (T24) | tour 步驟直接帶 focus |
| 旁白卡/指示器 | hero caption overlay、topbar indicator | 樣式語彙沿用,元件獨立 |
| 對話框/按鈕 | components/dialog.js, button.js | Guide Hub 直接複用 |
| 宣告式 timeline | scenarios/mom-fab.js heroTimeline | tours.js 同風格 |
| 雙語 | i18n onLocaleChange | callout 即時重繪 |

## Step 0C — Dream State
```
CURRENT STATE                THIS PLAN                      12-MONTH IDEAL
會動但不解釋自己的           自我解說:自動導覽+導覽中心     完全自我敘事的 portfolio:
9 模組 MOM 儀表板    --->    +how-it-works+深連結    --->   實體級 hover 說明、可分享
(hero story 是唯一敘事)      (訪客 90 秒內看懂)             深連結、書面 case study
```

## Step 0C-bis — Implementation Alternatives
```
APPROACH A: 極簡(擴充 hero-story caption,無 spotlight 無 hub)
  Effort: S | Risk: Low | Completeness: 3/10
  Pros: 零新元件;沿用既有敘事
  Cons: 無法聚焦元素;無隨選入口;不滿足「導覽說明網站」目標
APPROACH B: 自建宣告式 tour engine + spotlight + guide hub(本計畫)
  Effort: M | Risk: Med | Completeness: 9/10
  Pros: 完整覆蓋;token/離線/i18n 紀律可控;與 router/focus 深度整合
  Cons: 自建定位/focus-trap 細節多;內容維護成本
APPROACH C: 引入第三方 tour lib(Driver.js 類,vendored)
  Effort: M | Risk: Med | Completeness: 7/10
  Pros: 定位/遮罩成熟
  Cons: 樣式覆寫對抗 token 紀律;無 router mount-await 概念,核心難題(跨模組時序)仍須自寫;增加 vendor 維護
RECOMMENDATION: B — 核心難題是「跨模組 mount 時序與 focus 整合」,C 解決不了它;P1 完整度 + P5 顯式。
```

## Step 0D — SELECTIVE EXPANSION 分析
**複雜度檢查**:觸及 ~20 檔(>8 檔閾值)。裁決:可接受——其中 10 檔是 data-tour 錨點佈標(機械性、單一目的、每檔 <10 行),核心新增僅 4 檔(tour-engine、spotlight、tours、guide-hub)。
**最小變更集**:Approach A;被否(不達目標)。
**Expansion 裁決**(cherry-pick,goal-mode 自動裁決,全數記入 audit trail):
| # | 候選 | Effort | 裁決 | 理由 |
|---|---|---|---|---|
| E1 | Guide Hub 增加「How this works」系統總覽頁(架構/模組地圖/設計系統說明) | S | **ACCEPT** | 對評審受眾的單位價值最高(voice 發現 #8);複用 dialog |
| E2 | Anchor 健檢 QA 契約:`__SIM.tourState().anchorAudit` 走訪全部步驟驗證錨點可解析,QA 失敗即報 | S | **ACCEPT** | 防 6 個月後錨點默默腐爛(voice #4) |
| E3 | Manual 預設 + 點擊任意處前進;auto 模式(倒數環)僅限明確選擇 | S | **ACCEPT** | 評審要自己開車(voice #5);kiosk 模式保留給 demo |
| E4 | 首訪邀請改非阻斷 coach-mark(錨在 ? 鈕),不用置中 modal | S | **ACCEPT** | 不劫持第一印象(voice #2);hero 續任首訪 wow |
| E5 | `?tour=<id>` 深連結:boot 時讀 query 直接啟動指定導覽 | S | **ACCEPT** | portfolio 分享場景;靜態站零成本 |
| E6 | `tools/check-i18n-parity.mjs`:比對 en-US/zh-TW key 集合,CI/QA 用 | S | **ACCEPT** | 新增 150-300 keys,人工對齊必漏 |
| E7 | 全站實體級 hover 說明(每個 KPI/chart 元素) | M | **DEFER→TODOS** | 超出本波;12-month ideal 的下一步 |
| E8 | 書面 case study 靜態頁 | M | **DEFER→TODOS** | E1 覆蓋核心需求;書面版另一波 |

## Step 0E — Temporal Interrogation
```
HOUR 1: 先凍結 tour step schema + data-tour 命名規約(模組id.語意名,如 spc.chart)
        + i18n key 規約(tour.<tourId>.<stepId>.title/.body)——內容並行產出的前提
HOUR 2-3: spotlight 定位數學(四側擇優+viewport夾擠+bottom-sheet)、mount-await 原語
HOUR 4-5: hero 互斥、epoch choreography 凍結窗避讓、genuine-nav 中斷語義
HOUR 6+: 文案總量、QA 矩陣(11 tours × 2 locale × 3 breakpoints)、reduced-motion
(human ~3-4 天 / CC ~2-3 小時)
```

## Step 0F — Mode
**SELECTIVE EXPANSION**(autoplan override)+ Approach B。已承諾,不漂移。

## CEO DUAL VOICES — CONSENSUS TABLE
```
═══════════════════════════════════════════════════════════════
  Dimension                            Claude   Codex   Consensus
  ──────────────────────────────────── ──────── ─────── ─────────
  1. Premises valid?                   PARTIAL  N/A     [subagent-only] P-2/P-4 修訂後成立
  2. Right problem to solve?           YES*     N/A     [subagent-only] *建議重框為「90秒可信度」→已採納為成功準則
  3. Scope calibration correct?        DISAGREE N/A     [subagent-only] voice 主張砍 9 條模組導覽→保留(goal 明示最頂配),步數收緊
  4. Alternatives sufficiently explored? PARTIAL N/A    [subagent-only] 補 0C-bis 三方案+靜態頁替代分析(E8)
  5. Competitive/market risks covered? YES+     N/A     [subagent-only] 補 best-in-class 模式(E3/E4 採納)
  6. 6-month trajectory sound?         CONCERN  N/A     [subagent-only] anchor 腐爛→E2 採納後 sound
═══════════════════════════════════════════════════════════════
單聲道 critical 發現(#1 完整度≠可信度)已以「品質優先序+成功準則」吸收,scope 未砍。
```

## Sections 1-11(摘要承載完整分析;無發現處已述查核範圍)

### S1 Architecture
```
                ┌──────────── app.js (boot) ────────────┐
                │ 新增: tourEngine.init(ctx) + ?tour= 解析 │
                └───┬───────────────┬───────────────────┘
   ┌────────────────▼──┐   ┌───────▼────────────────────┐
   │ engine/tour-engine │   │ shell/nav.js (+? 鈕)        │
   │ (步驟序列器/持久化) │   │ shell/guide-hub.js (dialog) │
   └─┬────┬────┬────┬──┘   └────────────────────────────┘
     │    │    │    └──────► scenarios/tours.js (純資料)
     │    │    └───────────► components/spotlight.js (overlay+callout)
     │    └────────────────► shell/router.js (set/onModuleChanged/focus)
     └─────────────────────► modules/hero-story.js (mutex: stopHeroStory)
```
- 新耦合:tour-engine→router(既有公開 API)、tour-engine↔hero-story(互斥,單向呼叫 stop)。**裁決(taste #4)**:不做完整引擎合一,抽共用「module-switch-await-mount」原語進 tour-engine 並讓 hero-story 之後可遷移;本波不動 hero-story 內部編排(已出貨、有 QA 證據,重構風險>收益)。
- 10x 負載:N/A(靜態站、單使用者);步驟數 100+ 也只是資料。
- SPOF:無。Rollback:git revert + redeploy(靜態站原子部署)。
- 失敗場景:anchor 缺失/模組 mount 逾時 → 降級置中卡 + console.warn + QA anchorAudit 紅燈(E2)。

### S2 Error & Rescue Registry
```
CODEPATH                      | 可能出錯                     | 處置                          | USER SEES
------------------------------|------------------------------|-------------------------------|-----------
resolveAnchor(step)           | [data-tour] 不存在           | 降級置中卡 + warn + audit 記錄 | 置中說明卡(內容不丟)
awaitModuleMount(module)      | 2s 內未 mount(soft-fail panel)| 跳過該步 + warn               | 下一步;river 不中斷
localStorage get/set          | 私密模式/配額 SecurityError   | try/catch → 記憶體 fallback   | 導覽可用,進度不跨 session
t(key) 缺 key                 | 文案漏譯                     | 顯示 key + parity 腳本攔截(E6)| dev 可見;prod 由 E6 防
epoch freeze 撞步驟切換        | choreography 1.2s 窗         | 切換延後至窗結束(監聽既有 hook)| 平滑;無閃爍
hero story 進行中啟動 tour     | 競態                         | stopHeroStory() 先行,同步收尾 | hero 乾淨退場
?tour=<id> 無效 id            | 手改 URL                     | 忽略 + console.warn           | 正常首頁
JSON tour schema 錯誤          | 內容手誤                     | dev 模式 boot 時 validateTours() throw | dev 立即炸;prod 不載入該條
```
無 catch-all;每個 rescue 都有具名路徑。**0 CRITICAL GAPS**(每列均 rescued+visible)。

### S3 Security & Threat Model
查核:無後端、無新輸入面(query param `?tour=` 僅做白名單查表)、文案一律 textContent(沿用 i18n 既有紀律,無 innerHTML)、無新依賴、無 PII(localStorage 僅存布林/字串進度)。XSS:tour 內容是 repo 內靜態資料,非使用者輸入。**No issues found** — 查核面:輸入向量(1 個,白名單化)、注入面(0)、儲存(非敏感)。

### S4 Data Flow & Interaction Edge Cases
```
INTERACTION              | EDGE CASE                        | 處置
-------------------------|----------------------------------|------------------------------
Next/Prev 按鈕           | 連點/雙擊                        | 轉場中 disabled + 序列 token(final-wins,沿 router 模式)
鍵盤 1-9 / nav 點擊      | 導覽中真實導航                   | = genuine nav → 結束導覽,記 lastStep(與 hero 同語義)
Esc                      | 任意時刻                         | 結束 + 記 lastStep;invite 卡 Esc = dismiss
locale 切換(導覽中)      | callout 文案過期                 | onLocaleChange → 當前步重繪
theme 切換(導覽中)      | overlay 顏色                     | 全 token,自動跟隨
resize 跨斷點(導覽中)    | 錨點位置/姿態改變                | rAF reposition;跨入 <768 → 當前步轉 bottom-sheet
epoch 滾動(tick 180→0)  | 模組內容重排                     | 凍結窗避讓 + 步驟錨點重解析
visibilitychange(切 tab) | auto 模式倒數失準                | hidden → pause auto;visible → resume
replay 進行中再點 replay  | 重入                             | play() 冪等:先 stop 再 start
首訪邀請卡               | 使用者直接開始操作站台           | 任何 module:change → 邀請卡淡出(不糾纏),hub 永遠可回
```
全部納入 M4 QA 清單。

### S5 Code Quality
- 命名:tour id kebab(`grand-tour`)、step id 語意名、data-tour=`<module>.<slot>`。
- DRY:mount-await 原語單一實作於 tour-engine 並導出;hero-story 後續遷移記入 TODOS(P3)。
- 防過度工程:不引 FSM/狀態庫;引擎是 <400 行的顯式 switch。
- 防不足工程:tours 資料 boot 時 schema 驗證(dev throw / prod skip)。

### S6 Test Review(詳細測試計畫 → Phase 3 artifact)
```
NEW UX FLOWS: 邀請卡、manual tour、auto tour、hub 開關、explain-this、深連結啟動、中斷/續播
NEW DATA FLOWS: tours.js→engine→spotlight;progress→localStorage;?tour=→engine
NEW CODEPATHS: anchor resolve/degrade、mount-await timeout、epoch 避讓、hero mutex、i18n 重繪
NEW ASYNC: rAF reposition、auto 倒數計時器、mount 輪詢
NEW ERROR PATHS: S2 表全列
```
站內無單測框架(既有現實)→ 測試承載於:(a) `__SIM` QA 契約 + browse 腳本化驗證;(b) E2 anchorAudit;(c) E6 i18n parity 腳本;(d) M4 手動矩陣。2am 信心測試:anchorAudit 全綠 + 11 條導覽 headless 走完不拋錯。敵意 QA:Esc 連打、轉場中 resize、epoch 邊界啟動導覽。

### S7 Performance
- 單一 overlay 節點 + SVG mask;idle 時零 per-tick 工作(只在導覽 active 時掛 rAF/resize 監聽,結束即卸)。
- anchor 查找 O(1) querySelector;tours.js 一次性載入(~10KB 資料)。
- 無新網路請求;**No issues found** — 查核面:per-tick 熱路徑、監聽器生命週期、DOM 節點數。

### S8 Observability
- `__SIM.tourState()` = {active, tourId, stepIndex, anchorAudit[], dismissed, completed{}} — QA 唯一真相源。
- dev flag(`?debug=tour`)開 console.debug 步驟轉場日誌。
- 失敗可見性:降級事件記入 anchorAudit,QA 讀取即知;無靜默失敗。

### S9 Deployment & Rollout
- 靜態站;沿既有 gh-pages 流程。無 migration、無 flag 需求(localStorage key 帶 v1 版本)。
- 部署後冒煙:打開站 → `__SIM.tourState().anchorAudit` 全綠 → 深連結 ?tour=grand-tour 啟動成功。
- Rollback:git revert + 重跑部署(分鐘級)。

### S10 Long-Term Trajectory
- Reversibility:4/5(純增量;移除 = 刪 4 新檔 + 撤錨點屬性)。
- 債:tour 內容↔模組 DOM 的語意耦合(E2 audit 看門);hero-story 未遷移到共用原語(記 TODOS P3)。
- 1-year 可讀性:宣告式 tours.js + schema 註解,新工程師可循 heroTimeline 前例理解。

### S11 Design & UX(深審交給 Phase 2)
- IA:首屏 = 活的儀表板(hero 照常)→ 非阻斷邀請 → ? 鈕常駐。
- 狀態矩陣:spotlight {定位中=不顯示半成品, anchor缺=置中卡, 正常=遮罩+callout, 結束=fade};invite {首訪顯示, dismissed 永不, hub 可重啟}。
- DESIGN.md 對齊:callout = panel 語彙(bezel ticks)、cyan 僅聚焦描邊、--ease-instrument、reduced-motion 全尊重。
- 建議:Phase 2 全深度執行(autoplan 已排)。

## NOT in scope
- 真實後端/帳號/分析埋點(原計畫)。第三方 tour lib(0C-bis C 否決)。影片/音訊。
- hero-story 內部重構/遷移共用原語(風險>收益,TODOS P3)。
- E7 實體級 hover 說明、E8 書面 case study(DEFER)。
- 9 條模組導覽砍除案(單聲道建議,goal 明示最頂配 → 否決;以步數上限 4-6 控成本)。

## Dream state delta
本波後:站台從「需要旁白的 demo」變成「自我解說的展示品」,距 12-month ideal 剩 E7(實體級說明)與 E8(書面 case study)。

## Failure Modes Registry
```
CODEPATH            | FAILURE MODE        | RESCUED? | TEST?        | USER SEES?      | LOGGED?
--------------------|---------------------|----------|--------------|-----------------|--------
resolveAnchor       | 錨點缺失            | Y(降級)  | Y(anchorAudit)| 置中卡          | Y(audit)
awaitModuleMount    | mount 逾時          | Y(跳步)  | Y(QA)        | 下一步          | Y(warn)
localStorage        | SecurityError       | Y(記憶體) | Y(QA 私密模式)| 進度不持久      | Y(warn)
auto 倒數           | tab hidden 漂移     | Y(pause) | Y(QA)        | 回來續播        | N(無需)
epoch 撞期          | 凍結窗切步          | Y(延後)  | Y(QA)        | 平滑            | N(無需)
i18n 缺 key         | 漏譯                | Y(E6 攔) | Y(parity)    | dev 可見        | Y(腳本)
```
**0 CRITICAL GAPS**。

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | CEO | Mode = SELECTIVE EXPANSION | Mechanical | autoplan override | 既有系統的功能增強 | 其他三模式 |
| 2 | CEO | Approach B 自建宣告式引擎 | Taste(close: C) | P1+P5 | 核心難題=mount時序,lib 解決不了 | A 極簡 / C 第三方 |
| 3 | CEO | 保留全 11 條導覽 | Taste(voice 異議) | P1 + /goal「最頂配」 | 單聲道砍9條 vs goal 明示完整;步數上限4-6步收 i18n 成本 | 砍至 2 條 |
| 4 | CEO | 引擎統一只到「共用原語」層 | Taste | P3+P5 | hero-story 已出貨有 QA 證據;全合一風險>收益 | 完整合一 / 純 mutex 雙引擎 |
| 5 | CEO | 首訪邀請=非阻斷 coach-mark | Mechanical(品質) | P5 | 評審受眾反感劫持;hero 續任首訪 wow | 置中 modal |
| 6 | CEO | hero autoplay 維持 tick-3 優先 | Taste | P6 | hero 是 30 秒可信度鉤子;導覽邀請共存 | 導覽優先於 hero |
| 7 | CEO | Manual 預設+點擊前進;auto 須明選 | Mechanical(品質) | P5 | onboarding≠kiosk;倒數環僅 auto | auto 預設 |
| 8 | CEO | E1 How-this-works 總覽 ACCEPT | Expansion | P2(blast radius, S) | 評審單位價值最高 | — |
| 9 | CEO | E2 anchorAudit QA 契約 ACCEPT | Expansion | P1 | 防靜默腐爛 | — |
| 10 | CEO | E5 ?tour= 深連結 ACCEPT | Expansion | P2(S) | portfolio 分享 | — |
| 11 | CEO | E6 i18n parity 腳本 ACCEPT | Expansion | P1 | 150-300 新 key 人工必漏 | — |
| 12 | CEO | E7/E8 DEFER→TODOS | Mechanical | P3 | 超出本波 blast radius | 現在做 |
| 13 | CEO | premises 確認 gate 以 /goal 指令代行 | Exception | goal-mode | 使用者明示自主執行,gate 改為 final report 揭露 | 中斷等待 |

## Implementation Tasks (CEO)
- [ ] **T1 (P1, human: ~1d / CC: ~30min)** — engine — 建 tour-engine.js(schema、序列器、持久化、mutex、深連結、mount-await 原語)
  - Surfaced by: 0C-bis Approach B + S1/S2
  - Files: engine/tour-engine.js, app.js
  - Verify: __SIM.tourState() 契約 + ?tour=grand-tour 啟動
- [ ] **T2 (P1, human: ~1d / CC: ~30min)** — components — spotlight.js(SVG mask、callout 四側擇優、bottom-sheet、focus trap、a11y)
  - Surfaced by: D2 + S4 邊角表
  - Files: components/spotlight.js, styles/animations.css
  - Verify: 三斷點 + reduced-motion + Esc/連點 QA
- [ ] **T3 (P1, human: ~2d / CC: ~45min)** — content — tours.js 全 11 條(步數 4-6/條)+ tour.* 雙語 i18n + 全模組 data-tour 錨點
  - Surfaced by: D3 + Decision #3
  - Files: scenarios/tours.js, i18n/*.json, modules/*.js, shell/*.js
  - Verify: anchorAudit 全綠 + parity 腳本 0 diff
- [ ] **T4 (P1, human: ~0.5d / CC: ~20min)** — shell — ? 鈕 + guide-hub dialog(完成 LED、重設、How-this-works 頁)+ 非阻斷邀請卡
  - Surfaced by: D4/D5 修訂 + E1/E4
  - Files: shell/nav.js, shell/guide-hub.js, i18n
  - Verify: 首訪/回訪/重設三態 QA
- [ ] **T5 (P1, human: ~0.5d / CC: ~15min)** — qa — E2 anchorAudit + E6 parity 腳本 + QA 矩陣執行
  - Surfaced by: S6/S8 + E2/E6
  - Files: engine/tour-engine.js, tools/check-i18n-parity.mjs
  - Verify: node tools/check-i18n-parity.mjs exit 0
- [ ] **T6 (P2, human: ~2h / CC: ~10min)** — coordination — hero mutex + epoch 凍結窗避讓 + visibilitychange pause
  - Surfaced by: S2/S4
  - Files: engine/tour-engine.js, modules/hero-story.js(僅 stop 介面)
  - Verify: hero 播放中啟動 tour 乾淨退場

# PHASE 3 — ENG REVIEW (via /autoplan, `[subagent-only]`)

## Step 0 — Scope Challenge(對照真實碼)
槓桿地圖核驗:router `set(id,focus)`+`onModuleChanged` ✓、nav `setActiveSilent` ✓、`__SIM.stopHeroStory` ✓、dialog/toast 可複用 ✓。**4 個 API 假設為假**(下方 Addendum)。複雜度:~20 檔已於 Phase 1 裁決(錨點佈標機械性)。無測試框架(已驗證:tools/ 只有 serve.mjs)→ 測試承載策略成立但需 3 處補強(F13)。Search check:自建 tour engine 為 [Layer 3] 裁決(0C-bis);SVG mask spotlight 為業界標準模式 [Layer 1]。

## API GAP ADDENDUM(M1 前置,蓋過前文)
| # | 缺口 | 修正(成為實作規格) |
|---|---|---|
| A1 | `tick-scheduler.js` 無 `isChoreographing`/可訂閱 hook(F1, 10/10) | TickScheduler 新增公開 `isChoreographing()` getter + `addEpochListener(fn)`(reset 開始/結束各通知);tour 步驟切換在凍結窗內一律延後到窗口結束 |
| A2 | hero-story 無 finished 訊號(F2, 9/10) | HeroStory 增加 `onFinish` callback(`_finish()` 與 `stop()` 都觸發);app.js 接線 → 邀請卡在 onFinish 後顯示(DS-2) |
| A3 | `.dialog-backdrop` 實際無 z-index;`--z-dialog` token 不存在(F3, 9/10) | tokens.css 新增 `--z-dialog: 9500` 並套用到 `.dialog-backdrop`;階梯定案:tour-overlay 9000 / tour-callout 9010 < dialog 9500 < vignette 9999 < toast 10000 |
| A4 | `?sim=`/`?debug` 並不存在;`?tour=` 是全站第一個 query 讀取(F6, 9/10) | boot() 新增唯一的 URL 解析點:`?tour=` 嚴格白名單(tours.js id 集合),其餘忽略+warn;`?debug=tour` 同點解析 |

## ENG 裁決(F4-F14 全採納為實作規格)
- **F4 雙 focus-trap**:dialog 開啟期間(偵測 `.dialog-backdrop` 存在)tour 暫停自身 focus trap 與 Esc handler;Guide Hub 開在暫停的 tour 之上時,Esc 只關 dialog。不在 KPI popover 內錨步驟。
- **F5 隱藏錨點**:resolver 增加 `offsetParent === null` 檢測(present-but-hidden = 不可聚焦);step schema 增 `fallbackAnchor`;KPI 步驟錨整條 strip(`kpi.strip`),不錨單卡。
- **F7 mount-await 強化**:`await router.set()` 後驗證 `router.getActive()===expected` 且 `#content` 無 `.route-error`,再 double-rAF,再錨點輪詢(2s 上限)。
- **F8 兩種捲動域**:spotlight 重定位監聽 = `#content` scroll + window resize + 步驟 active 期間的 rAF;**錨點每幀以 selector 重解析,不快取節點**(同時解 F12 epoch 重繪);river 步驟錨容器不錨 chip。
- **F9 dispatcher 隔離**:tour 完全不走 dispatcher(避免 `_assertType` throw);用 DOM/`__SIM` 溝通。
- **F10 行動端邀請**:`<768` 邀請改 bottom-sheet 形式(不錨 ? 鈕);? 鈕在底欄的 scroll-into-view 由 Guide Hub 開啟時處理。
- **F11 安全**:callout 渲染一律 `textContent`/`createElement`(模組既有 innerHTML 模式不得複製);`?tour=` 白名單是唯一路徑。
- **F13 測試補強**:parity 腳本除 key 集合外加驗「值非空」+「en/zh 同值」警告;anchorAudit 帶 viewport 參數(desktopOnly 步驟在 <768 跳過不算紅);手動 QA 增「hub-over-tour 的 Esc/focus」項。
- **F14 module:change 單一消費者**:tour 進行中 hero 必不在播(mutex),tour 的 exit handler 是唯一 nav 中斷消費者;hero `_onUserNav` 以 `_playing` 守衛(實作時驗證)。

## ENG DUAL VOICES — CONSENSUS TABLE
```
═══════════════════════════════════════════════════════════════
  Dimension                      Claude        Codex   Consensus
  ────────────────────────────── ───────────── ─────── ─────────
  1. Architecture sound?         YES w/ A1-A4  N/A     [subagent-only]
  2. Test coverage sufficient?   GAPS→F13 補   N/A     [subagent-only]
  3. Performance risks?          OK(reposition 規格化) N/A  [subagent-only]
  4. Security threats covered?   YES w/ F11    N/A     [subagent-only]
  5. Error paths handled?        YES w/ F5/F7  N/A     [subagent-only]
  6. Deployment risk?            LOW(靜態)     N/A     [subagent-only]
═══════════════════════════════════════════════════════════════
14 findings(5 P1 / 5 P2 / 4 P3)全採納;4 個 API 缺口在 M1 前補。
```

## 測試覆蓋圖(Section 3)
```
CODE PATHS                                          USER FLOWS
[+] engine/tour-engine.js                           [+] 首訪
  ├── start/stop/next/prev      [QA: __SIM 驅動]      ├── hero 完→邀請現 [QA 手動+__SIM]
  ├── mount-await (F7 三段驗證)  [QA: 跨模組走完]      ├── 邀請略過→永不再彈 [QA localStorage]
  ├── anchor resolve/hidden/degrade [anchorAudit]     └── ?tour= 深連結 [QA URL]
  ├── epoch defer (A1)          [QA: setEpochLength 縮短重現]
  ├── hero mutex (A2)           [QA: 播放中啟動]    [+] 導覽中
  ├── localStorage fallback     [QA: 私密模式]        ├── 真實 nav 中斷→lastStep [QA]
  └── visibilitychange pause    [QA: 切 tab]          ├── locale/theme 切換重繪 [QA]
[+] components/spotlight.js                           ├── resize 跨斷點→bottom-sheet [QA]
  ├── 四側擇優/夾擠/bottom-sheet [QA 三斷點]           ├── Esc/連點 Next [QA]
  ├── #content scroll 追蹤 (F8)  [QA: 捲動中]          └── hub-over-tour Esc/focus [QA 手動 a11y]
  └── focus trap 暫停 (F4)       [QA 手動]
[+] tools/check-i18n-parity.mjs  [self-testing: exit code]
COVERAGE 承載:anchorAudit(自動)+ parity(自動)+ __SIM 矩陣(腳本化)+ 手動 a11y 4 項
REGRESSION RULE:hero-story 與 epoch choreography 是被觸碰的既有行為 → QA 必含
  「hero 完整播放不受 tour 程式碼存在影響」+「epoch 轉場無 tour 時行為不變」兩條回歸項
```

## Worktree 並行策略
單一 session 順序實作(M1→M2→M3→M4);內容(T3)與引擎(T1/T2)可由 subagent 並行,但檔案不相交(tours.js/i18n vs engine/components),無需 worktree 隔離。

# PHASE 2 — DESIGN REVIEW (via /autoplan, `[subagent-only]`)

## Step 0 — Design Scope Assessment
- **0A 初評 4/10**:工程過度規格、視覺/時間編排欠規格(S11 全推給 Phase 2)。10/10 = 每個 ring/scrim/倒數/堆疊都釘在既有 token 階梯與 tick 紀律上。
- **0B DESIGN.md 存在** → 全部決策對齊 instrument-grade 正典。
- **0C 既有槓桿**:hero caption(max-width 520px, z-40)、`.panel` bezel ticks、`.label` engraved 標頭、dialog 9998/toast 10000、z-index 階梯(tokens.css 81-91)、skeleton shimmer loading 語彙。
- **0D Focus**:全 7 passes(autoplan 預設)。

## DESIGN DUAL VOICES — LITMUS SCORECARD
```
═══════════════════════════════════════════════════════════════
  Litmus                                Claude   Codex   Consensus
  ─────────────────────────────────────  ──────  ──────  ─────────
  1. 首屏品牌/產品無誤辨識?              YES      N/A    [subagent-only]
  2. 單一視覺錨點?                       FIXED    N/A    spotlight=主角規則(F1)後 YES
  3. 掃標題即可懂?                       FIXED    N/A    時間預算文案(F10)後 YES
  4. 每區一職?                           YES      N/A    callout footer 收斂後 YES
  5. 卡片必要性?                         YES      N/A    callout=panel 語彙,非裝飾卡
  6. 動效服務層級/氛圍?                  FIXED    N/A    倒數環降權+tick 對齊(F8)後 YES
  7. 去陰影仍 premium?                   YES      N/A    hairline 紀律本來就無裝飾陰影
═══════════════════════════════════════════════════════════════
13 findings: 3 critical / 6 high / 4 medium — 全數採納為規格(無 scope 變更)
```

## DESIGN SPEC(Pass 1-7 裁決後的實作正典 — 蓋過前文任何含糊處)

### DS-1 資訊層級(每個導覽步驟)[crit #1]
1st **spotlight 挖洞 + 呼吸 cyan hairline(1px,對齊 `--tick`)** = 唯一主角
2nd callout 標題(`.label` engraved,11px/600/uppercase)
3rd 內文(`--fs-body` 13px,`--text`)
4th footer 控制列(`--text-secondary`:步數 3/12、Prev/Next/Skip)— 退為 chrome
5th auto 倒數環:**周邊、低對比**(2px arc、`--accent` @ .35、直徑=Next 鈕高度)— 永不搶 target
規則:**動的東西只允許兩個** — spotlight 呼吸與倒數環,且倒數環對比必須最低。

### DS-2 首訪時間編排 [crit #2]
```
t=0     POST boot choreography(既有)
t=3tick hero story autoplay(既有,不讓位)
hero _finish() / 中斷 / reduced-motion 不播 → 此刻才顯示邀請 coach-mark
邀請錨在 ? 鈕,promise 時間預算:「30 秒學會操作 / Learn the controls in 30s」
按鈕:[開始] [略過]。任何 module:change → 邀請淡出(不糾纏)。
```
規則:hero `▶` indicator 與邀請卡**不得同時出現**在 topbar/nav 區。
D5 修訂:「自動播放全程」從首訪邀請移除,改為 Guide Hub 內選項(kiosk 模式)。
Grand tour 的第一入口 = onboarding 完結卡的後續行動。

### DS-3 跨模組 mount 過渡 [high #3]
scrim 保持落下;前一 callout 原地轉為「下一站…」迷你卡(skeleton shimmer,**非 spinner**,§7 語彙);anchor 解析成功 → 200ms cross-fade(`--ease-instrument`)把 spotlight 移到新目標。逾時 2s → DS-12 降級卡。

### DS-4 完結時刻 [high #4]
每條 tour 末步 `final: true`:置中總結卡(無錨點、無挖洞),一句總結(如「你剛跟著一片晶圓走完 訂單→良率 全流程」),兩個行動:[自由探索] [打開導覽中心];同時 Guide Hub LED 翻 ●。onboarding 的完結卡第三行動:[繼續:晶圓之旅 90 秒]——grand tour 的轉化入口。

### DS-5 Z-index 階梯入座 [crit #5]
tokens.css 新增:`--z-tour-overlay: 9000`、`--z-tour-callout: 9010`。
階序:rail 100 < tooltip 110 < hero caption 40(content 內)< **tour 9000/9010** < dialog 9998(Guide Hub 開在 tour 之上)< vignette 9999(pointer-none 氛圍)< toast 10000。
**裁定:toast 穿透 tour**(alarm `aria-live=assertive` 必須浮出)— 記為有意行為。

### DS-6 焦點環 vs spotlight 環 [high #6]
spotlight = 呼吸 hairline(target 專屬語意);callout 內鍵盤焦點 = 既有按鈕 focus 樣式(outline + offset,**不另造 cyan ring**)。兩者不得視覺同形。

### DS-7 尺寸規格 [high #7]
- mask padding:預設 8px;step schema 允許 `pad` 覆寫(大目標如整條 event river 用 16px)。
- callout `max-width: 520px`(對齊 hero caption);min-width 280px。
- `<768` bottom-sheet:`max-height: min(45vh, content)`;**規則:挖洞目標必須保持在 sheet 上方可視區** — 步驟啟動時將 target scroll 至上半 50vh。
- 觸控目標 ≥44px(Prev/Next/Skip)。

### DS-8 倒數環規格 [high #8]
2px stroke、`--accent` @ .35、直徑 28px(=Next 鈕)、**7s = 7 ticks**,以 tick 對齊的 7 段推進(每段 eased);hover/focus 暫停 = **凍結不重置**;reduced-motion → 改為「7s 後 Next 鈕高亮」無環。

### DS-9 Scrim 雙主題 [med #9]
深色:`rgba(8,16,32,.7)`;淺色:獨立值(theme.css 定義,約 `rgba(20,30,45,.45)`)→ token `--tour-scrim` 隨 data-theme 切換。callout 文字永遠坐在實心 `--bg-elevated` panel 上(對比 ≥4.5:1 由既有 token 保證)。與 vignette 堆疊已由 DS-5 解(vignette pointer-none 在上,無互動影響)。

### DS-10 入口轉化 [high #10]
第一個 ask = 30 秒 onboarding(非 18 步 grand tour)。邀請文案承諾時間預算。grand tour 改為 onboarding 完結卡轉化 + Guide Hub + 深連結三入口。

### DS-11 文案聲音錨點(雙語規範例)[med #11]
- step title(engraved,≤4 詞):`KPI 燈板` / `KPI STRIP`
- step body(1-2 句,儀器手冊語氣,先功能後意義):`六個即時指標,每秒隨 tick 重算。黃/紅閾值來自場景設定檔。` / `Six live metrics, recomputed every tick. Warning and danger bands come from the scenario manifest.`
- 邀請:`30 秒學會操作這座工廠。` / `Learn the controls in 30 seconds.`
- 完結卡:`你剛跟著批次 L-042 走完 訂單→良率 的全流程。` / `You just followed lot L-042 from order to yield.`
- desktopOnly 替代卡:沿用既有 `common.desktopOnly` 語彙 + 桌面 glyph。
禁:行銷話術、驚嘆號、「強大的」「輕鬆地」。

### DS-12 降級置中卡 [med #12]
同 callout chrome(panel + bezel ticks)、scrim 保留、**無挖洞、無道歉文案**(直接顯示內文,讀起來像有意設計)、照常推進。dev 模式 console.warn + anchorAudit 記錄。

### DS-13 desktopOnly 行動端簽名 [med #13]
與 DS-12 視覺區別:卡頭帶桌面 glyph + `states.desktopOnly` 既有 notice 語彙,讓「桌面限定」與「降級」不可混淆。

## Pass 評分
```
Pass 1 資訊層級   4/10 → 9/10(DS-1/DS-2)
Pass 2 狀態覆蓋   5/10 → 9/10(DS-3/DS-4/DS-12/DS-13 + S11 矩陣)
Pass 3 旅程情感   5/10 → 9/10(DS-2/DS-4/DS-10 storyboard:wow→邀請→30s→轉化→finale)
Pass 4 AI Slop    6/10 → 9/10(off-the-shelf tour lib 即 slop;DS 全套釘死 instrument 語彙)
Pass 5 設計系統   7/10 → 10/10(DS-5 token 入座、DS-9 雙主題、bezel ticks 沿用)
Pass 6 響應/a11y  6/10 → 9/10(DS-7 bottom-sheet 規則、44px、DS-6 焦點、DS-8 reduced-motion)
Pass 7 未決事項   13 → 0(全數裁決)
Overall: 4/10 → 9/10
```

## Design Implementation Tasks
- [ ] **D-T1 (P1, human ~2h / CC ~10min)** — tokens — `--z-tour-overlay/--z-tour-callout/--tour-scrim` 入 tokens.css+theme.css(DS-5/DS-9)
- [ ] **D-T2 (P1)** — spotlight — DS-1/6/7/8 全規格實作(已併入 CEO T2)
- [ ] **D-T3 (P1)** — engine — DS-2 邀請時序 + DS-3 過渡 + DS-4 final step type(併入 T1/T4)
- [ ] **D-T4 (P1)** — content — DS-11 文案聲音 + DS-10 入口結構(併入 T3)

## Decision Audit Trail(Phase 2 增補)
| # | Phase | Decision | Classification | Principle | Rationale |
|---|-------|----------|----------------|-----------|-----------|
| 14 | Design | DS-1 spotlight 主角層級規則 | Mechanical | P5 | 動效搶眼問題的唯一顯式解 |
| 15 | Design | DS-2 邀請等 hero 結束 | Taste→裁決 | P6+Krug | 兩個 look-here 訊號不得並發 |
| 16 | Design | DS-4 final step type | Mechanical | P1 | 完結是整條 tour 最強一拍 |
| 17 | Design | DS-5 z-token 入座+toast 穿透裁定 | Mechanical | P5 | 防 integer race;alarm 必須浮出 |
| 18 | Design | DS-8 倒數環 7s=7ticks | Mechanical | DESIGN.md 動態紀律 | 外來連續動畫違反 tick 心跳 |
| 19 | Design | DS-10 第一 ask=30s onboarding | Taste→裁決 | Krug goodwill | 18 步首邀必死;轉化鏈替代 |
| 20 | Design | 視覺 mockup 略過 | Exception | autoplan checklist | feedback board 需真人;DESIGN.md 已定案且 DS 規格錨定既有元件 |

## CEO Completion Summary
```
+====================================================================+
| Mode: SELECTIVE EXPANSION | Voices: [subagent-only](codex 限額)     |
| Step 0: B 方案;8 expansion 候選:6 ACCEPT / 2 DEFER                |
| S1 Arch: 1 issue(引擎統一層級)→ 裁決 #4                            |
| S2 Errors: 8 paths mapped, 0 GAPS                                  |
| S3 Security: No issues(查核:輸入/注入/儲存)                        |
| S4 Data/UX: 10 edge cases mapped, 0 unhandled                      |
| S5 Quality: 4 規約定案                                              |
| S6 Tests: diagram 完成;測試承載=QA契約+2腳本(無單測框架為既有現實)  |
| S7 Perf: No issues(查核:熱路徑/監聽器/DOM)                         |
| S8 Observ: tourState 契約 + debug flag,無靜默失敗                  |
| S9 Deploy: 靜態;冒煙清單定案                                       |
| S10 Future: Reversibility 4/5;債 2 項(1 入 TODOS)                 |
| S11 Design: IA+狀態矩陣初核 → Phase 2 深審                          |
| NOT in scope: 7 items | 已存在槓桿: 6 項 | Dream delta: 已寫        |
| Error/rescue: 8 methods, 0 CRITICAL | Failure modes: 6, 0 CRITICAL |
| TODOS: 3 items(E7、E8、hero 原語遷移) | Scope: 8 proposed, 6 accepted |
| Unresolved: 0(goal-mode 自動裁決,taste 決策 #2/#3/#4/#6 於終局揭露)|
+====================================================================+
```

# PHASE 4 — FINAL GATE

## Cross-Phase Themes(2+ phase 獨立浮現 = 高可信訊號)
- **錨點靜默腐爛**:CEO voice #4 + Eng F5/F8/F12 獨立命中 → anchorAudit(E2)+ 每幀 selector 重解析 + hidden 偵測,三重防線。
- **首訪注意力編排**:CEO #2/#6 + Design #2/#10 + Eng A2 獨立命中 → hero 先 wow、邀請等 onFinish、30s onboarding 為第一 ask 的轉化鏈。
- **儀器紀律 vs 外來動畫**:Design #8 + DESIGN.md 動態紀律 → 倒數環 7s=7ticks、所有過渡 `--ease-instrument`。

## Taste Decisions(單模型,goal-mode 自動裁決;如需翻案見 audit trail)
1. **#3 保留全 11 條導覽**(voice 主張砍 9 條)— /goal「最頂配」明示完整 → 保留,步數 4-6 收斂成本。
2. **#4 引擎統一只到共用原語層** — 不重構已出貨 hero;遷移入 TODOS P3。
3. **#6 hero autoplay 維持首訪優先** — 邀請以 onFinish 後的非阻斷卡共存。
4. **#2 Approach B 自建引擎**(vs 第三方 lib)— mount 時序是核心難題,lib 不解。

## Phase 3.5 skipped — no developer-facing scope detected(產品=訪客導向展示站;__SIM 為內部 QA 契約)。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR (via /autoplan) | 8 proposals, 6 accepted, 2 deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | UNAVAILABLE(usage limit until 2026-07-08) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (via /autoplan) | 14 issues, 0 critical gaps(全採納為規格) |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR (via /autoplan) | score: 4/10 → 9/10, 13 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | SKIPPED(no dev-facing scope) | — |

- **VERDICT:** CEO + ENG + DESIGN CLEARED — ready to implement(single-model `[subagent-only]`;codex 限額降級)。
NO UNRESOLVED DECISIONS
