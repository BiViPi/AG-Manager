const vscode = acquireVsCodeApi();
const state = vscode.getState() || {};

// Initialize locale from persisted state
window.LOCALE = state.locale || 'en';

// Restore dropdown selection to match persisted locale
window.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('lang-select');
    if (sel) sel.value = window.LOCALE;
});

window.addEventListener("message", (event) => {
    const message = event.data;
    switch (message.type) {
        case "update":
            renderDashboard(message.data);
            break;
        case "loading":
            // Don't clear UI, just show a subtle loading if needed
            break;
    }
});

// Request initial data immediately on load
vscode.postMessage({ type: "onRefresh" });

document.getElementById('refresh-btn').addEventListener('click', () => {
    document.getElementById('quota-list').innerHTML = `<div class="loading">${t('loading')}</div>`;
    vscode.postMessage({ type: 'onRefresh' });
});

// Language switcher
document.getElementById('lang-select').addEventListener('change', (e) => {
    window.LOCALE = e.target.value;
    const newState = vscode.getState() || {};
    newState.locale = window.LOCALE;
    vscode.setState(newState);
    // Re-render with cached data if any
    const cachedData = window._lastDashboardData;
    if (cachedData) renderDashboard(cachedData);
    // Also update static elements
    document.getElementById('refresh-btn').textContent = t('btn.refresh');
    document.querySelector('.header h1').textContent = t('dashboard.title');
});

// [MODIFIED] renderDashboard: data is now DashboardData {antigravity, claude, codex}
function renderDashboard(data) {
    window._lastDashboardData = data; // Cache for locale re-render
    if (!data) {
        document.getElementById('user-info').innerHTML = '';
        document.getElementById('quota-list').innerHTML = `<p class="error-msg">${t('error.noServer')}</p>`;
        return;
    }

    // --- Antigravity user card ---
    const ag = data.antigravity;
    if (ag) {
        document.getElementById('user-info').innerHTML = `
            <div class="user-card">
                <div class="avatar">${ag.name.charAt(0)}</div>
                <div class="user-details">
                    <div class="user-name">${ag.name}</div>
                    <div class="user-sub">${ag.tier} • ${ag.email}</div>
                </div>
            </div>
        `;
    } else {
        document.getElementById('user-info').innerHTML = '';
    }

    // --- Render all service groups ---
    let html = '';
    const visibility = data.visibility || {};

    if (ag && ag.quotas) {
        const GROUPS_CONFIG = [
            { id: 'g1', title: 'PRO MODELS', match: (l) => l.includes('Gemini 3.1 Pro') },
            { id: 'g2', title: 'FLASH MODELS', match: (l) => l.includes('Gemini 3 Flash') || (l.includes('Flash') && l.includes('Gemini')) },
            { id: 'g3', title: 'CLAUDE MODELS', match: (l) => l.includes('Claude') || l.includes('GPT') }
        ];

        GROUPS_CONFIG.forEach(group => {
            const groupQuotas = ag.quotas.filter(q => group.match(q.label));
            if (groupQuotas.length > 0) {
                html += renderServiceGroup(group.title, {
                    ...ag,
                    quotas: groupQuotas
                }, group.id, visibility[group.id] !== false);
            }
        });
    }

    if (data.codex) {
        const codexQuotas = [];
        if (data.codex.primary && !data.codex.primary.outdated) {
            const p = data.codex.primary;
            const remaining = 100 - p.used_percent;
            codexQuotas.push({
                remaining,
                direction: 'down',
                resetTime: new Date(p.reset_time).toLocaleString(),
                label: '5-Hour Session',
                style: 'fluid',
                themeColor: '#10b981', // Green
                displayValue: `${Math.round(remaining)}%`
            });
        }
        if (data.codex.secondary && !data.codex.secondary.outdated) {
            const s = data.codex.secondary;
            const remaining = 100 - s.used_percent;
            codexQuotas.push({
                remaining,
                direction: 'down',
                resetTime: new Date(s.reset_time).toLocaleString(),
                label: 'Weekly Limit',
                style: 'fluid',
                themeColor: '#10b981', // Green
                displayValue: `${Math.round(remaining)}%`
            });
        }
        if (codexQuotas.length > 0) {
            html += renderServiceGroup('CODEX (ChatGPT)', {
                tier: 'Live Usage Monitor',
                email: 'codex-ratelimit',
                quotas: codexQuotas,
                isAuthenticated: true
            }, 'codex', visibility['codex'] !== false);
        }
    }

    if (data.claude) {
        try {
            const claudeQuotas = [];
            const now = new Date();
            if (data.claude.session && data.claude.session.resetAt) {
                const rDate = new Date(data.claude.session.resetAt);
                const diffMs = rDate.getTime() - now.getTime();
                let countdown = 'Ready';
                if (diffMs > 0) {
                    const mins = Math.floor(diffMs / 60000);
                    countdown = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                }

                claudeQuotas.push({
                    remaining: (data.claude.session.pctUsed || 0) * 100,
                    direction: 'up',
                    resetTime: countdown,
                    label: '5-Hour Session',
                    style: 'fluid',
                    themeColor: '#D97757', // Claude Orange
                    displayValue: `${Math.round((data.claude.session.pctUsed || 0) * 100)}%`
                });
            }
            if (data.claude.weekly && data.claude.weekly.resetAt) {
                const rDate = new Date(data.claude.weekly.resetAt);
                const diffMs = rDate.getTime() - now.getTime();
                let countdown = 'Ready';
                if (diffMs > 0) {
                    const mins = Math.floor(diffMs / 60000);
                    countdown = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                }

                claudeQuotas.push({
                    remaining: (data.claude.weekly.pctUsed || 0) * 100,
                    direction: 'up',
                    resetTime: countdown,
                    label: 'Weekly Limit',
                    style: 'fluid',
                    themeColor: '#D97757', // Claude Orange
                    displayValue: `${Math.round((data.claude.weekly.pctUsed || 0) * 100)}%`
                });
            }
            if (claudeQuotas.length > 0) {
                html += renderServiceGroup('CLAUDE (OAuth)', {
                    tier: data.claude.subscriptionType || 'Pro',
                    email: 'Claude Quota API',
                    quotas: claudeQuotas,
                    isAuthenticated: true
                }, 'claude', visibility['claude'] !== false);
            }
        } catch (e) {
            console.error('[SQM] Error rendering Claude section:', e);
        }
    }

    document.getElementById('quota-list').innerHTML = html;

    if (data.antigravity && data.antigravity.autoClick) {
        renderAutoClick(data.antigravity.autoClick);
    }
    if (data.autoClick) {
        renderAutoClick(data.autoClick);
    }
}

