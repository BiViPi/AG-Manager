# Changelog - Antigravity-Codex-Claude Monitor

## [1.4.0] - 2026-04-11
- **Claude (OAuth) Integration:** Monitor official Claude account quotas via integrated OAuth support.
- **Master Grouping:** Organized the Antigravity ecosystem into a unified Master group with professional hierarchy.
- **Accordion System:** Collapsible/Expandable model groups to save space, with persistent state memory across sessions.
- **Ultra-Compact Dashboard:** Redesigned model cards and HP bars for maximum information density.
- **Master Toggle:** One-click Master Eye toggle to hide/show the entire Antigravity ecosystem on both Status Bar and Popup.
- **Branding Consistency:** Unified 3-color Antigravity gradients across Dashboard and Master headers.

## [1.3.0] - 2026-04-09
- **Codex Quota Monitoring:** Re-integrated OpenAI Codex (ChatGPT) monitoring with high-precision (99%) session file parsing.
- **HP Bars (Depleting):** Visualize 5-hour and Weekly limits using HP-style bars (depleting from 100% to 0%), styled in Green.
- **Enhanced Status Bar:** Direct display of Codex quota percentages (C5H, CW) on the VS Code status bar.
- **Tooltip Refinements:** Streamlined tooltip SVG, removed redundant token info, and added a quick Refresh command.
- **Dashboard Polish:** High-visibility group headers and improved layout for Token Usage metrics.

## [1.2.2] - 2026-03-18
- **Removed Claude Code & Codex:** Removed due to lack of reliable real-time tracking support (0% accuracy).
- **Group Notifications:** Switched warnings from individual models to group metrics to reduce alert spam.
- **Fixed Model Ordering:** Fixed positional rendering grid for all models to stop random shuffling.
- **Automation Fixes:** Implemented dynamic port-scanning heartbeat and a safety fail-switch for unresponsive behavior in the Automation Suite.

## [1.2.1] - 2026-03-18
- **Maintenance Update:** Internal performance optimizations and bug fixes for the background tracker.

## [1.2.0] - 2026-03-17
- **Multi-Service AI Monitoring:** Added support for Claude Code and Codex (ChatGPT).
- **HP Bar Visualization:** Fluid progress indicators for Claude and Codex in the status bar popup.
- **Directional Gauge Logic:** Clockwise for Claude, Counter-clockwise for Codex/Antigravity.
- **Auto-Refresh:** Added background quota updates (configurable 1-30 minutes).
- **Smart Notifications:** Warning alerts for high Claude usage (>80%) or low balance (<20%).
- **UI Refinements:** Characteristic orange styling for Claude and cleaner status bar layout.
