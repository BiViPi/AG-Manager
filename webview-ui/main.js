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
// Old: data was UserStatus directly. New: data.antigravity = UserStatus | null
function renderDashboard(data) {
    window._lastDashboardData = data; // Cache for locale re-render
    if (!data) {
        document.getElementById('user-info').innerHTML = '';
        document.getElementById('quota-list').innerHTML = `<p class="error-msg">${t('error.noServer')}</p>`;
        return;
    }

    // --- Antigravity user card (unchanged logic, uses data.antigravity) ---
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
    // [ADDED] renderServiceGroup helper: renders a titled gauge group identical to Antigravity style
    let html = '';
    if (ag) {
        html += renderServiceGroup('ANTIGRAVITY', ag);
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
                themeColor: '#10b981', // Force Green for Codex
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
                themeColor: '#10b981', // Force Green for Codex
                displayValue: `${Math.round(remaining)}%`
            });
        }
        if (codexQuotas.length > 0) {
            html += renderServiceGroup('CODEX (ChatGPT)', {
                tier: 'Live Usage Monitor',
                email: 'codex-ratelimit',
                quotas: codexQuotas,
                isAuthenticated: true
            });
        }

        // Token Usage Summary
        const t_usage = data.codex.total_usage;
        const l_usage = data.codex.last_usage;
        const fk = n => Math.round((n || 0) / 1000).toLocaleString() + 'K';
        html += `
        <div class="service-group" style="margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05);">
            <div class="group-header">${t('tokenUsage.title')}</div>
            <div style="font-family: monospace; font-size: 11px; color: #9CA3AF; margin-top: 8px;">
                <div style="margin-bottom: 4px;"><strong>${t('tokenUsage.total')}:</strong> in ${fk(t_usage.input_tokens)}, cache ${fk(t_usage.cached_input_tokens)}, out ${fk(t_usage.output_tokens)}, reasoning ${fk(t_usage.reasoning_output_tokens)}</div>
                <div><strong>${t('tokenUsage.last')}:</strong> in ${fk(l_usage.input_tokens)}, cache ${fk(l_usage.cached_input_tokens)}, out ${fk(l_usage.output_tokens)}, reasoning ${fk(l_usage.reasoning_output_tokens)}</div>
            </div>
        </div>
        `;
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

// [ADDED] Renders a single service group (title + user info row + gauges)
// Uses exact same HTML/CSS structure as original Antigravity rendering
function renderServiceGroup(title, status) {
    if (!status) { return ''; }

    const isAuthenticated = status.isAuthenticated !== false; // true if undefined (backward compat)
    const infoLine = `${status.tier} • ${status.email}`;

    let gaugesHtml = '';
    if (isAuthenticated && status.quotas && status.quotas.length > 0) {
        gaugesHtml = `<div class="gauge-grid">${status.quotas.map(q => createGauge(q)).join('')}</div>`;
    } else if (!isAuthenticated) {
        gaugesHtml = `<p class="error-msg" style="font-size:11px;padding:10px 0;">🔒 ${status.email}</p>`;
    }

    return `
        <div class="service-group">
            <div class="group-header">${title}</div>
            <div class="service-info">${infoLine}</div>
            ${gaugesHtml}
        </div>
    `;
}


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

    // Events
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

            // Visual feedback
            card.style.opacity = '0.5';
            card.style.pointerEvents = 'none';

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

function createGauge(quota) {
    const pct = Math.round(quota.remaining);
    const R = 30;
    const C = 2 * Math.PI * R;           // circumference
    const filled = C * (pct / 100);
    const dash = `${filled} ${C}`;

    // [MODIFIED] User displayValue if provided (e.g. "23"), otherwise pct%
    const centerText = quota.displayValue !== undefined ? quota.displayValue : `${pct}%`;

    // [MODIFIED] Directionality: Up (Clockwise) or Down (Counter-clockwise)
    // To deplete from top (12 o'clock) counter-clockwise:
    // rotate(90 40 40) changes start to 6 o'clock clockwise.
    // scale(-1, 1) translate(-80, 0) flips it to start at 6 o'clock counter-clockwise.
    // Wait, to start at 12 o'clock counter-clockwise, rotate(-90) starts at 12 o'clock clockwise.
    // Flapping X axis makes it counter-clockwise!
    const isDown = quota.direction === 'down' || quota.direction === undefined;
    const transform = isDown
        ? "rotate(-90 40 40) scale(1, -1) translate(0, -80)" // Flip Y axis: starts at 12 o'clock, counter-clockwise!
        : "rotate(-90 40 40)";                             // Clockwise from 12 o'clock

    // Calculate precise dash offset to ensure the empty space represents the depleted amount
    // If it's a depleting HP bar, filled = pct, empty = 100-pct
    // We want the bar to be filled exactly `pct`. The stroke length is `filled`.
    // The dash array `filled C` is correct.

    return `
        <div class="gauge-item">
            <svg class="gauge-svg" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
                <circle class="gauge-track" cx="40" cy="40" r="${R}"/>
                <circle class="gauge-arc" cx="40" cy="40" r="${R}"
                    stroke="${quota.themeColor}"
                    stroke-dasharray="${dash}"
                    stroke-dashoffset="0"
                    transform="${transform}"/>
                <text class="gauge-pct" x="40" y="40">${centerText}</text>
            </svg>
            <div class="gauge-label">${shortLabel(quota.label)}</div>
            <div class="gauge-time">${formatTime(quota.resetTime)}</div>
        </div>
    `;
}

function shortLabel(label) {
    // Rút gọn tên model cho compact display
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
