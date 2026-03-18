# Changelog - AG Manager

## [1.2.2] - 2026-03-18

### 🇻🇳 Tiếng Việt
- **Gỡ bỏ Claude Code & Codex:** Vì không thể giám sát chính xác theo thời gian thực (độ chính xác 0%).
- **Cảnh báo Group:** Kích hoạt cảnh báo trung bình theo từng nhóm thay vì từng model, giảm phiền toái spam Notification.
- **Sắp xếp Cố định:** Cố định vị trí các model trong Dashboard không bị xáo trộn.
- **Vá lỗi Automation:** Sửa lỗi script tự động bị kẹt với tính năng tự dò port server. Bổ sung bộ đếm số lần fail (Fallback Safety Switch) để tắt an toàn.

### 🇺🇸 English
- **Removed Claude Code & Codex:** Removed due to lack of reliable real-time tracking support (0% accuracy).
- **Group Notifications:** Switched warnings from individual models to group metrics to reduce alert spam.
- **Fixed Model Ordering:** Fixed positional rendering grid for all models to stop random shuffling.
- **Automation Fixes:** Implemented dynamic port-scanning heartbeat and a safety fail-switch for unresponsive behavior in the Automation Suite.

## [1.2.0] - 2026-03-17

### 🇻🇳 Tiếng Việt
- **Hỗ trợ Đa Dịch vụ:** Tích hợp Claude Code và Codex (ChatGPT) vào dashboard.
- **Giao diện HP Bar:** Claude và Codex sử dụng thanh tiến trình dạng fluid (HP bar) trong status bar popup.
- **Logic Gauge Mới:** Claude xoay xuôi chiều kim đồng hồ, Codex/Antigravity xoay ngược chiều.
- **Làm mới Tự động:** Thêm tính năng tự động quét dữ liệu ngầm (1-30 phút).
- **Thông báo Cảnh báo:** Hiện Warning khi quota sắp cạn (Claude > 80%, model khác < 20%).
- **Tinh chỉnh UI:** Màu cam đặc trưng cho Claude và tối giản icon trên Status bar.

### 🇺🇸 English
- **Multi-Service AI Monitoring:** Added support for Claude Code and Codex (ChatGPT).
- **HP Bar Visualization:** Fluid progress indicators for Claude and Codex in the status bar popup.
- **Directional Gauge Logic:** Clockwise for Claude, Counter-clockwise for Codex/Antigravity.
- **Auto-Refresh:** Added background quota updates (configurable 1-30 minutes).
- **Smart Notifications:** Warning alerts for high Claude usage (>80%) or low balance (<20%).
- **UI Refinements:** Characteristic orange styling for Claude and cleaner status bar layout.