function getHexColor(pct, direction) {
    if (direction === 'up') {
        if (pct < 80) return '#FFAB40';
        return '#ef4444';
    } else {
        if (pct > 50) return '#10b981';
        if (pct > 20) return '#f59e0b';
        return '#ef4444';
    }
}

function renderServiceGroup(title, status, groupId, isVisible) {
    if (!status) { return ''; }

    const isAuthenticated = status.isAuthenticated !== false;
    let itemsHtml = '';
    if (isAuthenticated && status.quotas && status.quotas.length > 0) {
        itemsHtml = `<div class="model-list">${status.quotas.map(q => createModelCard(q)).join('')}</div>`;
    } else if (!isAuthenticated) {
        itemsHtml = `<p class="error-msg" style="font-size:11px;padding:10px 0;">🔒 ${status.email}</p>`;
    }

    // Determine branded class
    let brandClass = '';
    const upperTitle = title.toUpperCase();
    // Include CLAUDE MODELS but exclude CLAUDE (OAUTH) from special AG branding if needed
    // However, user said "Claude này thuộc về Antigravity nên là dùng 3 màu như gemini"
    // He means the group with Sonnet 4.6, Opus 4.6.
    if (upperTitle.includes('PRO') || upperTitle.includes('FLASH') || (upperTitle.includes('CLAUDE') && !upperTitle.includes('OAUTH'))) {
        brandClass = 'antigravity';
    }
    else if (upperTitle.includes('CODEX')) brandClass = 'codex';
    else if (upperTitle.includes('CLAUDE')) brandClass = 'claude';

    // Visibility Icon
    const eyeIcon = isVisible ? '👁️' : '🕶️';
    const hiddenClass = isVisible ? '' : 'hidden-state';

    return `
        <div class="service-group">
            <div class="row-header">
                <div class="group-header ${brandClass}">${title}</div>
                <span class="visibility-btn ${hiddenClass}" 
                      onclick="toggleGroupVisibility('${groupId}')" 
                      title="Toggle Status Bar Visibility">
                    ${eyeIcon}
                </span>
            </div>
            ${itemsHtml}
        </div>
    `;
}

