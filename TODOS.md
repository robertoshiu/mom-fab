# TODOS

## From /autoplan guided-tour review (2026-06-11)

- [ ] **E7 實體級 hover 說明**(P3, M effort human ~3d / CC ~1h)
  - What: 全站 KPI 卡、chart 元素、表格列的隨選 hover/focus 解說(tooltip 層)。
  - Why: 12-month ideal 的下一步——從「導覽解說」到「每個元素自我解說」。
  - Context: tour 系統的 spotlight/callout 元件與 i18n 規約可直接複用;錨點即 data-tour 屬性。
  - Depends on: guided-tour 系統落地。

- [ ] **E8 書面 case study 靜態頁**(P3, M effort human ~2d / CC ~40min)
  - What: 可連結、可截圖的「How it's built」靜態頁(架構、決定論引擎、設計系統、tour 系統)。
  - Why: 對招聘方,書面敘事展示思考過程,比互動導覽更利於非同步評閱與轉發。
  - Context: Guide Hub 的 How-this-works 頁是濃縮版;此項是完整版。素材在 .omo/plans/ 與 DESIGN.md。

- [ ] **hero-story 遷移到 tour-engine 共用 mount-await 原語**(P3, S effort human ~4h / CC ~15min)
  - What: hero-story.js 的 router.set+等待+中斷邏輯改用 tour-engine 導出的原語,消除雙實作。
  - Why: DRY;目前兩處各自維護跨模組編排的時序細節。
  - Context: CEO 裁決 #4 本波不動已出貨的 hero;tour-engine 的原語(F7 三段驗證)比 hero 現行版更強。
  - Depends on: guided-tour 系統落地且 QA 通過。
