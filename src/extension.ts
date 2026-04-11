import * as vscode from 'vscode';
import { QuotaService } from './quotaService';
import { SidebarProvider } from './sidebarProvider';
import { AutomationService } from './automationService';

let statusBarItem: vscode.StatusBarItem;
let latestQuotaData: any = null;
let globalSidebarProvider: SidebarProvider | null = null;
let globalContext: vscode.ExtensionContext | null = null;
let automationService: AutomationService | null = null;
let refreshTimer: NodeJS.Timeout | null = null;
const notifiedModels = new Set<string>();

const GROUPS = [
    { id: 'g1', title: 'GEMINI 3.1 PRO', match: (l: string) => l.includes('Gemini 3.1 Pro') },
    { id: 'g2', title: 'GEMINI 3 FLASH', match: (l: string) => l.includes('Gemini 3 Flash') || l.includes('Flash') && l.includes('Gemini') },
    { id: 'g3', title: 'CLAUDE/GPT', match: (l: string) => l.includes('Claude') || l.includes('GPT') }
];

export function activate(context: vscode.ExtensionContext) {
    globalContext = context;
    const quotaService = new QuotaService();
    globalSidebarProvider = new SidebarProvider(context.extensionUri, quotaService);
    automationService = new AutomationService(context);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sqm.sidebar", globalSidebarProvider)
    );

    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    // Click opens the sidebar focus
    statusBarItem.command = "sqm.sidebar.focus";
    statusBarItem.text = "$(dashboard) AG Manager";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand("sqm.refresh", async () => {
            if (globalSidebarProvider) await globalSidebarProvider.updateData();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("ag-manager.updateAutoClick", async (config) => {
            if (automationService) {
                await automationService.patchSettings(config);
                // Force UI update to reflect new state immediately
                setLatestData(latestQuotaData);
            }
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
            current[groupId] = !current[groupId];
            if (current[groupId] === undefined) current[groupId] = false; // Default was true, toggle to false
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

function formatTime(t: string): string {
    const hMatch = t.match(/(\d+)h/);
    const mMatch = t.match(/(\d+)m/);
    if (!hMatch && !mMatch) return t;
    let h = hMatch ? parseInt(hMatch[1]) : 0;
    let m = mMatch ? parseInt(mMatch[1]) : 0;
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
    return `0d ${h}h ${m}m`;
}

function buildTooltipSVG(data: any): string {
    const rowHeight = 30;
    const groupHeaderHeight = 22;
    const padding = 15;
    const width = 420;

    let contentHtml = '';
    let currentY = padding + 5;

    // Helper to render a group section
    const renderGroupSection = (title: string, quotas: any[], type: 'ag' | 'codex' | 'claude') => {
        if (!quotas || quotas.length === 0) return;

        // Group Header Background (Capsule style)
        let headerFill = 'rgba(64, 196, 255, 0.1)';
        let headerTextFill = '#40c4ff';
        let headerWidth = title.length * 6 + 15;

        if (type === 'ag') {
            headerFill = 'url(#ag-header-grad)';
            headerTextFill = '#FFFFFF';
        } else if (type === 'codex') {
            headerFill = 'url(#codex-header-grad)';
            headerTextFill = '#FFFFFF';
        } else if (type === 'claude') {
            headerFill = '#D97757';
            headerTextFill = '#FFFFFF';
        }

        contentHtml += `
            <rect x="${padding}" y="${currentY}" width="${headerWidth}" height="18" rx="6" fill="${headerFill}"/>
            <text x="${padding + 10}" y="${currentY + 12}" font-family="monospace, sans-serif" font-size="9" font-weight="900" fill="${headerTextFill}" style="letter-spacing: 0.5px;">${title}</text>
        `;
        currentY += groupHeaderHeight + 4;

        quotas.forEach((q: any) => {
            const pct = Math.round(q.remaining);
            const color = getQuotaColor(pct, q.direction || 'down');
            const time = formatTime(q.resetTime || '');

            // Row Highlight (Glow effect)
            contentHtml += `<rect x="${padding - 5}" y="${currentY}" width="${width - padding * 2 + 10}" height="${rowHeight - 4}" rx="8" fill="url(#row-grad)" fill-opacity="0.6"/>`;

            // Dot
            contentHtml += `<circle cx="${padding + 8}" cy="${currentY + 13}" r="3.5" fill="${color.hex}"/>`;

            // Model Name (White & Smaller)
            const cleanName = q.label.replace(' (Thinking)', '').replace(' (Medium)', '');
            contentHtml += `<text x="${padding + 22}" y="${currentY + 17}" font-family="sans-serif" font-size="10" font-weight="600" fill="#FFFFFF">${cleanName}</text>`;

            // Progress Bar (Fluid HP style or Segmented)
            const barX = 155;
            const barWidth = 60;

            if (q.style === 'fluid') {
                // Fluid HP Bar
                const fillWidth = (pct / 100) * barWidth;
                contentHtml += `<rect x="${barX}" y="${currentY + 12}" width="${barWidth}" height="4" rx="2" fill="#FFFFFF" fill-opacity="0.1"/>`;
                contentHtml += `<rect x="${barX}" y="${currentY + 12}" width="${fillWidth}" height="4" rx="2" fill="${q.themeColor || '#4B5563'}" fill-opacity="0.9"/>`;
            } else {
                // Segmented Bar (Default for Antigravity)
                const segWidth = 10;
                const segGap = 2;
                const filled = Math.min(5, Math.ceil(pct / 20));
                for (let i = 0; i < 5; i++) {
                    const opacity = i < filled ? 0.9 : 0.15;
                    contentHtml += `<rect x="${barX + i * (segWidth + segGap)}" y="${currentY + 12}" width="${segWidth}" height="4" rx="1" fill="${q.themeColor || '#4B5563'}" fill-opacity="${opacity}"/>`;
                }
            }

            // Fixed alignment for Pct & Time (Stronger spacing)
            const pctX = 220;
            const centerText = q.displayValue !== undefined ? q.displayValue : `${pct}%`;
            contentHtml += `<text x="${pctX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="10" font-weight="bold" fill="#FFFFFF">${centerText}</text>`;

            const fullTime = `${time} ${q.absResetTime || ''}`.trim();
            const timeX = 260;
            contentHtml += `<text x="${timeX}" y="${currentY + 17}" text-anchor="start" font-family="monospace" font-size="9" font-weight="500" fill="#AAAAAA">${fullTime}</text>`;

            currentY += rowHeight;
        });

        // Small spacing between groups
        contentHtml += `<line x1="${padding}" y1="${currentY - 5}" x2="${width - padding}" y2="${currentY - 5}" stroke="#2D333D" stroke-width="1" stroke-opacity="0.5"/>`;
        currentY += 4;
    };

    // Render sections for each service
    if (data.antigravity?.quotas) {
        GROUPS.forEach(group => {
            if (!isGroupVisible(group.id)) return;
            const members = data.antigravity.quotas.filter((q: any) => group.match(q.label));
            renderGroupSection(group.title, members, 'ag');
        });
    }

    if (data.codex && isGroupVisible('codex')) {
        const codexQuotas = [];
        if (data.codex.primary && !data.codex.primary.outdated) {
            const p = data.codex.primary;
            const remaining = 100 - p.used_percent;
            codexQuotas.push({
                remaining,
                direction: 'down',
                resetTime: p.reset_time.toLocaleString(),
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
                resetTime: s.reset_time.toLocaleString(),
                label: 'Weekly Limit',
                style: 'fluid',
                themeColor: '#10b981', // Force Green for Codex
                displayValue: `${Math.round(remaining)}%`
            });
        }
        if (codexQuotas.length > 0) {
            renderGroupSection('CODEX (ChatGPT)', codexQuotas, 'codex');
        }
    }

    if (data.claude && isGroupVisible('claude')) {
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
                remaining: data.claude.session.pctUsed * 100,
                direction: 'up',
                resetTime: countdown,
                absResetTime: '',
                label: '5-Hour Session',
                style: 'fluid',
                themeColor: '#D97757', // Claude Orange
                displayValue: `${Math.round(data.claude.session.pctUsed * 100)}%`
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
                remaining: data.claude.weekly.pctUsed * 100,
                direction: 'up',
                resetTime: countdown,
                absResetTime: '',
                label: 'Weekly Limit',
                style: 'fluid',
                themeColor: '#D97757', // Claude Orange
                displayValue: `${Math.round(data.claude.weekly.pctUsed * 100)}%`
            });
        }
        if (claudeQuotas.length > 0) {
            renderGroupSection('CLAUDE (OAuth)', claudeQuotas, 'claude');
        }
    }

    const totalHeight = currentY + 5;

    return `
    <svg width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="bg-grad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" style="stop-color:#21252e;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#161920;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="name-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#b388ff;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#ce93d8;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="ag-header-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#ff8a65;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#4fc3f7;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="codex-header-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#7e57c2;stop-opacity:1" />
                <stop offset="100%" style="stop-color:#42a5f5;stop-opacity:1" />
            </linearGradient>
            <linearGradient id="row-grad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:#ffffff;stop-opacity:0.04" />
                <stop offset="100%" style="stop-color:#ffffff;stop-opacity:0.01" />
            </linearGradient>
        </defs>
        <!-- Background Card -->
        <rect width="${width}" height="${totalHeight}" rx="12" fill="url(#bg-grad)" stroke="#2d333d" stroke-width="1.5"/>
        <!-- Liquid Glass Highlight -->
        <rect x="1" y="1" width="${width - 2}" height="12" rx="6" fill="#ffffff" fill-opacity="0.03"/>
        <path d="M 12 1 L ${width - 12} 1" stroke="white" stroke-width="0.5" stroke-opacity="0.15"/>
        
        ${contentHtml}
    </svg>`;
}

function refreshStatusBar() {
    if (!latestQuotaData) return;

    // Status bar text - Sum up or aggregate from all services
    let groupsText = "";

    // 1. Antigravity Groups
    if (latestQuotaData.antigravity?.quotas) {
        groupsText += GROUPS.map(g => {
            if (!isGroupVisible(g.id)) return '';
            const members = latestQuotaData.antigravity.quotas.filter((q: any) => g.match(q.label));
            if (members.length === 0) return '';
            const avg = members.reduce((acc: number, curr: any) => acc + curr.remaining, 0) / members.length;
            const short = g.id === 'g1' ? 'Pro' : (g.id === 'g2' ? 'Flash' : 'C/G');
            const dot = avg > 50 ? '🟢' : (avg > 20 ? '🟡' : '🔴');
            return `${dot} ${short} ${Math.round(avg)}%`;
        }).filter(t => t !== '').join('  |  ');
    }

    // 2. Codex Quota
    if (latestQuotaData.codex && isGroupVisible('codex')) {
        const codexParts = [];
        if (latestQuotaData.codex.primary && !latestQuotaData.codex.primary.outdated) {
            const p = latestQuotaData.codex.primary;
            const remaining = Math.round(100 - p.used_percent);
            const dot = remaining > 50 ? '🟢' : (remaining > 20 ? '🟡' : '🔴');
            codexParts.push(`${dot} C5H ${remaining}%`);
        }
        if (latestQuotaData.codex.secondary && !latestQuotaData.codex.secondary.outdated) {
            const s = latestQuotaData.codex.secondary;
            const remaining = Math.round(100 - s.used_percent);
            const dot = remaining > 50 ? '🟢' : (remaining > 20 ? '🟡' : '🔴');
            codexParts.push(`${dot} CW ${remaining}%`);
        }
        if (codexParts.length > 0) {
            groupsText += (groupsText ? '  |  ' : '') + codexParts.join('  |  ');
        }
    }

    // 3. Claude Quota
    if (latestQuotaData.claude && isGroupVisible('claude')) {
        const claudeParts = [];
        if (latestQuotaData.claude.session) {
            const pct = Math.round(latestQuotaData.claude.session.pctUsed * 100);
            const dot = pct < 80 ? '🟠' : '🔴';
            claudeParts.push(`${dot} CL5H ${pct}%`);
        }
        if (latestQuotaData.claude.weekly) {
            const pct = Math.round(latestQuotaData.claude.weekly.pctUsed * 100);
            const dot = pct < 80 ? '🟠' : '🔴';
            claudeParts.push(`${dot} CLW ${pct}%`);
        }
        if (claudeParts.length > 0) {
            groupsText += (groupsText ? '  |  ' : '') + claudeParts.join('  |  ');
        }
    }

    statusBarItem.text = `$(dashboard)  ${groupsText || 'AG Manager'}`;

    // Beautiful Tooltip
    const svg = buildTooltipSVG(latestQuotaData);
    const base64 = Buffer.from(svg).toString('base64');

    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown(`![Quota Info](data:image/svg+xml;base64,${base64})\n\n`);
    const name = latestQuotaData.antigravity?.name || "User";
    tooltip.appendMarkdown(`&nbsp;&nbsp;&nbsp;&nbsp;**${name}** · [Dashboard](command:sqm.sidebar.focus) · [Refresh](command:sqm.refresh)`);

    tooltip.isTrusted = true;
    statusBarItem.tooltip = tooltip;
}

export function setLatestData(data: any) {
    latestQuotaData = data;
    refreshStatusBar();
    if (globalSidebarProvider && data) {
        const autoStatus = automationService ? automationService.dumpDiagnostics() : {};
        const visibility = globalContext?.globalState.get<any>('statusBarVisibility') || {};
        globalSidebarProvider.syncToWebview({ ...data, autoClick: autoStatus, visibility });
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
        const members = data.antigravity.quotas.filter((q: any) => group.match(q.label));
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
