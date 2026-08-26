const vscode = acquireVsCodeApi();
const state = vscode.getState() || {};

// Initialize locale from persisted state or window.LOCALE
if (state.locale) {
    window.LOCALE = state.locale;
}

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
        case "update":
            if (message.data) {
                renderDashboard(message.data);
            }
            break;
        case "loading":
            // Keep existing UI if we already rendered
            if (!window._hasRendered) {
                const app = document.getElementById('app');
                if (app) {
                    app.innerHTML = `<p class="loading">${typeof window.t === 'function' ? window.t('loading') : 'Establishing connection...'}</p>`;
                }
            }
            break;
    }
});

// Request initial data immediately on load
vscode.postMessage({ type: "onRefresh" });

function formatDisplayTime(t) {
    if (!t || t === 'Ready') return t || '';
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
        let h = parseInt(hMatch[1]);
        let m = hMatch[2] ? parseInt(hMatch[2]) : 0;
        if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
        return `0d ${h}h ${m}m`;
    }

    return s;
}

function renderDashboard(data) {
    try {
        window._lastDashboardData = data;
        window._hasRendered = true;
        const app = document.getElementById('app');
        if (!app) return;

        if (!data) {
            app.innerHTML = `<p class="error-msg">${typeof window.t === 'function' ? window.t('error.noServer') : 'No server connection'}</p>`;
            return;
        }

        const visibility = data.visibility || {};
        const ag = data.antigravity;
        const userName = ag?.name || 'Vĩnh Phú Bùi';
        const userTier = ag?.tier || 'Google AI Pro';
        const avatarLetter = userName.charAt(0).toUpperCase();

        let html = '';

        // 1. User Profile Panel
        html += `
            <div class="user-panel">
                <div class="user-info-left">
                    <div class="avatar-glow">${avatarLetter}</div>
                    <div class="user-meta">
                        <span class="user-name">${userName}</span>
                        <span class="user-tier-badge">✨ ${userTier}</span>
                    </div>
                </div>
                <div class="header-actions">
                    <select id="lang-select">
                        <option value="en" ${window.LOCALE === 'en' ? 'selected' : ''}>EN</option>
                        <option value="vi" ${window.LOCALE === 'vi' ? 'selected' : ''}>VI</option>
                    </select>
                    <button class="icon-btn" id="refresh-btn" title="Refresh">↻</button>
                </div>
            </div>
        `;

        html += '<div id="quota-list">';

        // 2. Bento Card: GEMINI MODELS (Pro & Flash)
        if (ag?.quotas) {
            const geminiQuotas = ag.quotas.filter(q => q.groupId === 'g1' || q.groupId === 'g2' || q.label?.includes('Pro') || q.label?.includes('Flash'));
            const uniqueGemini = [];
            const seenLabels = new Set();
            geminiQuotas.forEach(q => {
                if (!seenLabels.has(q.label)) {
                    seenLabels.add(q.label);
                    uniqueGemini.push(q);
                }
            });

            if (uniqueGemini.length > 0) {
                const isVis = visibility['g1'] !== false || visibility['g2'] !== false;
                html += renderBentoCard({
                    cardClass: 'gemini',
                    title: 'Gemini Models',
                    subtitle: '(Pro & Flash)',
                    dotClass: 'dot-gemini',
                    tagClass: 'tag-gemini',
                    fillClass: 'fill-gemini',
                    quotas: uniqueGemini,
                    groupId: 'g1',
                    isVisible: isVis
                });
            }

            // 3. Bento Card: CLAUDE (Antigravity)
            const claudeAgQuotas = ag.quotas.filter(q => q.groupId === 'g3' || q.label?.includes('Claude') || q.label?.includes('GPT'));
            if (claudeAgQuotas.length > 0) {
                const isVis = visibility['g3'] !== false;
                html += renderBentoCard({
                    cardClass: 'ag-claude',
                    title: 'Claude (Antigravity)',
                    subtitle: '(Thinking & GPT)',
                    dotClass: 'dot-ag-claude',
                    tagClass: 'tag-ag-claude',
                    fillClass: 'fill-ag-claude',
                    quotas: claudeAgQuotas,
                    groupId: 'g3',
                    isVisible: isVis
                });
            }
        }

        // 4. Bento Card: CODEX (ChatGPT)
        if (data.codex) {
            const codexQuotas = [];
            if (data.codex.primary && !data.codex.primary.outdated) {
                const p = data.codex.primary;
                const remaining = 100 - p.used_percent;
                codexQuotas.push({
                    remaining,
                    resetTime: p.reset_time ? new Date(p.reset_time).toLocaleString() : '',
                    label: '5-Hour Session',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (data.codex.secondary && !data.codex.secondary.outdated) {
                const s = data.codex.secondary;
                const remaining = 100 - s.used_percent;
                codexQuotas.push({
                    remaining,
                    resetTime: s.reset_time ? new Date(s.reset_time).toLocaleString() : '',
                    label: 'Weekly Limit',
                    displayValue: `${Math.round(remaining)}%`
                });
            }
            if (codexQuotas.length > 0) {
                const isVis = visibility['codex'] !== false;
                html += renderBentoCard({
                    cardClass: 'codex',
                    title: 'Codex (ChatGPT)',
                    subtitle: '(Live Session)',
                    dotClass: 'dot-codex',
                    tagClass: 'tag-codex',
                    fillClass: 'fill-codex',
                    quotas: codexQuotas,
                    groupId: 'codex',
                    isVisible: isVis
                });
            }
        }

        // 5. Bento Card: CLAUDE (OAuth)
        if (data.claude) {
            const claudeOAuthQuotas = [];
            if (data.claude.session?.resetAt) {
                const rDate = new Date(data.claude.session.resetAt);
                claudeOAuthQuotas.push({
                    remaining: (data.claude.session.pctUsed || 0) * 100,
                    resetTime: rDate.toLocaleString(),
                    label: '5-Hour Session',
                    displayValue: `${Math.round((data.claude.session.pctUsed || 0) * 100)}%`
                });
            }
            if (data.claude.weekly?.resetAt) {
                const rDate = new Date(data.claude.weekly.resetAt);
                claudeOAuthQuotas.push({
                    remaining: (data.claude.weekly.pctUsed || 0) * 100,
                    resetTime: rDate.toLocaleString(),
                    label: 'Weekly Limit',
                    displayValue: `${Math.round((data.claude.weekly.pctUsed || 0) * 100)}%`
                });
            }
            if (claudeOAuthQuotas.length > 0) {
                const isVis = visibility['claude'] !== false;
                html += renderBentoCard({
                    cardClass: 'claude-oauth',
                    title: 'Claude (OAuth)',
                    subtitle: '(Anthropic API)',
                    dotClass: 'dot-claude-oauth',
                    tagClass: 'tag-claude-oauth',
                    fillClass: 'fill-claude-oauth',
                    quotas: claudeOAuthQuotas,
                    groupId: 'claude',
                    isVisible: isVis
                });
            }
        }

        html += '</div>'; // End quota-list

        // 6. Automation Suite Matrix
        const autoConfig = data.autoClick || data.antigravity?.autoClick || { active: true, rules: [] };
        html += renderAutomationMatrix(autoConfig);

        app.innerHTML = html;

        // Attach Event Listeners
        attachEventListeners(autoConfig);

    } catch (globalError) {
        console.error('[SQM] Dashboard Render Error:', globalError);
    }
}

function renderBentoCard({ cardClass, title, subtitle, dotClass, tagClass, fillClass, quotas, groupId, isVisible }) {
    const eyeIcon = isVisible ? '👁️' : '🕶️';
    const hiddenClass = isVisible ? '' : 'hidden-state';
    const eyeTitle = isVisible ? 'Visible on Status Bar' : 'Hidden on Status Bar';

    const rowsHtml = quotas.map(q => {
        const pct = Math.round(q.remaining || 0);
        const displayVal = q.displayValue !== undefined ? q.displayValue : `${pct}%`;
        const timeFormatted = formatDisplayTime(q.resetTime);

        return `
            <div class="quota-item">
                <div class="quota-header-info">
                    <span class="quota-label">${q.label}</span>
                    <div class="quota-values">
                        <span class="quota-pct">${displayVal}</span>
                        <span class="quota-time">${timeFormatted}</span>
                    </div>
                </div>
                <div class="progress-track">
                    <div class="progress-fill ${fillClass}" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="bento-card ${cardClass}" data-group-id="${groupId}">
            <div class="card-title-row">
                <div class="card-tag ${tagClass}">
                    <span class="status-dot ${dotClass}"></span>
                    <span>${title}</span>
                    <span class="tag-sub">${subtitle}</span>
                </div>
                <span class="card-visibility-btn ${hiddenClass}" 
                    data-group-id="${groupId}"
                    title="${eyeTitle}">
                    ${eyeIcon}
                </span>
            </div>
            <div class="quota-rows">
                ${rowsHtml}
            </div>
        </div>
    `;
}

function renderAutomationMatrix(config) {
    const getLabel = (key, fallback) => (typeof window.t === 'function' ? window.t(key) : fallback);
    const rules = [
        { id: 'Run', label: getLabel('rule.Run', 'Running (Run)') },
        { id: 'Allow', label: getLabel('rule.Allow', 'Permission (Allow)') },
        { id: 'Accept', label: getLabel('rule.Accept', 'Accept') },
        { id: 'Always Allow', label: getLabel('rule.AlwaysAllow', 'Always Allow') },
        { id: 'Retry', label: getLabel('rule.Retry', 'Retry') },
        { id: 'Keep Waiting', label: getLabel('rule.KeepWaiting', 'Skip Wait') },
        { id: 'Accept all', label: getLabel('rule.AcceptAll', 'Accept All') }
    ];

    const rulesList = Array.isArray(config.rules) ? config.rules : [];
    const isSystemOn = !!config.active;

    const chipsHtml = rules.map(rule => {
        const isRuleOn = rulesList.includes(rule.id);
        const isActuallyActive = isSystemOn && isRuleOn;
        return `
            <div class="chip ${isActuallyActive ? 'active' : ''}" data-rule="${rule.id}" title="${rule.label}">
                ${rule.label}
            </div>
        `;
    }).join('');

    const autoTitle = getLabel('automation.title', 'Automation Suite');

    return `
        <div class="automation-container">
            <div class="auto-title-row">
                <span class="auto-title">⚡ ${autoTitle}</span>
                <div class="switch-wrapper">
                    <label class="switch">
                        <input type="checkbox" id="master-power" ${isSystemOn ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="rule-chips ${!isSystemOn ? 'system-off' : ''}">
                ${chipsHtml}
            </div>
        </div>
    `;
}

function attachEventListeners(autoConfig) {
    // Visibility Buttons (Toggle eye on/off)
    document.querySelectorAll('.card-visibility-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = btn.getAttribute('data-group-id');
            const isHidden = btn.classList.contains('hidden-state');
            if (isHidden) {
                btn.classList.remove('hidden-state');
                btn.textContent = '👁️';
                btn.title = 'Visible on Status Bar';
            } else {
                btn.classList.add('hidden-state');
                btn.textContent = '🕶️';
                btn.title = 'Hidden on Status Bar';
            }
            vscode.postMessage({ type: 'onToggleVisibility', groupId });
        });
    });

    // Refresh button
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'onRefresh' });
        });
    }

    // Language switch
    const langSelect = document.getElementById('lang-select');
    if (langSelect) {
        langSelect.addEventListener('change', (e) => {
            window.LOCALE = e.target.value;
            const newState = vscode.getState() || {};
            newState.locale = window.LOCALE;
            vscode.setState(newState);
            if (window._lastDashboardData) renderDashboard(window._lastDashboardData);
        });
    }

    // Master Power Toggle
    const masterPower = document.getElementById('master-power');
    if (masterPower) {
        masterPower.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const matrix = document.querySelector('.rule-chips');
            if (matrix) {
                if (isChecked) {
                    matrix.classList.remove('system-off');
                } else {
                    matrix.classList.add('system-off');
                }
            }
            vscode.postMessage({
                type: 'onAutoClickChange',
                config: { enabled: isChecked }
            });
        });
    }

    // Rule Chips Toggle
    document.querySelectorAll('.chip').forEach(chip => {
        chip.addEventListener('click', () => {
            chip.classList.toggle('active');
            const activeRules = [];
            document.querySelectorAll('.chip.active').forEach(c => {
                const r = c.getAttribute('data-rule');
                if (r) activeRules.push(r);
            });
            vscode.postMessage({
                type: 'onAutoClickChange',
                config: { rules: activeRules }
            });
        });
    });
}
