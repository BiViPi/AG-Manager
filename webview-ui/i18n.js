/**
 * AG Manager - Internationalization (i18n)
 * Supported locales: 'en' (English), 'vi' (Vietnamese)
 */
window.I18N = {
    en: {
        'dashboard.title': 'Antigravity-Codex-Claude Monitor',
        'btn.refresh': 'Refresh',
        'loading': 'Establishing connection...',
        'error.noServer': '⚠️ Local server not found.\nEnsure Antigravity IDE is running.',
        'tokenUsage.title': 'TOKEN USAGE FOR CODEX',
        'tokenUsage.total': 'Total',
        'tokenUsage.last': 'Last',
    },
    vi: {
        'dashboard.title': 'Monitor Antigravity-Codex-Claude',
        'btn.refresh': 'Làm mới',
        'loading': 'Đang kết nối...',
        'error.noServer': '⚠️ Không tìm thấy máy chủ.\nHãy mở Antigravity IDE.',
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
