import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { SidebarProvider } from './sidebarProvider';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: any = null;
let globalSidebarProvider: SidebarProvider | null = null;
let globalContext: vscode.ExtensionContext | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
const notifiedModels = new Set<string>();

const GROUPS = [
    { id: 'g2', title: '3.8 FLASH', match: (q: any) => (typeof q === 'string' ? (q.includes('Flash') && !q.includes('Argon')) : (q.groupId === 'g2' || q.groupId === 'g1' || (q.label?.includes('Flash') && !q.label?.includes('Argon')))) },
    { id: 'g3', title: 'CLAUDE 5.5', match: (q: any) => (typeof q === 'string' ? (q.includes('Claude') || q.includes('GPT')) : (q.groupId === 'g3' || q.label?.includes('Claude') || q.label?.includes('GPT'))) },
    { id: 'g4', title: 'GEMINI 4 ARGON', match: (q: any) => (typeof q === 'string' ? q.includes('Argon') : (q.groupId === 'g4' || q.label?.includes('Argon'))) }
];

export function activate(context: vscode.ExtensionContext) {
    globalContext = context;
    const quotaService = new QuotaService();
    globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
    );

    // Register openDashboard command
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

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // No command on click — tooltip (SVG info panel) stays visible on hover/click.
    // Users navigate to Dashboard via the [Dashboard] link inside the tooltip.
    statusBarItem.text = "$(dashboard) AG Manager";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.refresh", async () => {
            if (globalSidebarProvider) await globalSidebarProvider.updateData();
        })
    );

    // Initial fetch
    setTimeout(() => { if (globalSidebarProvider) globalSidebarProvider.updateData(); }, 2000);

    // [V10] Auto-refresh
    startAutoRefresh();

    // Re-start refresh on config change
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration("sqm.refreshInterval")) {
            startAutoRefresh();
        }
    }));

    context.subscriptions.push(
        vscode.commands.registerCommand("ag-manager.toggleVisibility", async (groupId: string) => {
            const current = context.globalState.get<any>('statusBarVisibility') || {};
            const isCurrentlyVisible = current[groupId] !== false; // Default is true
            const targetState = !isCurrentlyVisible;
            current[groupId] = targetState;
            // If toggling Gemini, sync both g1 and g2
            if (groupId === 'g1' || groupId === 'g2') {
                current['g1'] = targetState;
                current['g2'] = targetState;
            }
            await context.globalState.update('statusBarVisibility', current);
            refreshStatusBar();
            if (latestQuotaData) setLatestData(latestQuotaData); // Sync to webview
        })
    );
}

function isGroupVisible(groupId: string): boolean {
    const visibility = globalContext?.globalState.get<any>('statusBarVisibility') || {};
    return visibility[groupId] !== false; // Default true
}

function getQuotaColor(pct: number, direction: 'up' | 'down' = 'down'): { hex: string, dot: string } {
    if (direction === 'up') {
        // Counting UP (Usage) - Orange low, Red high
        if (pct < 80) return { hex: '#FFAB40', dot: '🟠' };
        return { hex: '#ef4444', dot: '🔴' };
    } else {
        // Counting DOWN (Remaining) - Green high, Red low
        if (pct > 50) return { hex: '#10b981', dot: '🟢' };
        if (pct > 20) return { hex: '#f59e0b', dot: '🟡' };
        return { hex: '#ef4444', dot: '🔴' };
    }
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
        let h = parseInt(hMatch[1]);
        let m = hMatch[2] ? parseInt(hMatch[2]) : 0;
        if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
        return `0d ${h}h ${m}m`;
    }
    return s;
}

