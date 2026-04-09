/**
 * AG Manager - Internationalization (i18n)
 * Supported locales: 'en' (English), 'vi' (Vietnamese)
 */
window.I18N = {
    en: {
        'dashboard.title': 'Quota Dashboard',
        'btn.refresh': 'Refresh',
        'loading': 'Establishing connection...',
        'error.noServer': '⚠️ Local server not found.\nEnsure Antigravity IDE is running.',
        'automation.title': 'Automation Suite',
        'automation.masterSwitch': 'Auto System',
        'automation.statusActive': 'Active',
        'automation.statusIdle': 'Idle',
        'automation.statusPaused': 'Paused',
        'rule.Run': 'Running (Run)',
        'rule.Allow': 'Permission (Allow)',
        'rule.Accept': 'Accept',
        'rule.AlwaysAllow': 'Always Allow',
        'rule.Retry': 'Retry',
        'rule.KeepWaiting': 'Skip Wait',
        'rule.AcceptAll': 'Accept All',
        'tokenUsage.title': 'TOKEN USAGE FOR CODEX',
        'tokenUsage.total': 'Total',
        'tokenUsage.last': 'Last',
    },
    vi: {
        'dashboard.title': 'Bảng Quota',
        'btn.refresh': 'Làm mới',
        'loading': 'Đang kết nối...',
        'error.noServer': '⚠️ Không tìm thấy máy chủ.\nHãy mở Antigravity IDE.',
        'automation.title': 'Bộ Tự Động',
        'automation.masterSwitch': 'Hệ thống Tự động',
        'automation.statusActive': 'Hoạt động',
        'automation.statusIdle': 'Chờ',
        'automation.statusPaused': 'Tạm dừng',
        'rule.Run': 'Bot Chạy (Run)',
        'rule.Allow': 'Quyền (Allow)',
        'rule.Accept': 'Chấp nhận',
        'rule.AlwaysAllow': 'Luôn cho phép',
        'rule.Retry': 'Thử lại',
        'rule.KeepWaiting': 'Bỏ qua chờ',
        'rule.AcceptAll': 'Duyệt hết',
        'tokenUsage.title': 'TOKEN CODEX',
        'tokenUsage.total': 'Tổng',
        'tokenUsage.last': 'Gần nhất',
    }
};

/** Get current locale. Falls back to 'en'. */
window.LOCALE = 'en';

/** Translate key using current locale */
window.t = function (key) {
    const dict = window.I18N[window.LOCALE] || window.I18N.en;
    return dict[key] || window.I18N.en[key] || key;
};
