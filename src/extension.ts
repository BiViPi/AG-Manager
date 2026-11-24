import * as vscode from 'vscode';
import { QuotaService, DashboardData, QuotaGroup } from './quotaService';
import { SidebarProvider } from './sidebarProvider';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: DashboardData | null = null;
let globalSidebarProvider: SidebarProvider | null = null;
let globalContext: vscode.ExtensionContext | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
let countdownTimer: NodeJS.Timeout | null = null;
let lastStatusBarText = '';
const activeCountdownTargets = new Map<string, number>();
const expiredRefreshTriggered = new Set<string>();
const notifiedModels = new Set<string>();

export function activate(context: vscode.ExtensionContext) {
    globalContext = context;
    const outputChannel = vscode.window.createOutputChannel('AG Manager');
    context.subscriptions.push(outputChannel);

    const extensionVersion = String(context.extension.packageJSON?.version || '1.7.0');
    const quotaService = new QuotaService(outputChannel, extensionVersion);
    globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.openDashboard", async () => {
            try {
                await vscode.commands.executeCommand("workbench.view.extension.sqm-explorer");
            } catch (e) {
                console.error("Failed to open sqm-explorer:", e);
            }
            try {
                await vscode.commands.executeCommand("sqm.sidebar.focus");
            } catch (e) {
                console.error("Failed to focus sqm.sidebar:", e);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.showLogs", () => {
            outputChannel.show(true);
        })
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(dashboard) AG Manager";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.refresh", async () => {
            if (globalSidebarProvider) await globalSidebarProvider.updateData(true);
        })
    );

    // Initial fetch
    setTimeout(() => { if (globalSidebarProvider) globalSidebarProvider.updateData(false); }, 2000);

    // Auto-refresh
    startAutoRefresh();

    // Real-time countdown ticker for status bar
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => updateStatusBarText(), 1000);

    // Re-start refresh on config change
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("sqm.refreshInterval")) {
            startAutoRefresh();
        }
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand("ag-manager.toggleVisibility", async (groupId: string) => {
            const current = context.globalState.get<Record<string, boolean>>('statusBarVisibility') || {};
            const isCurrentlyVisible = current[groupId] !== false;
            current[groupId] = !isCurrentlyVisible;
            await context.globalState.update('statusBarVisibility', current);
            refreshStatusBar();
            if (latestQuotaData) setLatestData(latestQuotaData);
        })
    );
}

function isGroupVisible(groupId: string): boolean {
    const visibility = globalContext?.globalState.get<Record<string, boolean>>('statusBarVisibility') || {};
    return visibility[groupId] !== false;
}

function escapeXml(str: string): string {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function getShortGroupTitle(title: string): string {
    const clean = String(title || '').trim();
    if (/^gemini\s+models?$/i.test(clean)) return 'Gemini';
    if (/claude.*gpt|gpt.*claude/i.test(clean)) return 'Claude & GPT';
    if (clean.length <= 18) return clean;
    return `${clean.slice(0, 17).trim()}…`;
}

export function getQuotaHealth(pct: number): { color: string; gradId: string; dot: string } {
    const rounded = Math.round(pct);
    if (rounded >= 51) {
        return { color: '#22c55e', gradId: 'hp-green', dot: '🟢' };
    }
    if (rounded >= 21) {
        return { color: '#f59e0b', gradId: 'hp-yellow', dot: '🟡' };
    }
    return { color: '#ef4444', gradId: 'hp-red', dot: '🔴' };
}

export function formatCountdown(resetTime?: string | Date, nowMs: number = Date.now()): string {
    if (!resetTime || resetTime === 'Ready') return '';
    const targetMs = resetTime instanceof Date ? resetTime.getTime() : new Date(String(resetTime)).getTime();
    if (isNaN(targetMs)) return '';

    const diffSec = Math.floor((targetMs - nowMs) / 1000);
    if (diffSec <= 0) return '';

    if (diffSec >= 86400) {
        const d = Math.floor(diffSec / 86400);
        const h = Math.floor((diffSec % 86400) / 3600);
        return `${d}d ${h}h`;
    }
    if (diffSec >= 3600) {
        const h = Math.floor(diffSec / 3600);
        const m = Math.floor((diffSec % 3600) / 60);
        return `${h}h ${m}m`;
    }
    if (diffSec >= 60) {
        const m = Math.floor(diffSec / 60);
        const s = diffSec % 60;
        return `${m}m ${s}s`;
    }
    return `${diffSec}s`;
}

function formatDisplayTime(t: string): string {
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
        const h = parseInt(hMatch[1], 10);
        const m = hMatch[2] ? parseInt(hMatch[2], 10) : 0;
        if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
        return `0d ${h}h ${m}m`;
    }
    return s;
}

