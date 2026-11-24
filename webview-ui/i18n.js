/**
 * AG Manager - Internationalization (i18n)
 * Supported locales: 'en' (English), 'vi' (Vietnamese)
 */
window.I18N = {
    en: {
        'loading': 'Establishing connection...',
        'btn.refresh': 'Refresh',
        'btn.showLogs': 'Show Output Logs',
        'user.defaultName': 'Antigravity User',
        'status.disconnected': 'Disconnected',
        'status.connected': 'Connected',
        'status.ready': 'Ready',
        'error.noServer': 'Local Antigravity server not found. Ensure Antigravity IDE is running.',
        'error.noProcess': 'Antigravity language server process not found. Ensure Antigravity IDE is running.',
        'error.noServerResponse': 'Antigravity process found, but local API did not respond.',
        'error.requestFailed': 'Failed to fetch quota data from Antigravity server.',
        'error.hintLogs': 'Open AG Manager Output logs for connection details.',
        'window.5h': '5-Hour Session',
        'window.weekly': 'Weekly Limit',
        'visibility.visible': 'Visible on Status Bar',
        'visibility.hidden': 'Hidden on Status Bar',
        'empty.noQuotas': 'No quota groups returned by Antigravity.'
    },
    vi: {
        'loading': 'Đang kết nối...',
        'btn.refresh': 'Làm mới',
        'btn.showLogs': 'Xem nhật ký lỗi',
        'user.defaultName': 'Người dùng Antigravity',
        'status.disconnected': 'Mất kết nối',
        'status.connected': 'Đã kết nối',
        'status.ready': 'Sẵn sàng',
        'error.noServer': 'Không tìm thấy máy chủ Antigravity cục bộ. Hãy đảm bảo Antigravity IDE đang chạy.',
        'error.noProcess': 'Không tìm thấy tiến trình Antigravity. Hãy đảm bảo Antigravity IDE đang chạy.',
        'error.noServerResponse': 'Đã thấy tiến trình Antigravity nhưng API cục bộ không phản hồi.',
        'error.requestFailed': 'Không lấy được dữ liệu quota từ máy chủ Antigravity.',
        'error.hintLogs': 'Mở nhật ký AG Manager (Output) để xem chi tiết kết nối.',
        'window.5h': 'Phiên 5 giờ',
        'window.weekly': 'Giới hạn tuần',
        'visibility.visible': 'Đang hiện trên thanh trạng thái',
        'visibility.hidden': 'Đang ẩn trên thanh trạng thái',
        'empty.noQuotas': 'Antigravity chưa trả về nhóm quota nào.'
    }
};

/** Get current locale. Falls back to 'en'. */
window.LOCALE = 'en';

/** Translate key using current locale */
window.t = function (key) {
    const dict = window.I18N[window.LOCALE] || window.I18N.en;
    return dict[key] || window.I18N.en[key] || key;
};