function buildTooltipSVG(data: any): string {
    const rowHeight = 26;
    const padding = 14;
    const width = 400;

    let contentHtml = '';
    let currentY = padding + 2;

    const renderBentoSection = (title: string, subtitle: string, quotas: any[], brandColor: string, gradId: string) => {
        if (!quotas || quotas.length === 0) return;

        // Section Title Row
        contentHtml += `
            <!-- Brand Tag -->
            <circle cx="${padding + 6}" cy="${currentY + 6}" r="3.5" fill="${brandColor}"/>
            <circle cx="${padding + 6}" cy="${currentY + 6}" r="6" fill="${brandColor}" fill-opacity="0.2"/>
            <text x="${padding + 16}" y="${currentY + 10}" font-family="monospace, -apple-system, sans-serif" font-size="10.5" font-weight="900" fill="${brandColor}" style="letter-spacing: 0.8px;">${title.toUpperCase()}</text>
            <text x="${padding + 16 + title.length * 6.5 + 8}" y="${currentY + 10}" font-family="-apple-system, sans-serif" font-size="9" font-weight="500" fill="#6b7280">${subtitle}</text>
        `;
        currentY += 18;

        quotas.forEach((q: any) => {
            const pct = Math.round(q.remaining || 0);
            const time = formatDisplayTime(q.resetTime || '');
            const barWidth = 75;
            const fillWidth = Math.max(2, Math.min(barWidth, (pct / 100) * barWidth));

            // Row Container
            contentHtml += `<rect x="${padding}" y="${currentY}" width="${width - padding * 2}" height="${rowHeight}" rx="6" fill="#ffffff" fill-opacity="0.02" stroke="#ffffff" stroke-opacity="0.04" stroke-width="1"/>`;

            // Label
            const labelClean = q.label.replace(' (Thinking)', '').replace(' (Medium)', '');
            contentHtml += `<text x="${padding + 10}" y="${currentY + 17}" font-family="-apple-system, BlinkMacSystemFont, sans-serif" font-size="10" font-weight="600" fill="#9ca3af">${labelClean}</text>`;

            // Progress Bar Track & Fill
            const barX = 145;
            contentHtml += `<rect x="${barX}" y="${currentY + 11}" width="${barWidth}" height="5" rx="2.5" fill="#ffffff" fill-opacity="0.06"/>`;
            contentHtml += `<rect x="${barX}" y="${currentY + 11}" width="${fillWidth}" height="5" rx="2.5" fill="url(#${gradId})"/>`;

            // Percentage
            const pctX = 230;
            contentHtml += `<text x="${pctX}" y="${currentY + 17}" text-anchor="start" font-family="monospace, 'JetBrains Mono', Consolas" font-size="11.5" font-weight="800" fill="#ffffff">${pct}%</text>`;

            // Time
            const timeX = 272;
            contentHtml += `<text x="${timeX}" y="${currentY + 17}" text-anchor="start" font-family="monospace, 'JetBrains Mono', Consolas" font-size="9" font-weight="500" fill="#6b7280">${time}</text>`;

            currentY += rowHeight + 4;
        });

        currentY += 6;
    };

    // 1. Antigravity Quotas
    if (isGroupVisible('ag-master') && data.antigravity?.quotas) {
        // 1a. 3.8 Flash
        if (isGroupVisible('g1') || isGroupVisible('g2')) {
            const geminiQuotas = data.antigravity.quotas.filter((q: any) =>
                (q.groupId === 'g1' || q.groupId === 'g2' || q.label?.includes('Flash')) &&
                !q.label?.includes('Argon') && q.groupId !== 'g4'
            );
            const uniqueGemini: any[] = [];
            const seen = new Set();
            geminiQuotas.forEach((q: any) => {
                if (!seen.has(q.label)) {
                    seen.add(q.label);
                    uniqueGemini.push(q);
                }
            });
            if (uniqueGemini.length > 0) {
                renderBentoSection('3.8 FLASH', '', uniqueGemini, '#38bdf8', 'gemini-bar-grad');
            }
        }

        // 1b. Claude 5.5
        if (isGroupVisible('g3')) {
            const agClaudeQuotas = data.antigravity.quotas.filter((q: any) => q.groupId === 'g3' || q.label?.includes('Claude') || q.label?.includes('GPT'));
            if (agClaudeQuotas.length > 0) {
                renderBentoSection('CLAUDE 5.5', '', agClaudeQuotas, '#38bdf8', 'gemini-bar-grad');
            }
        }

        // 1c. Gemini 4 Argon (Reasoning Quota)
        if (isGroupVisible('g4')) {
            const argonQuotas = data.antigravity.quotas.filter((q: any) => q.groupId === 'g4' || q.label?.includes('Argon'));
            if (argonQuotas.length > 0) {
                renderBentoSection('GEMINI 4 ARGON', '(Reasoning Quota)', argonQuotas, '#c084fc', 'argon-bar-grad');
            }
        }
    }

    // 2. Codex (ChatGPT)
    if (data.codex && isGroupVisible('codex')) {
        const codexQuotas = [];
        if (data.codex.primary && !data.codex.primary.outdated) {
            const p = data.codex.primary;
            const remaining = 100 - p.used_percent;
            codexQuotas.push({
                remaining,
                resetTime: p.reset_time.toLocaleString(),
                label: '5-Hour Session'
            });
        }
        if (data.codex.secondary && !data.codex.secondary.outdated) {
            const s = data.codex.secondary;
            const remaining = 100 - s.used_percent;
            codexQuotas.push({
                remaining,
                resetTime: s.reset_time.toLocaleString(),
                label: 'Weekly Limit'
            });
        }
        if (codexQuotas.length > 0) {
            renderBentoSection('CODEX (ChatGPT)', '(Live Session)', codexQuotas, '#34d399', 'codex-bar-grad');
        }
    }

    // 3. Claude (OAuth)
    if (data.claude && isGroupVisible('claude')) {
        const claudeQuotas = [];
        if (data.claude.session && data.claude.session.resetAt) {
            claudeQuotas.push({
                remaining: data.claude.session.pctUsed * 100,
                resetTime: new Date(data.claude.session.resetAt).toLocaleString(),
                label: '5-Hour Session'
            });
        }
        if (data.claude.weekly && data.claude.weekly.resetAt) {
            claudeQuotas.push({
                remaining: data.claude.weekly.pctUsed * 100,
                resetTime: new Date(data.claude.weekly.resetAt).toLocaleString(),
                label: 'Weekly Limit'
            });
        }
        if (claudeQuotas.length > 0) {
            renderBentoSection('CLAUDE (OAuth)', '(Anthropic API)', claudeQuotas, '#fb923c', 'claude-bar-grad');
        }
    }

    const totalHeight = currentY + 6;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#161922;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#0f1117;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="gemini-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#0284c7;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#38bdf8;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="argon-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#9333ea;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#c084fc;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="codex-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#059669;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#34d399;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="claude-bar-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#ea580c;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#fb923c;stop-opacity:1" />
            </linearGradient>
        </defs>
        <!-- Background Card -->
        <rect width="${width}" height="${totalHeight}" rx="12" fill="url(#bg-grad)" stroke="#232733" stroke-width="1.2"/>
        <!-- Liquid Glass Highlight -->
        <rect x="1" y="1" width="${width - 2}" height="10" rx="5" fill="#ffffff" fill-opacity="0.025"/>
        <path d="M 12 1 L ${width - 12} 1" stroke="white" stroke-width="0.5" stroke-opacity="0.12"/>
        
        ${contentHtml}
    </svg>`;
}

function refreshStatusBar() {
    if (!latestQuotaData) return;

    const parts: string[] = [];

    // 1. Antigravity Quotas
    const agVisible = isGroupVisible('ag-master');
    if (agVisible && latestQuotaData.antigravity?.quotas) {
        const quotas: any[] = latestQuotaData.antigravity.quotas;

        // 1a. 3.8 Flash
        if (isGroupVisible('g1') || isGroupVisible('g2')) {
            const flash5h = quotas.find(q => (q.groupId === 'g1' || q.groupId === 'g2') && q.label === '5-Hour Session')
                || quotas.find(q => (q.groupId === 'g1' || q.groupId === 'g2'));
            if (flash5h) {
                const pct = Math.round(flash5h.remaining);
                const dot = pct > 50 ? '🟢' : (pct > 20 ? '🟡' : '🔴');
                parts.push(`${dot} 3.8 Flash ${pct}%`);
            }
        }

        // 1b. Claude 5.5
        if (isGroupVisible('g3')) {
            const agClaude5h = quotas.find(q => q.groupId === 'g3' && q.label === '5-Hour Session')
                || quotas.find(q => q.groupId === 'g3');
            if (agClaude5h) {
                const pct = Math.round(agClaude5h.remaining);
                const dot = pct > 50 ? '🟢' : (pct > 20 ? '🟡' : '🔴');
                parts.push(`${dot} Claude 5.5 ${pct}%`);
            }
        }

        // 1c. Gemini 4 Argon
        if (isGroupVisible('g4')) {
            const argonQuota = quotas.find(q => q.groupId === 'g4' && q.label === 'Weekly Limit')
                || quotas.find(q => q.groupId === 'g4');
            if (argonQuota) {
                const pct = Math.round(argonQuota.remaining);
                const dot = pct > 50 ? '🟣' : (pct > 20 ? '🟡' : '🔴');
                parts.push(`${dot} Argon ${pct}%`);
            }
        }
    }

    // 2. Codex Quota (Primary 5-Hour Session)
    if (latestQuotaData.codex && isGroupVisible('codex')) {
        if (latestQuotaData.codex.primary && !latestQuotaData.codex.primary.outdated) {
            const p = latestQuotaData.codex.primary;
            const remaining = Math.round(100 - p.used_percent);
            const dot = remaining > 50 ? '🟢' : (remaining > 20 ? '🟡' : '🔴');
            parts.push(`${dot} Codex ${remaining}%`);
        }
    }

    // 3. Claude Quota (OAuth)
    if (latestQuotaData.claude && isGroupVisible('claude')) {
        if (latestQuotaData.claude.session) {
            const pct = Math.round(latestQuotaData.claude.session.pctUsed * 100);
            const dot = pct < 80 ? '🟠' : '🔴';
            parts.push(`${dot} Claude-Auth ${pct}%`);
        }
    }

    statusBarItem.text = `$(dashboard)  ${parts.join('  |  ') || 'AG Manager'}`;

    // Beautiful Tooltip
    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);
    const name = latestQuotaData.antigravity?.name || "User";
    tooltip.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;**${name}** · [Dashboard](command:sqm.openDashboard) · [Refresh](command:sqm.refresh)`);

    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
}