export function buildTooltipSVG(data: DashboardData): string {
    const rowHeight = 28;
    const padding = 4;
    const width = 380;

    let contentHtml = '';
    let dynamicDefs = '';
    let currentY = padding + 2;
    let sectionIndex = 0;

    const renderBentoSection = (title: string, quotas: any[], titleColor: string, barGradId: string) => {
        if (!quotas || quotas.length === 0) return;

        if (sectionIndex > 0) {
            contentHtml += `<line x1="${padding}" y1="${currentY}" x2="${width - padding}" y2="${currentY}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>`;
            currentY += 10;
        }
        sectionIndex++;

        const minPct = Math.min(...quotas.map(q => Math.max(0, Math.min(100, Math.round(q.remaining || 0)))));
        const groupHealth = getQuotaHealth(minPct);
        const safeTitle = escapeXml(title.toUpperCase());

        contentHtml += `
            <circle cx="${padding + 5}" cy="${currentY + 6}" r="4.2" fill="${groupHealth.color}"/>
            <text x="${padding + 16}" y="${currentY + 10}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="11" font-weight="800" fill="${titleColor}" style="letter-spacing: 0.6px;">${safeTitle}</text>
        `;
        currentY += 18;

        quotas.forEach((q: any) => {
            const pct = Math.max(0, Math.min(100, Math.round(q.remaining || 0)));
            const time = escapeXml(formatDisplayTime(q.resetTime || ''));
            const barX = 118;
            const barWidth = 92;
            const fillWidth = pct === 0 ? 0 : Math.max(3, Math.min(barWidth, (pct / 100) * barWidth));
            const safeLabel = escapeXml(String(q.label || ''));

            contentHtml += `<rect x="${padding}" y="${currentY}" width="${width - padding * 2}" height="${rowHeight}" rx="7" fill="#ffffff" fill-opacity="0.04" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>`;
            contentHtml += `<text x="${padding + 10}" y="${currentY + 18}" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="10.5" font-weight="600" fill="#c9d1d9">${safeLabel}</text>`;

            contentHtml += `<rect x="${barX}" y="${currentY + 11.25}" width="${barWidth}" height="5.5" rx="2.75" fill="#ffffff" fill-opacity="0.08"/>`;
            if (fillWidth > 0) {
                contentHtml += `<rect x="${barX}" y="${currentY + 11.25}" width="${fillWidth}" height="5.5" rx="2.75" fill="url(#${barGradId})"/>`;
            }

            const pctX = 220;
            contentHtml += `<text x="${pctX}" y="${currentY + 18}" text-anchor="start" font-family="monospace, 'JetBrains Mono', Consolas" font-size="11" font-weight="800" fill="#f3f4f6">${pct}%</text>`;

            const timeX = 264;
            contentHtml += `<text x="${timeX}" y="${currentY + 18}" text-anchor="start" font-family="monospace, 'JetBrains Mono', Consolas" font-size="9.5" font-weight="500" fill="#8b949e">${time}</text>`;

            currentY += rowHeight + 5;
        });

        currentY += 5;
    };

    // 1. Dynamic Antigravity Quota Groups
    const agGroups: QuotaGroup[] = data.antigravity?.groups || [];
    agGroups.forEach((group, idx) => {
        if (!isGroupVisible(group.id)) return;
        const gradId = `ag-bar-grad-${idx}`;
        const accent = group.color || '#38bdf8';
        const gradStart = group.gradientStart || '#0284c7';
        dynamicDefs += `
            <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${gradStart};stop-opacity:1" />
                <stop offset="100%" style="stop-color:${accent};stop-opacity:1" />
            </linearGradient>`;
        renderBentoSection(group.title, group.quotas, accent, gradId);
    });

    // 2. Claude (OAuth)
    if (data.claude && isGroupVisible('claude')) {
        const claudeQuotas = [];
        if (data.claude.session && data.claude.session.resetAt) {
            const remaining = Math.max(0, Math.min(100, (1 - (data.claude.session.pctUsed || 0)) * 100));
            claudeQuotas.push({
                remaining,
                resetTime: new Date(data.claude.session.resetAt).toISOString(),
                label: '5-Hour Session'
            });
        }
        if (data.claude.weekly && data.claude.weekly.resetAt) {
            const remaining = Math.max(0, Math.min(100, (1 - (data.claude.weekly.pctUsed || 0)) * 100));
            claudeQuotas.push({
                remaining,
                resetTime: new Date(data.claude.weekly.resetAt).toISOString(),
                label: 'Weekly Limit'
            });
        }
        if (claudeQuotas.length > 0) {
            renderBentoSection('CLAUDE (OAuth)', claudeQuotas, '#fb923c', 'claude-bar-grad');
        }
    }

    // 3. Codex (ChatGPT)
    if (data.codex && isGroupVisible('codex')) {
        const codexQuotas = [];
        if (data.codex.primary && !data.codex.primary.outdated) {
            const p = data.codex.primary;
            const remaining = 100 - p.used_percent;
            codexQuotas.push({
                remaining,
                resetTime: p.reset_time ? new Date(p.reset_time).toISOString() : '',
                label: '5-Hour Session'
            });
        }
        if (data.codex.secondary && !data.codex.secondary.outdated) {
            const s = data.codex.secondary;
            const remaining = 100 - s.used_percent;
            codexQuotas.push({
                remaining,
                resetTime: s.reset_time ? new Date(s.reset_time).toISOString() : '',
                label: 'Weekly Limit'
            });
        }
        if (codexQuotas.length > 0) {
            renderBentoSection('CODEX (ChatGPT)', codexQuotas, '#34d399', 'codex-bar-grad');
        }
    }

    if (!contentHtml) {
        const statusMsg = data.antigravity
            ? 'No visible quota groups'
            : 'Antigravity local server not connected';
        contentHtml += `
            <text x="${padding}" y="${currentY + 14}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="10.5" font-weight="600" fill="#9ca3af">${escapeXml(statusMsg)}</text>
        `;
        currentY += 26;
    }

    const totalHeight = currentY + 2;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            ${dynamicDefs}
            <linearGradient id="claude-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#ea580c;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#fb923c;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="codex-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#059669;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#34d399;stop-opacity:1" />
            </linearGradient>
        </defs>
        ${contentHtml}
    </svg>`;
}

function trackCountdownTarget(key: string, resetTime: string | Date | undefined, nowMs: number): boolean {
    if (!resetTime || resetTime === 'Ready') {
        activeCountdownTargets.delete(key);
        return false;
    }
    const targetMs = resetTime instanceof Date ? resetTime.getTime() : new Date(String(resetTime)).getTime();
    if (isNaN(targetMs)) {
        activeCountdownTargets.delete(key);
        return false;
    }
    if (targetMs > nowMs) {
        activeCountdownTargets.set(key, targetMs);
        return false;
    }

    const prevTarget = activeCountdownTargets.get(key);
    if (prevTarget !== undefined && prevTarget <= nowMs) {
        activeCountdownTargets.delete(key);
        const triggerKey = `${key}:${prevTarget}`;
        if (!expiredRefreshTriggered.has(triggerKey)) {
            expiredRefreshTriggered.add(triggerKey);
            return true;
        }
    }
    return false;
}

function updateStatusBarText() {
    if (!latestQuotaData || !statusBarItem) return;

    const nowMs = Date.now();
    const parts: string[] = [];
    let shouldTriggerRefresh = false;

    // 1. Dynamic Antigravity Quota Groups
    const agGroups: QuotaGroup[] = latestQuotaData.antigravity?.groups || [];
    agGroups.forEach((group) => {
        if (!isGroupVisible(group.id) || group.quotas.length === 0) return;
        const primaryQuota = group.quotas.find(q => q.windowKey === '5h' || q.label === '5-Hour Session') || group.quotas[0];
        if (!primaryQuota) return;
        const pct = Math.max(0, Math.min(100, Math.round(primaryQuota.remaining)));
        const dot = getQuotaHealth(pct).dot;
        const cd = formatCountdown(primaryQuota.resetTime, nowMs);
        if (trackCountdownTarget(`ag:${group.id}`, primaryQuota.resetTime, nowMs)) {
            shouldTriggerRefresh = true;
        }
        parts.push(`${dot} ${getShortGroupTitle(group.title)} ${pct}%${cd ? ` ${cd}` : ''}`);
    });

    // 2. Claude Quota (OAuth)
    if (latestQuotaData.claude && isGroupVisible('claude')) {
        if (latestQuotaData.claude.session) {
            const remaining = Math.max(0, Math.min(100, Math.round((1 - (latestQuotaData.claude.session.pctUsed || 0)) * 100)));
            const dot = getQuotaHealth(remaining).dot;
            const cd = formatCountdown(latestQuotaData.claude.session.resetAt, nowMs);
            if (trackCountdownTarget('claude:session', latestQuotaData.claude.session.resetAt, nowMs)) {
                shouldTriggerRefresh = true;
            }
            parts.push(`${dot} Claude ${remaining}%${cd ? ` ${cd}` : ''}`);
        }
    }

    // 3. Codex Quota (Primary 5-Hour Session)
    if (latestQuotaData.codex && isGroupVisible('codex')) {
        if (latestQuotaData.codex.primary && !latestQuotaData.codex.primary.outdated) {
            const p = latestQuotaData.codex.primary;
            const remaining = Math.max(0, Math.min(100, Math.round(100 - p.used_percent)));
            const dot = getQuotaHealth(remaining).dot;
            const cd = formatCountdown(p.reset_time, nowMs);
            if (trackCountdownTarget('codex:primary', p.reset_time, nowMs)) {
                shouldTriggerRefresh = true;
            }
            parts.push(`${dot} Codex ${remaining}%${cd ? ` ${cd}` : ''}`);
        }
    }

    const nextText = `$(dashboard)  ${parts.join('  |  ') || 'AG Manager'}`;
    if (nextText !== lastStatusBarText) {
        lastStatusBarText = nextText;
        statusBarItem.text = nextText;
    }

    if (shouldTriggerRefresh && globalSidebarProvider) {
        void globalSidebarProvider.updateData(false);
    }
}

function refreshStatusBar() {
    if (!latestQuotaData) return;

    updateStatusBarText();

    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);
    const name = latestQuotaData.antigravity?.name || 'AG Manager';
    tooltip.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;**${name}** · [Dashboard](command:sqm.openDashboard) · [Refresh](command:sqm.refresh) · [Logs](command:sqm.showLogs)`);

    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
}

