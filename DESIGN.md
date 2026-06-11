# DESIGN.md — MOM FAB 設計系統正典

> CLAUDE.md 規則:所有視覺/UI 決策必須以本檔為準。Token 實作在 `styles/tokens.css` 與 `styles/theme.css`;本檔與計畫 (`.omo/plans/mom-fab-simulation.md`) 的互動狀態矩陣互為參照。參考實作 (視覺天花板基準):`design/reference-spc.html`。

## 1. 美學方向:Instrument-Grade (儀器級)

這不是「炫的 dashboard」,是**被校準過的精密儀器**。可信度來自克制:hairline 格線、銳角資料面板、單一 phosphor cyan 重音、語義色嚴格保留給狀態。判斷任何視覺決策時問:「Keysight 示波器會這樣做嗎?」

**簽名元素 — 校準刻度括號 (panel bezel ticks)**:每個資料面板四角有 12px hairline 刻度 (`.panel`,theme.css 實作一次,全模組繼承)。這是本產品被記住的視覺指紋,不得移除或加粗成裝飾框。

**動態紀律**:所有動畫對齊 1s tick 心跳 (`--tick`);KPI count-up 0.8s (`--countup`,必須完整落在 tick 窗口內);開機為 POST 式 choreographed 序列 (面板依序亮起,hairline 先畫、內容後浮)。緩動一律 `--ease-instrument`,禁止 bounce。`prefers-reduced-motion` 全域尊重。

## 2. 品牌

- 名稱:`--brand-name` token,暫代 **'FAB MOM'** (定案後僅換 token + `assets/brand-mark.svg`)
- 位置:nav 軌頂部 48px mark 槽 (單色幾何,currentColor, 24px) + topbar 左端產品名文字
- 公開檔案禁止出現 Applied Materials / SmartFactory / Critical Manufacturing (F4 強制)

## 3. 字體

| 用途 | 字體 | 載入 |
|---|---|---|
| Body/標題 | IBM Plex Sans 400/600 | self-host `vendor/fonts/*.woff2` |
| 數字/代碼 (一律 tabular-nums) | JetBrains Mono 400/700 | self-host |
| CJK | 系統棧 (PingFang TC → Microsoft JhengHei → Noto Sans CJK TC) | 不自帶 (離線限制) |

**禁止任何 CDN 字體載入。** 字級只有五階:11/13/15/20/32 (`--fs-*`)。Section 標頭用 engraved label 樣式 (`.label`:11px/600/uppercase/0.08em tracking)。

## 4. 色彩

深色 (預設,監控) / 淺色 (報表閱讀) 雙主題;**主題唯一來源 = 使用者 toggle 寫 `data-theme`,模組不得覆寫**。

深色:bg `#0a1428` / elevated `#142840` / inset `#081020`、text `#e8f1ff` / secondary `#8fa8c7`、accent `#00d4ff` (唯一重音)、success `#3ddc97`、warn `#ffb547`、danger `#ff4d6d`、grid `rgba(0,212,255,.08)`。淺色見 theme.css。全部文字組合須 ≥4.5:1 (F2 雙主題審計)。

**色彩紀律**:cyan 只給「活的資料」(當前值、selection、互動焦點);amber/red 只給語義狀態;禁止裝飾性漸層與發光 — 唯一允許的氛圍層是深色主題的 vignette (theme.css `body::after`)。

## 5. 元件規格

- **面板**:`.panel` (bezel ticks 內建);資料面板 `--r-sharp: 0`,卡片/按鈕 4px,dialog 8px
- **表格**:固定列高 36px、cell padding 8px 12px、表頭 engraved label、zebra 用 `--bg-inset`;>50 列虛擬滾動
- **Status LED**:色+形雙編碼 (`.led-*`):● ok ▲ warn ■ fault — 色弱可辨,不得只用顏色
- **圖表** (chart-kit 工廠):axis 10px、grid 1px `--grid`、tooltip 12px、transition 200ms、`.interrupt()` 前置;內建 empty/loading/partial 態
- **Toast**:`aria-live=polite`;警報級 `assertive`。事件河 `role=log` + `aria-live=off`

## 6. Viewport 矩陣 (T33)

| 斷點 | 姿態 |
|---|---|
| ≥1366 | 桌面全互動 (1366-1919 降級:KPI 6→4+popover、河 chip = floor(寬/160) min 6) |
| 768–1365 | 單欄化,互動保留 |
| <768 | 監看儀:KPI 2×3、河直列、每模組一張代表圖全寬、甘特→清單、操作功能顯示「桌面版功能」notice;touch target ≥44px |

## 7. 導覽系統 (Guided Tours)

規格正典在 `.omo/plans/guided-tour.md` 的 DESIGN SPEC(DS-1〜DS-13);此處只記不變式:

- **層級**:spotlight 挖洞+1px 呼吸 hairline(對齊 `--tick`)是唯一主角;callout 標題用 engraved label;footer 控制列退為 `--text-secondary`;auto 倒數環 2px/`--accent`@.35/7s=7 ticks,永不搶 target。
- **z 階梯**:`--z-tour-overlay: 9000` < `--z-tour-callout: 9010` < `--z-dialog: 9500`(Guide Hub 開在 tour 之上)< vignette 9999 < toast 10000(**toast 有意穿透 tour** — 警報必須浮出)。
- **scrim**:`--tour-scrim` 隨 data-theme 切換;callout 文字永遠坐在實心 `--bg-elevated` 上。
- **首訪編排**:hero story 維持 tick-3 autoplay 優先;邀請卡等 hero onFinish 才現身,非阻斷、無 scrim、承諾時間預算(30 秒)。第一個 ask 永遠是 onboarding,grand tour 走完結卡轉化。
- **降級語彙**:anchor 缺失 → 同 chrome 置中卡(無道歉文案);desktopOnly 行動端 → 桌面 glyph + `states` notice 語彙,兩者不可混淆。
- callout `max-width` 520px(對齊 hero caption);`<768` 一律 bottom-sheet(`max-height: min(45vh, content)`,挖洞目標保持在 sheet 上方)。

## 8. 互動狀態

每個模組五態 (loading/empty/error/success/partial) 規格見計畫「互動狀態規格」矩陣。原則:loading = skeleton shimmer (非 spinner);empty = 溫度文案 + 確定性 tick 預告;error = boot 橫幅語彙的 inline 版;partial = 靠左繪製 + 右側淡格線。狀態文案全部走 i18n `states.*`。
