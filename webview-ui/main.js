const vscode = acquireVsCodeApi();
const state = vscode.getState() || {};

// Initialize locale from persisted state or window.LOCALE
if (state.locale) {
    window.LOCALE = state.locale;
}

function tr(key, fallback) {
    if (typeof window.t === 'function') {
        const val = window.t(key);
        if (val && val !== key) return val;
    }
    return fallback !== undefined ? fallback : key;
}

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function getHealthTier(pct) {
    const rounded = Math.round(pct);
    if (rounded >= 51) return 'healthy';
    if (rounded >= 21) return 'warning';
    return 'critical';
}

function closeLangMenu() {
    const dropdown = document.getElementById('lang-dropdown');
    const trigger = document.getElementById('lang-trigger');
    if (dropdown) dropdown.classList.remove('open');
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
}

// Global one-time listeners for closing custom language dropdown
document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('lang-dropdown');
    if (dropdown && !dropdown.contains(e.target)) {
        closeLangMenu();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLangMenu();
    }
});

function setRefreshingState(isSpinning) {
    const refreshBtn = document.getElementById('refresh-btn');
    if (!refreshBtn) return;
    if (isSpinning) {
        refreshBtn.classList.add('spinning');
    } else {
        refreshBtn.classList.remove('spinning');
    }
}

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
        case "update":
            setRefreshingState(false);
            if (message.data) {
                renderDashboard(message.data);
            }
            break;
        case "loading":
            if (window._hasRendered) {
                setRefreshingState(true);
            } else {
                const app = document.getElementById('app');
                if (app) {
                    app.innerHTML = `<p class="loading">${escapeHtml(tr('loading', 'Establishing connection...'))}</p>`;
                }
            }
            break;
    }
});

// Request initial data immediately on load
vscode.postMessage({ type: "onRefresh" });

function formatDisplayTime(t) {
    if (!t) return '';
    if (t === 'Ready') return tr('status.ready', 'Ready');
    const s = String(t);
    try {
        const d = new Date(s);
        if (!isNaN(d.getTime())) {
            const m = d.getMonth() + 1;
            const day = d.getDate();
            let hours = d.getHours();
            const mins = d.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12;
            return `${m}/${day}, ${hours}:${mins} ${ampm}`;
        }
    } catch { }

    const hMatch = s.match(/^(\d+)h\s*(\d+)?m?$/);
    if (hMatch) {
        const h = parseInt(hMatch[1], 10);
        const m = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
        if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
        return `0d ${h}h ${m}m`;
    }

    return s;
}

function getLocalizedBucketLabel(q) {
    if (q.windowKey === '5h' || q.label === '5-Hour Session') {
        return tr('window.5h', '5-Hour Session');
    }
    if (q.windowKey === 'weekly' || q.label === 'Weekly Limit') {
        return tr('window.weekly', 'Weekly Limit');
    }
    return q.label || '';
}