export function setLatestData(data: any) {
    latestQuotaData = data;
    refreshStatusBar();
    if (globalSidebarProvider && data) {
        const visibility = globalContext?.globalState.get<any>('statusBarVisibility') || {};
        globalSidebarProvider.syncToWebview({ ...data, visibility });
    }
    // [V10] Check for low quotas
    checkNotifications(data);
}

function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    const config = vscode.workspace.getConfiguration("sqm");
    const intervalMins = config.get<number>("refreshInterval") || 5;

    refreshTimer = setInterval(() => {
        if (globalSidebarProvider) globalSidebarProvider.updateData();
    }, intervalMins * 60 * 1000);
}

function checkNotifications(data: any) {
    const config = vscode.workspace.getConfiguration("sqm");
    if (!config.get<boolean>("enableNotifications")) return;

    if (!data.antigravity?.quotas) return;

    GROUPS.forEach(group => {
        const members = data.antigravity.quotas.filter((q: any) => group.match(q));
        if (members.length === 0) return;

        // Group avg remaining
        const avg = members.reduce((acc: number, curr: any) => acc + curr.remaining, 0) / members.length;

        const groupKey = `group-${group.id}`;
        if (notifiedModels.has(groupKey)) return;

        if (avg <= 20) {
            vscode.window.showWarningMessage(`AG Manager: [${group.title}] quota is low (${Math.round(avg)}%).`, "Dashboard").then(selection => {
                if (selection === "Dashboard") {
                    vscode.commands.executeCommand("sqm.sidebar.focus");
                }
            });
            notifiedModels.add(groupKey);
        }
    });
}

export function deactivate() { }
