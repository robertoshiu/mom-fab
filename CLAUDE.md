# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## gstack
Use /browse from gstack for all web browsing. Never use mcp__claude-in-chrome__* tools.
Available skills: /office-hours, /plan-ceo-review, /plan-eng-review, /plan-design-review,
/design-consultation, /review, /ship, /land-and-deploy, /canary, /benchmark, /browse,
/qa, /qa-only, /design-review, /setup-browser-cookies, /setup-deploy, /retro,
/investigate, /document-release, /codex, /cso, /autoplan, /careful, /freeze, /guard,
/unfreeze, /gstack-upgrade.
If gstack skills aren't working, run `cd .claude/skills/gstack && ./setup` to build the binary and register skills.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that does not match DESIGN.md.

## Model Dispatch Policy
Main loop(Fable)退居純編排者:所有實質動作一律透過 Agent tool 派發給正確層級的 subagent(指定 `model` 參數),每次動作都必須嚴格遵守:

| 動作類型 | model |
|---|---|
| 查詢、搜尋、檔案探索 | `haiku` |
| 機械性工具操作、建置/測試 | `sonnet` |
| 實作/寫碼、判斷、綜合 | `opus` |
| 深度分析 | `fable` |

Main loop 只保留:
- 與使用者對話與回報
- 設計、規劃、code review 的思考本身(fable 三個保留領域)
- skill 調用
- 撰寫 agent prompt、讀 agent 報告
- 記憶檔/設定檔簿記等最小黏合

拿不準是「黏合」還是「工作」時,一律派發。