export function setLatestData(data: DashboardData) {
    latestQuotaData = data;
    refreshStatusBar();
    if (globalSidebarProvider && data) {
        const visibility = globalContext?.globalState.get<Record<string, boolean>>('statusBarVisibility') || {};
        globalSidebarProvider.syncToWebview({ ...data, visibility });
    }
    checkNotifications(data);
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    const config = vscode.workspace.getConfiguration("sqm");
    const intervalMins = config.get<number>("refreshInterval") || 5;

    refreshTimer = setInterval(() => {
        if (globalSidebarProvider) globalSidebarProvider.updateData(false);
    }, intervalMins * 60 * 1000);
}

function checkNotifications(data: DashboardData) {
    const config = vscode.workspace.getConfiguration("sqm");
    if (!config.get<boolean>("enableNotifications")) return;

    const groups = data.antigravity?.groups || [];
    if (groups.length === 0) return;

    groups.forEach(group => {
        if (!group.quotas || group.quotas.length === 0) return;

        const minRemaining = Math.min(...group.quotas.map(q => q.remaining));
        const groupKey = `group-${group.id}`;

        if (minRemaining > 20) {
            notifiedModels.delete(groupKey);
            return;
        }

        if (notifiedModels.has(groupKey)) return;

        vscode.window.showWarningMessage(`AG Manager: [${group.title}] quota is low (${Math.round(minRemaining)}%).`, "Dashboard").then(selection => {
            if (selection === "Dashboard") {
                vscode.commands.executeCommand("sqm.openDashboard");
            }
        });
        notifiedModels.add(groupKey);
    });
}

export function deactivate() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
}