function renderDashboard(data) {
    try {
        window._lastDashboardData = data;
        window._hasRendered = true;
        const app = document.getElementById('app');
        if (!app) return;

        if (!data) {
            app.innerHTML = `<p class="error-msg">${escapeHtml(tr('error.noServer', 'Local Antigravity server not found.'))}</p>`;
            return;
        }

        const visibility = data.visibility || {};
        const ag = data.antigravity;
        const isConnected = Boolean(ag);
        const userName = isConnected ? (ag.name || tr('user.defaultName', 'Antigravity User')) : 'AG Manager';
        const userTier = isConnected ? (ag.tier || tr('status.connected', 'Connected')) : tr('status.disconnected', 'Disconnected');
        const badgeIcon = isConnected ? '✨' : '⚠️';
        const badgeClass = isConnected ? 'user-tier-badge' : 'user-tier-badge offline';
        const avatarLetter = userName.charAt(0).toUpperCase();
        const refreshTitle = tr('btn.refresh', 'Refresh');

        const currentLocale = window.LOCALE === 'vi' ? 'vi' : 'en';

        let html = '';

        // 1. User Profile Panel
        html += `
            <div class="user-panel">
                <div class="user-info-left">
                    <div class="avatar-glow">${escapeHtml(avatarLetter)}</div>
                    <div class="user-meta">
                        <span class="user-name">${escapeHtml(userName)}</span>
                        <span class="${badgeClass}">${badgeIcon} ${escapeHtml(userTier)}</span>
                    </div>
                </div>
                <div class="header-actions">
                    <div class="lang-dropdown" id="lang-dropdown">
                        <button type="button" class="lang-trigger" id="lang-trigger" aria-haspopup="listbox" aria-expanded="false">
                            <span>${currentLocale.toUpperCase()}</span>
                            <span class="lang-caret">▾</span>
                        </button>
                        <div class="lang-menu" id="lang-menu" role="listbox">
                            <button type="button" class="lang-option ${currentLocale === 'en' ? 'selected' : ''}" data-lang="en" role="option" aria-selected="${currentLocale === 'en'}">
                                <span class="lang-opt-code">EN</span>
                                <span class="lang-opt-label">English</span>
                                <span class="lang-opt-check">${currentLocale === 'en' ? '✓' : ''}</span>
                            </button>
                            <button type="button" class="lang-option ${currentLocale === 'vi' ? 'selected' : ''}" data-lang="vi" role="option" aria-selected="${currentLocale === 'vi'}">
                                <span class="lang-opt-code">VI</span>
                                <span class="lang-opt-label">Tiếng Việt</span>
                                <span class="lang-opt-check">${currentLocale === 'vi' ? '✓' : ''}</span>
                            </button>
                        </div>
                    </div>
                    <button class="icon-btn" id="refresh-btn" title="${escapeHtml(refreshTitle)}">↻</button>
                </div>
            </div>
        `;

        html += '<div id="quota-list">';

        // 2. Dynamic Antigravity Groups or Connection Error Card
        if (!ag) {
            const errKey = data.antigravityError ? `error.${data.antigravityError}` : 'error.noServer';
            const errMsg = tr(errKey, tr('error.noServer', 'Local Antigravity server not found.'));
            const hintMsg = tr('error.hintLogs', 'Open AG Manager Output logs for connection details.');
            const showLogsLabel = tr('btn.showLogs', 'Show Output Logs');

            html += `
                <div class="bento-card ag-error">
                    <div class="card-title-row">
                        <div class="card-tag tag-error">
                            <span class="status-dot dot-error"></span>
                            <span>Antigravity</span>
                            <span class="tag-sub">(${escapeHtml(tr('status.disconnected', 'Disconnected'))})</span>
                        </div>
                    </div>
                    <p class="error-inline-msg">${escapeHtml(errMsg)}</p>
                    <p class="error-hint">${escapeHtml(hintMsg)}</p>
                    <div class="error-actions">
                        <button class="text-btn" id="show-logs-btn">${escapeHtml(showLogsLabel)}</button>
                    </div>
                </div>
            `;
        } else {
            const agGroups = Array.isArray(ag.groups) ? ag.groups : [];
            if (agGroups.length > 0) {
                agGroups.forEach(group => {
                    const isVis = visibility[group.id] !== false;
                    html += renderBentoCard({
                        cardClass: 'ag-dynamic',
                        title: group.title,
                        subtitle: group.subtitle || '',
                        dotClass: 'dot-dynamic',
                        tagClass: 'tag-dynamic',
                        fillClass: 'fill-dynamic',
                        quotas: group.quotas || [],
                        groupId: group.id,
                        isVisible: isVis,
                        accentColor: group.color || '#38bdf8',
                        gradStart: group.gradientStart || '#0284c7'
                    });
                });
            } else {
                const emptyMsg = tr('empty.noQuotas', 'No quota groups returned by Antigravity.');
                const showLogsLabel = tr('btn.showLogs', 'Show Output Logs');
                html += `
                    <div class="bento-card ag-error">
                        <p class="error-inline-msg">${escapeHtml(emptyMsg)}</p>
                        <div class="error-actions">
                            <button class="text-btn" id="show-logs-btn">${escapeHtml(showLogsLabel)}</button>
                        </div>
                    </div>
                `;
            }
        }

        // 3. Bento Card: CLAUDE (OAuth)
        if (data.claude) {
            const claudeOAuthQuotas = [];
            if (data.claude.session?.resetAt) {
                const remaining = Math.max(0, Math.min(100, (1 - (data.claude.session.pctUsed || 0)) * 100));
                claudeOAuthQuotas.push({
                    remaining,
                    resetTime: new Date(data.claude.session.resetAt).toISOString(),
                    label: tr('window.5h', '5-Hour Session'),
                    windowKey: '5h',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (data.claude.weekly?.resetAt) {
                const remaining = Math.max(0, Math.min(100, (1 - (data.claude.weekly.pctUsed || 0)) * 100));
                claudeOAuthQuotas.push({
                    remaining,
                    resetTime: new Date(data.claude.weekly.resetAt).toISOString(),
                    label: tr('window.weekly', 'Weekly Limit'),
                    windowKey: 'weekly',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (claudeOAuthQuotas.length > 0) {
                const isVis = visibility['claude'] !== false;
                html += renderBentoCard({
                    cardClass: 'claude-oauth',
                    title: 'Claude (OAuth)',
                    subtitle: '',
                    dotClass: 'dot-claude-oauth',
                    tagClass: 'tag-claude-oauth',
                    fillClass: 'fill-claude-oauth',
                    quotas: claudeOAuthQuotas,
                    groupId: 'claude',
                    isVisible: isVis
                });
            }
        }

        // 4. Bento Card: CODEX (ChatGPT)
        if (data.codex) {
            const codexQuotas = [];
            if (data.codex.primary && !data.codex.primary.outdated) {
                const p = data.codex.primary;
                const remaining = Math.max(0, Math.min(100, 100 - p.used_percent));
                codexQuotas.push({
                    remaining,
                    resetTime: p.reset_time ? new Date(p.reset_time).toISOString() : '',
                    label: tr('window.5h', '5-Hour Session'),
                    windowKey: '5h',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (data.codex.secondary && !data.codex.secondary.outdated) {
                const s = data.codex.secondary;
                const remaining = Math.max(0, Math.min(100, 100 - s.used_percent));
                codexQuotas.push({
                    remaining,
                    resetTime: s.reset_time ? new Date(s.reset_time).toISOString() : '',
                    label: tr('window.weekly', 'Weekly Limit'),
                    windowKey: 'weekly',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (codexQuotas.length > 0) {
                const isVis = visibility['codex'] !== false;
                html += renderBentoCard({
                    cardClass: 'codex',
                    title: 'Codex (ChatGPT)',
                    subtitle: '',
                    dotClass: 'dot-codex',
                    tagClass: 'tag-codex',
                    fillClass: 'fill-codex',
                    quotas: codexQuotas,
                    groupId: 'codex',
                    isVisible: isVis
                });
            }
        }

        html += '</div>'; // End quota-list

        app.innerHTML = html;

        // Attach Event Listeners
        attachEventListeners();

    } catch (globalError) {
        console.error('[SQM] Dashboard Render Error:', globalError);
    }
}

function renderBentoCard({ cardClass, title, subtitle, dotClass, tagClass, fillClass, quotas, groupId, isVisible, accentColor, gradStart }) {
    const eyeIcon = isVisible ? '👁️' : '🕶️';
    const hiddenClass = isVisible ? '' : 'hidden-state';
    const eyeTitle = isVisible
        ? tr('visibility.visible', 'Visible on Status Bar')
        : tr('visibility.hidden', 'Hidden on Status Bar');

    const inlineStyle = accentColor
        ? `style="--card-accent: ${escapeHtml(accentColor)}; --card-grad-start: ${escapeHtml(gradStart || accentColor)};"`
        : '';

    const minPct = quotas.length > 0
        ? Math.min(...quotas.map(q => Math.max(0, Math.min(100, Math.round(q.remaining || 0)))))
        : 100;
    const groupTier = getHealthTier(minPct);
    const subtitleHtml = subtitle ? `<span class="tag-sub">${escapeHtml(subtitle)}</span>` : '';

    const rowsHtml = quotas.map(q => {
        const pct = Math.max(0, Math.min(100, Math.round(q.remaining || 0)));
        const displayVal = q.displayValue !== undefined ? q.displayValue : `${pct}%`;
        const timeFormatted = formatDisplayTime(q.resetTime);
        const localizedLabel = getLocalizedBucketLabel(q);

        return `
            <div class="quota-item">
                <div class="quota-header-info">
                    <span class="quota-label">${escapeHtml(localizedLabel)}</span>
                    <div class="quota-values">
                        <span class="quota-pct">${escapeHtml(displayVal)}</span>
                        <span class="quota-time">${escapeHtml(timeFormatted)}</span>
                    </div>
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${fillClass}" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="bento-card ${cardClass}" data-group-id="${escapeHtml(groupId)}" ${inlineStyle}>
            <div class="card-title-row">
                <div class="card-tag ${tagClass}">
                    <span class="status-dot health-dot-${groupTier}"></span>
                    <span>${escapeHtml(title)}</span>
                    ${subtitleHtml}
                </div>
                <span class="card-visibility-btn ${hiddenClass}" 
                    data-group-id="${escapeHtml(groupId)}"
                    title="${escapeHtml(eyeTitle)}">
                    ${eyeIcon}
                </span>
            </div>
            <div class="quota-rows">
                ${rowsHtml}
            </div>
        </div>
    `;
}

function attachEventListeners() {
    // Visibility Buttons (Toggle eye on/off)
    document.querySelectorAll('.card-visibility-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = btn.getAttribute('data-group-id');
            const isHidden = btn.classList.contains('hidden-state');
            if (isHidden) {
                btn.classList.remove('hidden-state');
                btn.textContent = '👁️';
                btn.title = tr('visibility.visible', 'Visible on Status Bar');
            } else {
                btn.classList.add('hidden-state');
                btn.textContent = '🕶️';
                btn.title = tr('visibility.hidden', 'Hidden on Status Bar');
            }
            vscode.postMessage({ type: 'onToggleVisibility', groupId });
        });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            setRefreshingState(true);
            vscode.postMessage({ type: 'onRefresh' });
        });
    }

    // Show logs button
    const showLogsBtn = document.getElementById('show-logs-btn');
    if (showLogsBtn) {
        showLogsBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'onShowLogs' });
        });
    }

    // Custom dark language dropdown
    const langDropdown = document.getElementById('lang-dropdown');
    const langTrigger = document.getElementById('lang-trigger');
    if (langDropdown && langTrigger) {
        langTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = langDropdown.classList.toggle('open');
            langTrigger.setAttribute('aria-expanded', String(isOpen));
        });

        langDropdown.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const selectedLang = opt.getAttribute('data-lang') || 'en';
                window.LOCALE = selectedLang;
                const newState = vscode.getState() || {};
                newState.locale = window.LOCALE;
                vscode.setState(newState);
                closeLangMenu();
                if (window._lastDashboardData) renderDashboard(window._lastDashboardData);
            });
        });
    }
}