window.toggleGroupVisibility = function (groupId) {
    vscode.postMessage({ type: 'onToggleVisibility', groupId });
};

function renderAutoClick(config) {
    let container = document.getElementById('automation-module');
    if (!container) {
        container = document.createElement('div');
        container.id = 'automation-module';
        container.className = 'automation-container';
        document.getElementById('app').appendChild(container);
    }

    const rules = [
        { id: 'Run', label: t('rule.Run') },
        { id: 'Allow', label: t('rule.Allow') },
        { id: 'Accept', label: t('rule.Accept') },
        { id: 'Always Allow', label: t('rule.AlwaysAllow') },
        { id: 'Retry', label: t('rule.Retry') },
        { id: 'Keep Waiting', label: t('rule.KeepWaiting') },
        { id: 'Accept all', label: t('rule.AcceptAll') }
    ];

    container.innerHTML = `
        <div class="section-title">${t('automation.title')}</div>
        
        <div class="power-row">
            <span class="power-label">${t('automation.masterSwitch')}</span>
            <label class="switch">
                <input type="checkbox" id="master-power" ${config.active ? 'checked' : ''}>
                <span class="slider"></span>
            </label>
        </div>

        <div class="automation-grid ${!config.active ? 'system-off' : ''}">
            ${rules.map(rule => {
        const rulesList = Array.isArray(config.rules) ? config.rules : [];
        const isRuleOn = rulesList.includes(rule.id);
        const isActuallyActive = config.active && isRuleOn;
        return `
                    <div class="automation-card ${isActuallyActive ? 'active' : ''} ${!config.active ? 'disabled' : ''}" data-rule="${rule.id}">
                        <div class="glow-ring"></div>
                        <div class="automation-label">${rule.label}</div>
                        <div class="automation-status">${isActuallyActive ? t('automation.statusActive') : (config.active ? t('automation.statusIdle') : t('automation.statusPaused'))}</div>
                    </div>
                `;
    }).join('')}
        </div>
    `;

    document.getElementById('master-power').addEventListener('change', (e) => {
        vscode.postMessage({
            type: 'onAutoClickChange',
            config: { enabled: e.target.checked }
        });
    });

    container.querySelectorAll('.automation-card').forEach(card => {
        card.addEventListener('click', () => {
            const ruleId = card.getAttribute('data-rule');
            const rulesList = Array.isArray(config.rules) ? config.rules : [];
            let currentRules = [...rulesList];
            if (currentRules.includes(ruleId)) {
                currentRules = currentRules.filter(r => r !== ruleId);
            } else {
                currentRules.push(ruleId);
            }
            vscode.postMessage({
                type: 'onAutoClickChange',
                config: { rules: currentRules }
            });
        });
    });
}

function formatTime(t) {
    if (!t) return '';
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    let h = hMatch ? parseInt(hMatch[1]) : 0;
    let m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `0d ${h}h ${m}m`;
}

function createModelCard(quota) {
    const pct = Math.round(quota.remaining);
    const color = quota.themeColor || '#40c4ff';
    const displayVal = quota.displayValue !== undefined ? quota.displayValue : `${pct}%`;

    return `
        <div class="model-card">
            <div class="card-header">
                <span class="model-name">${shortLabel(quota.label)}</span>
                <span class="model-time">${formatTime(quota.resetTime)}</span>
            </div>
            <div class="hp-track">
                <div class="hp-fill" style="width: ${pct}%; background: ${color}; box-shadow: 0 0 10px ${color}66;">
                    <span class="hp-pct">${displayVal}</span>
                </div>
            </div>
        </div>
    `;
}

function shortLabel(label) {
    return label
        .replace('Gemini 3.1', 'G3.1')
        .replace('Gemini 3', 'G3')
        .replace('Gemini 2', 'G2')
        .replace('Claude Sonnet', 'Sonnet')
        .replace('Claude Opus', 'Opus')
        .replace('Claude Haiku', 'Haiku')
        .replace('GPT-OSS', 'GPT')
        .replace(' (Thinking)', ' 🧠')
        .replace(' (High)', '↑')
        .replace(' (Low)', '↓')
        .replace(' (Medium)', '');
}
