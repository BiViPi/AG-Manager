import * as http from 'http';
import * as https from 'https';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';
import { ClaudeQuotaManager, ClaudeQuotaInfo } from './claudeQuotaService';

function runPowerShell(script: string, timeoutMs: number = 10000): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        execFile(
            'powershell.exe',
            ['-ExecutionPolicy', 'Bypass', '-NoProfile', '-Command', script],
            { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
            (error, stdout, stderr) => {
                if (error) {
                    (error as any).stdout = stdout;
                    (error as any).stderr = stderr;
                    reject(error);
                } else {
                    resolve({ stdout, stderr });
                }
            }
        );
    });
}

export interface QuotaInfo {
    label: string;
    remaining: number;
    resetTime: string;
    themeColor?: string;
    absResetTime?: string;
    displayValue?: string;
    style?: 'segmented' | 'fluid';
    direction?: 'up' | 'down';
    groupId: string;
    windowKey?: '5h' | 'weekly' | 'other';
}

export interface QuotaGroup {
    id: string;
    title: string;
    subtitle?: string;
    color: string;
    gradientStart: string;
    quotas: QuotaInfo[];
}

export interface UserStatus {
    name: string;
    email: string;
    tier: string;
    groups: QuotaGroup[];
    quotas: QuotaInfo[];
    isAuthenticated?: boolean;
    error?: string;
}

export interface DashboardData {
    antigravity: UserStatus | null;
    antigravityError?: string | null;
    codex?: RateLimitData | null;
    claude?: ClaudeQuotaInfo | null;
}

// ─── [ADDED] Codex Rate Limit Types ───────────────────────────────────────

export interface TokenUsage {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    total_tokens: number;
}

export interface RateLimit {
    used_percent: number;
    window_minutes: number;
    resets_in_seconds?: number;
    resets_at?: number;
}

export interface TokenCountPayload {
    type: 'token_count';
    info: {
        total_token_usage: TokenUsage | null;
        last_token_usage: TokenUsage | null;
    } | null;
    rate_limits?: {
        primary?: RateLimit;    // 5-hour limit
        secondary?: RateLimit;  // Weekly limit
    };
}

export interface EventRecord {
    type: 'event_msg';
    timestamp: string;
    payload: TokenCountPayload;
}

export interface RateLimitData {
    file_path: string;
    record_timestamp: Date;
    current_time: Date;
    total_usage: TokenUsage;
    last_usage: TokenUsage;
    primary?: {
        used_percent: number;
        time_percent: number;
        reset_time: Date;
        outdated: boolean;
        window_minutes: number;
    };
    secondary?: {
        used_percent: number;
        time_percent: number;
        reset_time: Date;
        outdated: boolean;
        window_minutes: number;
    };
}

// ─── [ADDED] Codex Parsing Logic ──────────────────────────────────────────

function getCodexSessionBasePath(customPath?: string): string {
    if (customPath) {
        return path.resolve(customPath.replace('~', os.homedir()));
    }
    return path.join(os.homedir(), '.codex', 'sessions');
}

function calculateResetTime(recordTimestamp: Date, rateLimit: RateLimit): { resetTime: Date; isOutdated: boolean; secondsUntilReset: number } {
    const currentTime = new Date();
    let resetTime: Date | null = null;

    if (typeof rateLimit.resets_at === 'number' && !Number.isNaN(rateLimit.resets_at)) {
        resetTime = new Date(rateLimit.resets_at * 1000);
    } else if (typeof rateLimit.resets_in_seconds === 'number' && !Number.isNaN(rateLimit.resets_in_seconds)) {
        resetTime = new Date(recordTimestamp.getTime() + rateLimit.resets_in_seconds * 1000);
    }

    if (!resetTime || Number.isNaN(resetTime.getTime())) {
        return { resetTime: recordTimestamp, isOutdated: true, secondsUntilReset: 0 };
    }

    const secondsUntilReset = Math.max(0, Math.floor((resetTime.getTime() - currentTime.getTime()) / 1000));
    const isOutdated = resetTime < currentTime;

    return { resetTime, isOutdated, secondsUntilReset };
}

async function parseSessionFile(filePath: string): Promise<EventRecord | null> {
    try {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());
        let latestRecord: EventRecord | null = null;
        let latestTimestamp: Date | null = null;

        for (const line of lines) {
            try {
                const record = JSON.parse(line);
                if (record.type === 'event_msg' && record.payload?.type === 'token_count') {
                    const timestamp = new Date(record.timestamp.replace('Z', '+00:00'));
                    if (!latestTimestamp || timestamp > latestTimestamp) {
                        latestTimestamp = timestamp;
                        latestRecord = record as EventRecord;
                    }
                }
            } catch { continue; }
        }
        return latestRecord;
    } catch { return null; }
}

async function getCodexSessionFilesWithMtime(sessionPath: string): Promise<{ file: string; mtimeMs: number }[]> {
    const sessionFiles: { file: string; mtimeMs: number }[] = [];
    const currentDate = new Date();

    for (let daysBack = 0; daysBack < 7; daysBack++) {
        const searchDate = new Date(currentDate);
        searchDate.setDate(currentDate.getDate() - daysBack);
        const year = searchDate.getFullYear();
        const month = String(searchDate.getMonth() + 1).padStart(2, '0');
        const day = String(searchDate.getDate()).padStart(2, '0');
        const datePath = path.join(sessionPath, String(year), month, day);

        if (!fs.existsSync(datePath)) continue;

        try {
            const pattern = path.join(datePath, 'rollout-*.jsonl').replace(/\\/g, '/');
            const files = await glob(pattern, { nodir: true });
            for (const file of files) {
                try {
                    const stats = await fs.promises.stat(file);
                    sessionFiles.push({ file, mtimeMs: stats.mtimeMs });
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
    }
    sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return sessionFiles;
}

async function findLatestTokenCountRecord(basePath?: string): Promise<{ file: string; record: EventRecord } | null> {
    const sessionPath = getCodexSessionBasePath(basePath);
    if (!fs.existsSync(sessionPath)) return null;

    const nowMs = Date.now();
    const oneHourAgoMs = nowMs - 60 * 60 * 1000;
    const attemptedFiles = new Set<string>();
    const today = new Date();
    const todayPath = path.join(sessionPath, String(today.getFullYear()), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0'));

    if (fs.existsSync(todayPath)) {
        try {
            const pattern = path.join(todayPath, 'rollout-*.jsonl').replace(/\\/g, '/');
            const files = await glob(pattern, { nodir: true });
            const recentFiles: { file: string; mtimeMs: number }[] = [];

            for (const file of files) {
                try {
                    const stats = await fs.promises.stat(file);
                    if (stats.mtimeMs >= oneHourAgoMs) recentFiles.push({ file, mtimeMs: stats.mtimeMs });
                } catch { /* ignore */ }
            }

            recentFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
            for (const { file } of recentFiles) {
                attemptedFiles.add(file);
                const record = await parseSessionFile(file);
                if (record) return { file, record };
            }
        } catch { /* ignore */ }
    }

    const sessionFiles = await getCodexSessionFilesWithMtime(sessionPath);
    for (const { file } of sessionFiles) {
        if (attemptedFiles.has(file)) continue;
        const record = await parseSessionFile(file);
        if (record) return { file, record };
    }
    return null;
}

function createEmptyTokenUsage(): TokenUsage {
    return { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 };
}

export async function getCodexRateLimitData(customPath?: string): Promise<{ found: boolean; data?: RateLimitData; error?: string }> {
    try {
        const result = await findLatestTokenCountRecord(customPath);
        if (!result) return { found: false, error: 'No token_count events found' };

        const { file, record } = result;
        const payload = record.payload;
        const rateLimits = payload.rate_limits || {};
        const info = payload.info;

        const recordTimestamp = new Date(record.timestamp.replace('Z', '+00:00'));
        const currentTime = new Date();

        const totalUsage = info?.total_token_usage ?? createEmptyTokenUsage();
        const lastUsage = info?.last_token_usage ?? createEmptyTokenUsage();

        const data: RateLimitData = {
            file_path: file,
            record_timestamp: recordTimestamp,
            current_time: currentTime,
            total_usage: totalUsage,
            last_usage: lastUsage
        };

        if (rateLimits.primary) {
            const primary = rateLimits.primary;
            const { resetTime, isOutdated, secondsUntilReset } = calculateResetTime(recordTimestamp, primary);
            const rawWindowMinutes = primary.window_minutes;
            const windowMinutes = typeof rawWindowMinutes === 'number' && rawWindowMinutes > 0 ? rawWindowMinutes : 0;
            const windowSeconds = windowMinutes * 60;
            let timePercent = 0;
            if (windowSeconds > 0) {
                if (isOutdated) timePercent = 100.0;
                else {
                    const elapsedSeconds = windowSeconds - secondsUntilReset;
                    const boundedElapsedSeconds = Math.max(0, Math.min(windowSeconds, elapsedSeconds));
                    timePercent = (boundedElapsedSeconds / windowSeconds) * 100;
                }
            }
            data.primary = {
                used_percent: primary.used_percent,
                time_percent: Math.max(0, Math.min(100, timePercent)),
                reset_time: resetTime,
                outdated: isOutdated,
                window_minutes: windowMinutes
            };
        }

        if (rateLimits.secondary) {
            const secondary = rateLimits.secondary;
            const { resetTime, isOutdated, secondsUntilReset } = calculateResetTime(recordTimestamp, secondary);
            const rawWindowMinutes = secondary.window_minutes;
            const windowMinutes = typeof rawWindowMinutes === 'number' && rawWindowMinutes > 0 ? rawWindowMinutes : 0;
            const windowSeconds = windowMinutes * 60;
            let timePercent = 0;
            if (windowSeconds > 0) {
                if (isOutdated) timePercent = 100.0;
                else {
                    const elapsedSeconds = windowSeconds - secondsUntilReset;
                    const boundedElapsedSeconds = Math.max(0, Math.min(windowSeconds, elapsedSeconds));
                    timePercent = (boundedElapsedSeconds / windowSeconds) * 100;
                }
            }
            data.secondary = {
                used_percent: secondary.used_percent,
                time_percent: Math.max(0, Math.min(100, timePercent)),
                reset_time: resetTime,
                outdated: isOutdated,
                window_minutes: windowMinutes
            };
        }

        return { found: true, data };
    } catch (error: any) {
        return { found: false, error: error.message };
    }
}

const API_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';
const QUOTA_SUMMARY_PATH = '/exa.language_server_pb.LanguageServerService/RetrieveUserQuotaSummary';

const ANTIGRAVITY_APP_DATA_VALUES = new Set(['antigravity', 'antigravity-ide']);
const HUB_DISCOVERY_FILE_PATTERN = /^hub_\d+\.json$/;
const SERVER_PORT_PATTERN = /--(?:extension_server_port|hub-port|lsp_port|port)[=\s]+(\d+)/;
const REQUEST_METADATA = {
    metadata: {
        ideName: 'antigravity',
        extensionName: 'antigravity',
        locale: 'en'
    }
};

const AG_GROUP_PALETTE = [
    { color: '#38bdf8', gradientStart: '#0284c7' },
    { color: '#a78bfa', gradientStart: '#7c3aed' },
    { color: '#c084fc', gradientStart: '#9333ea' },
    { color: '#2dd4bf', gradientStart: '#0d9488' }
];

function getAntigravityGroupPalette(title: string, fallbackIdx: number): { color: string; gradientStart: string } {
    if (/claude|gpt|3p/i.test(title)) {
        return { color: '#a78bfa', gradientStart: '#7c3aed' };
    }
    if (/argon/i.test(title)) {
        return { color: '#c084fc', gradientStart: '#9333ea' };
    }
    if (/gemini/i.test(title)) {
        return { color: '#38bdf8', gradientStart: '#0284c7' };
    }
    return AG_GROUP_PALETTE[fallbackIdx % AG_GROUP_PALETTE.length];
}

export interface HubDiscoveryInfo {
    pid?: number;
    httpsPort?: number;
    httpPort?: number;
    lsVersion?: string;
    csrfToken: string;
}

export interface HubDiscoveryCandidate extends HubDiscoveryInfo {
    mtimeMs: number;
}

function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e: any) {
        return e?.code === 'EPERM';
    }
}

function parsePortNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535
        ? value
        : undefined;
}

export function parseHubDiscoveryJson(raw: string, expectedPid?: number): HubDiscoveryInfo | null {
    try {
        const data = JSON.parse(raw) as Record<string, unknown>;
        if (!data || typeof data !== 'object') return null;

        const csrfToken = typeof data.csrfToken === 'string' ? data.csrfToken.trim() : '';
        if (!csrfToken) return null;

        const pid = typeof data.pid === 'number' && Number.isInteger(data.pid) && data.pid > 0
            ? data.pid
            : undefined;
        if (expectedPid && expectedPid > 0 && pid !== undefined && pid !== expectedPid) {
            return null;
        }

        const httpsPort = parsePortNumber(data.httpsPort);
        const httpPort = parsePortNumber(data.httpPort);

        return {
            ...(pid !== undefined ? { pid } : {}),
            ...(httpsPort !== undefined ? { httpsPort } : {}),
            ...(httpPort !== undefined ? { httpPort } : {}),
            ...(typeof data.lsVersion === 'string' ? { lsVersion: data.lsVersion } : {}),
            csrfToken
        };
    } catch {
        return null;
    }
}

export function extractCliArgument(commandLine: string, argName: string): string | undefined {
    const escapedName = argName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
        `(?:^|\\s)--${escapedName}(?:=|\\s+)(?:"([^"]+)"|'([^']+)'|([^\\s]+))(?=\\s|$)`,
        'i'
    );
    const match = commandLine.match(pattern);
    return match?.[1] ?? match?.[2] ?? match?.[3];
}

export function listAllHubDiscoveryEntries(geminiRoot: string = path.join(os.homedir(), '.gemini')): HubDiscoveryCandidate[] {
    const entries: HubDiscoveryCandidate[] = [];

    for (const appDataDir of ANTIGRAVITY_APP_DATA_VALUES) {
        const daemonDir = path.join(geminiRoot, appDataDir, 'daemon');
        let files: string[];
        try {
            files = fs.readdirSync(daemonDir).filter(name => HUB_DISCOVERY_FILE_PATTERN.test(name));
        } catch {
            continue;
        }

        for (const file of files) {
            const filePath = path.join(daemonDir, file);
            try {
                const parsed = parseHubDiscoveryJson(fs.readFileSync(filePath, 'utf8'));
                if (!parsed) continue;
                if (parsed.httpsPort === undefined && parsed.httpPort === undefined) continue;
                if (parsed.pid && !isPidAlive(parsed.pid)) continue;

                let mtimeMs = 0;
                try {
                    mtimeMs = fs.statSync(filePath).mtimeMs;
                } catch {
                    mtimeMs = 0;
                }
                entries.push({ ...parsed, mtimeMs });
            } catch {
                // Ignore unreadable or corrupt discovery file
            }
        }
    }

    return entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function readHubDiscoveryForProcess(
    commandLine: string,
    pid: number,
    geminiRoot: string = path.join(os.homedir(), '.gemini')
): HubDiscoveryInfo | null {
    const appDataDir = extractCliArgument(commandLine, 'app_data_dir')?.toLowerCase();
    if (!appDataDir || !ANTIGRAVITY_APP_DATA_VALUES.has(appDataDir)) {
        return null;
    }

    const hubPortRaw = extractCliArgument(commandLine, 'hub-port');
    const hubPort = hubPortRaw ? parseInt(hubPortRaw, 10) : 0;
    const isHubProcess = hubPort > 0 || /(?:^|\s)--hub(?=\s|$)/i.test(commandLine);
    if (!isHubProcess) {
        return null;
    }

    const daemonDir = path.join(geminiRoot, appDataDir, 'daemon');

    if (hubPort > 0) {
        const directPath = path.join(daemonDir, `hub_${hubPort}.json`);
        if (fs.existsSync(directPath)) {
            try {
                const parsed = parseHubDiscoveryJson(fs.readFileSync(directPath, 'utf8'), pid);
                if (parsed) return parsed;
            } catch {
                // Ignore unreadable discovery file
            }
        }
    }

    if (pid > 0) {
        let files: string[];
        try {
            files = fs.readdirSync(daemonDir).filter(name => HUB_DISCOVERY_FILE_PATTERN.test(name));
        } catch {
            return null;
        }
        for (const file of files) {
            try {
                const parsed = parseHubDiscoveryJson(fs.readFileSync(path.join(daemonDir, file), 'utf8'), pid);
                if (parsed && parsed.pid === pid) return parsed;
            } catch {
                // Ignore unreadable discovery file
            }
        }
    }

    return null;
}

function slugifyGroupId(raw: string, fallbackIdx: number): string {
    const slug = String(raw || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || `ag-group-${fallbackIdx + 1}`;
}

function deriveTitleFromBuckets(buckets: any[], fallbackIdx: number): string {
    const bucketIds = buckets
        .map(b => String(b?.bucketId || b?.id || '').trim())
        .filter(Boolean);

    const joined = bucketIds.join(' ').toLowerCase();
    if (/(?:^|\b)3p[-_]|claude|gpt/i.test(joined)) {
        return 'Claude and GPT models';
    }
    if (/argon/i.test(joined)) {
        return 'Gemini Argon';
    }
    if (/(?:^|\b)gemini[-_]/i.test(joined)) {
        return 'Gemini Models';
    }

    if (bucketIds.length > 0) {
        const cleaned = bucketIds[0]
            .replace(/-(?:5h|weekly|wtu-weekly|five-hour)$/i, '')
            .replace(/[-_]+/g, ' ')
            .trim();
        if (cleaned) {
            return cleaned.replace(/\b\w/g, ch => ch.toUpperCase());
        }
    }

    return `Quota Group ${fallbackIdx + 1}`;
}

export class QuotaService {
    private serverInfo: { port: number; token: string; protocol: 'http' | 'https' } | null = null;
    private discovering: Promise<boolean> | null = null;
    private lastError: string | null = null;
    private readonly claudeQuotaManager: ClaudeQuotaManager;
    private readonly logger?: vscode.OutputChannel;

    constructor(logger?: vscode.OutputChannel, extensionVersion: string = '1.7.0') {
        this.logger = logger;
        this.claudeQuotaManager = new ClaudeQuotaManager(extensionVersion, logger);
    }

    private log(msg: string) {
        this.logger?.appendLine(`[${new Date().toLocaleTimeString()}] [QuotaService] ${msg}`);
    }

    public resetConnection(): void {
        this.serverInfo = null;
    }

    async discoverLocalServer(): Promise<boolean> {
        if (this.discovering) return this.discovering;

        this.discovering = (async () => {
            let hadCandidates = false;

            try {
                // Layer 1: Fast zero-PowerShell hub discovery files (~/.gemini/<app_data_dir>/daemon/hub_*.json)
                const hubCandidates = listAllHubDiscoveryEntries();
                this.log(`Layer 1 (hub files): found ${hubCandidates.length} live hub discovery entry/entries.`);

                if (hubCandidates.length > 0) {
                    hadCandidates = true;
                    for (const entry of hubCandidates) {
                        const candidatePorts = Array.from(
                            new Set([entry.httpsPort, entry.httpPort].filter((p): p is number => typeof p === 'number' && p > 0))
                        );
                        this.log(`Probing hub PID ${entry.pid ?? 'unknown'} on port(s) [${candidatePorts.join(', ')}]`);
                        for (const port of candidatePorts) {
                            const protocol = await this.testConnection(port, entry.csrfToken);
                            if (protocol) {
                                this.serverInfo = { port, token: entry.csrfToken, protocol };
                                this.lastError = null;
                                this.log(`Connected via hub discovery file at ${protocol}://127.0.0.1:${port}`);
                                return true;
                            }
                        }
                    }
                }

                // Layer 2: Fallback process scan (agy.exe / language_server_windows_x64.exe / app_data_dir)
                let processes: any[] = await this.queryProcessesByName();
                if (processes.length === 0) {
                    processes = await this.queryProcessesByAppDataDir();
                }

                this.log(`Layer 2 (process scan): found ${processes.length} candidate process(es).`);
                if (processes.length === 0) {
                    this.lastError = hadCandidates ? 'noServerResponse' : 'noProcess';
                    return false;
                }

                for (const proc of processes) {
                    const cmdLine = String(proc?.CommandLine || '');
                    const pid = Number(proc?.ProcessId || 0);
                    const procName = String(proc?.Name || 'unknown');
                    if (!pid || !cmdLine) continue;

                    const appDataDir = extractCliArgument(cmdLine, 'app_data_dir')?.toLowerCase();
                    if (!appDataDir || !ANTIGRAVITY_APP_DATA_VALUES.has(appDataDir)) continue;

                    let csrfToken = extractCliArgument(cmdLine, 'csrf_token');
                    let hubHttpsPort: number | undefined;
                    let hubHttpPort: number | undefined;

                    if (!csrfToken) {
                        const hubInfo = readHubDiscoveryForProcess(cmdLine, pid);
                        if (!hubInfo) continue;
                        csrfToken = hubInfo.csrfToken;
                        hubHttpsPort = hubInfo.httpsPort;
                        hubHttpPort = hubInfo.httpPort;
                    }

                    hadCandidates = true;
                    const portMatch = cmdLine.match(SERVER_PORT_PATTERN);
                    const cliPort = portMatch?.[1] ? parseInt(portMatch[1], 10) : undefined;
                    const listeningPorts = await this.getListeningPorts(pid);

                    const candidatePorts = Array.from(
                        new Set(
                            [hubHttpsPort, hubHttpPort, cliPort, ...listeningPorts]
                                .filter((p): p is number => typeof p === 'number' && !isNaN(p) && p > 0)
                        )
                    );

                    this.log(`Probing PID ${pid} (${procName}) across ${candidatePorts.length} port(s): [${candidatePorts.join(', ')}]`);

                    for (const port of candidatePorts) {
                        const protocol = await this.testConnection(port, csrfToken);
                        if (protocol) {
                            this.serverInfo = { port, token: csrfToken, protocol };
                            this.lastError = null;
                            this.log(`Connected to local server at ${protocol}://127.0.0.1:${port} (PID ${pid})`);
                            return true;
                        }
                    }
                }

                this.lastError = hadCandidates ? 'noServerResponse' : 'noProcess';
                this.log(hadCandidates
                    ? 'Found candidate server(s), but none responded with HTTP 200.'
                    : 'No Antigravity server process found.');
            } catch (e: any) {
                this.lastError = hadCandidates ? 'noServerResponse' : 'noProcess';
                this.log(`Discovery failed: ${e?.message || e}`);
                console.error('[SQM] Discovery failed:', e?.message || e);
            } finally {
                this.discovering = null;
            }
            return false;
        })();

        return this.discovering;
    }

    private async queryProcessesByName(): Promise<any[]> {
        try {
            const script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p = Get-CimInstance Win32_Process -Filter \"name='agy.exe' or name='language_server_windows_x64.exe'\" -ErrorAction SilentlyContinue; if ($p) { @($p) | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress } else { '[]' }";
            const { stdout } = await runPowerShell(script, 10000);
            if (!stdout || stdout.trim() === '' || stdout.trim() === '[]') return [];
            const parsed = JSON.parse(stdout.trim());
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e: any) {
            this.log(`Process name scan failed: ${e?.message || e}`);
            return [];
        }
    }

    private async queryProcessesByAppDataDir(): Promise<any[]> {
        try {
            const script = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'app_data_dir' -and $_.Name -notmatch '^(powershell|pwsh)\\.exe$' } -ErrorAction SilentlyContinue; if ($p) { @($p) | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress } else { '[]' }";
            const { stdout } = await runPowerShell(script, 10000);
            if (!stdout || stdout.trim() === '' || stdout.trim() === '[]') return [];
            const parsed = JSON.parse(stdout.trim());
            return Array.isArray(parsed) ? parsed : [parsed];
        } catch (e: any) {
            this.log(`Process keyword scan failed: ${e?.message || e}`);
            return [];
        }
    }

    private async getListeningPorts(pid: number): Promise<number[]> {
        try {
            const script = `Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique`;
            const { stdout } = await runPowerShell(script, 5000);
            return stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim(), 10)).filter(p => !isNaN(p) && p > 0);
        } catch (e: any) {
            this.log(`Failed to get listening ports for PID ${pid}: ${e?.message || e}`);
            return [];
        }
    }

    private async testConnection(port: number, token: string): Promise<'https' | 'http' | null> {
        const probeProtocol = (protocol: 'https' | 'http'): Promise<boolean> => {
            return new Promise((resolve) => {
                const bodyStr = JSON.stringify({ wrapper_data: {} });
                const client = protocol === 'https' ? https : http;
                const options: http.RequestOptions | https.RequestOptions = {
                    hostname: '127.0.0.1',
                    port,
                    path: API_PATH,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(bodyStr),
                        'X-Codeium-Csrf-Token': token,
                        'Connect-Protocol-Version': '1'
                    },
                    timeout: 4000,
                    agent: false,
                    ...(protocol === 'https' ? { rejectUnauthorized: false } : {})
                };

                const req = client.request(options, (res) => {
                    res.resume();
                    if (res.statusCode === 200) {
                        resolve(true);
                    } else {
                        this.log(`Probe ${protocol}://127.0.0.1:${port} returned HTTP ${res.statusCode}`);
                        resolve(false);
                    }
                });
                req.on('error', (err: any) => {
                    this.log(`Probe ${protocol}://127.0.0.1:${port} error: ${err?.code || err?.message || 'unknown'}`);
                    resolve(false);
                });
                req.on('timeout', () => {
                    req.destroy();
                    this.log(`Probe ${protocol}://127.0.0.1:${port} timed out`);
                    resolve(false);
                });
                req.write(bodyStr);
                req.end();
            });
        };

        if (await probeProtocol('https')) return 'https';
        if (await probeProtocol('http')) return 'http';
        return null;
    }

    private doSingleApiRequest(apiPath: string, port: number, token: string, protocol: 'http' | 'https'): Promise<{ statusCode: number; data: any } | null> {
        return new Promise((resolve) => {
            const bodyStr = JSON.stringify(REQUEST_METADATA);
            const client = protocol === 'https' ? https : http;
            const options: http.RequestOptions | https.RequestOptions = {
                hostname: '127.0.0.1',
                port,
                path: apiPath,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(bodyStr),
                    'X-Codeium-Csrf-Token': token,
                    'Connect-Protocol-Version': '1'
                },
                timeout: 12000,
                agent: false,
                ...(protocol === 'https' ? { rejectUnauthorized: false } : {})
            };

            const req = client.request(options, (res) => {
                let raw = '';
                res.on('data', chunk => raw += chunk);
                res.on('end', () => {
                    const statusCode = res.statusCode || 0;
                    if (statusCode === 200) {
                        try {
                            resolve({ statusCode, data: JSON.parse(raw) });
                        } catch {
                            this.log(`Failed to parse JSON from ${apiPath}`);
                            resolve({ statusCode, data: null });
                        }
                    } else {
                        this.log(`API ${apiPath} (${protocol}) returned HTTP ${statusCode}`);
                        resolve({ statusCode, data: null });
                    }
                });
            });
            req.on('error', (err: any) => {
                this.log(`API ${apiPath} (${protocol}) request error: ${err?.code || err?.message || 'unknown'}`);
                resolve(null);
            });
            req.on('timeout', () => {
                req.destroy();
                this.log(`API ${apiPath} (${protocol}) timed out`);
                resolve(null);
            });
            req.write(bodyStr);
            req.end();
        });
    }

    private async requestApi(apiPath: string): Promise<any> {
        if (!this.serverInfo) return null;
        const { port, token, protocol } = this.serverInfo;

        const primary = await this.doSingleApiRequest(apiPath, port, token, protocol);
        if (primary !== null) {
            return primary.data;
        }

        const fallbackProtocol: 'http' | 'https' = protocol === 'https' ? 'http' : 'https';
        this.log(`API ${apiPath}: ${protocol} failed, trying ${fallbackProtocol} fallback...`);
        const fallback = await this.doSingleApiRequest(apiPath, port, token, fallbackProtocol);
        if (fallback !== null) {
            if (this.serverInfo) {
                this.serverInfo.protocol = fallbackProtocol;
            }
            return fallback.data;
        }

        return null;
    }

    async fetchStatus(forceRediscover: boolean = false): Promise<UserStatus | null> {
        if (forceRediscover) {
            this.serverInfo = null;
        }

        const usedCachedServer = Boolean(this.serverInfo);
        if (!this.serverInfo) {
            const found = await this.discoverLocalServer();
            if (!found) return null;
        }

        try {
            let [statusResp, summaryResp] = await Promise.all([
                this.requestApi(API_PATH),
                this.requestApi(QUOTA_SUMMARY_PATH)
            ]);

            if (!statusResp && !summaryResp && usedCachedServer && !forceRediscover) {
                this.log('Cached server failed to respond; re-discovering local server...');
                this.serverInfo = null;
                const rediscovered = await this.discoverLocalServer();
                if (!rediscovered) return null;
                [statusResp, summaryResp] = await Promise.all([
                    this.requestApi(API_PATH),
                    this.requestApi(QUOTA_SUMMARY_PATH)
                ]);
            }

            if (!statusResp && !summaryResp) {
                this.serverInfo = null;
                this.lastError = 'requestFailed';
                this.log('Both GetUserStatus and RetrieveUserQuotaSummary failed.');
                return null;
            }

            this.lastError = null;
            const parsed = this.parseResponse(statusResp, summaryResp);
            const groupSummary = parsed.groups.map(g => `${g.title}(${g.quotas.length})`).join(', ');
            this.log(`Fetched status OK (tier="${parsed.tier || 'N/A'}", groups=[${groupSummary}])`);
            return parsed;
        } catch (e: any) {
            this.serverInfo = null;
            this.lastError = 'requestFailed';
            this.log(`fetchStatus exception: ${e?.message || e}`);
            return null;
        }
    }

    public parseResponse(statusResp: any, summaryResp?: any): UserStatus {
        const user = statusResp?.userStatus;
        const quotaGroups: any[] =
            summaryResp?.response?.groups ||
            summaryResp?.groups ||
            summaryResp?.userQuotaSummary?.groups ||
            [];

        const normalizeResetTime = (rawTime: any): string => {
            if (!rawTime || rawTime === 'Ready') return 'Ready';
            const resetDate = new Date(rawTime);
            if (!isNaN(resetDate.getTime())) {
                return resetDate.toISOString();
            }
            return String(rawTime);
        };

        const detectWindowKey = (bucket: any): '5h' | 'weekly' | 'other' => {
            const rawWindow = String(bucket.window || '').toLowerCase();
            if (rawWindow === '5h') return '5h';
            if (rawWindow === 'weekly') return 'weekly';
            const combined = `${bucket.bucketId || ''} ${bucket.id || ''} ${bucket.displayName || ''} ${bucket.name || ''}`;
            if (/5h|five\s*hour|5\s*hour/i.test(combined)) return '5h';
            if (/weekly|7d|week/i.test(combined)) return 'weekly';
            return 'other';
        };

        const parseBucket = (bucket: any, groupId: string, themeColor: string): QuotaInfo | null => {
            if (!bucket) return null;
            // Skip amount-only buckets (no percentage fraction)
            if (
                bucket.remainingFraction === undefined &&
                bucket.remaining_fraction === undefined &&
                (bucket.remainingAmount !== undefined || bucket.remaining_amount !== undefined)
            ) {
                return null;
            }
            const rawFraction = bucket.remainingFraction ?? bucket.remaining_fraction ?? 0;
            const remaining = Math.max(0, Math.min(100, Math.round(Number(rawFraction) * 100)));
            const rTime = bucket.resetTime || bucket.reset_time;
            const resetTimeStr = normalizeResetTime(rTime);
            const windowKey = detectWindowKey(bucket);
            const label = windowKey === '5h'
                ? '5-Hour Session'
                : windowKey === 'weekly'
                    ? 'Weekly Limit'
                    : (bucket.displayName || bucket.name || bucket.window || 'Quota');

            return {
                label,
                remaining,
                resetTime: resetTimeStr,
                absResetTime: '',
                themeColor,
                displayValue: `${remaining}%`,
                style: 'fluid',
                direction: 'down',
                groupId,
                windowKey
            };
        };

        const groups: QuotaGroup[] = [];
        const windowOrder: Record<'5h' | 'weekly' | 'other', number> = { '5h': 0, 'weekly': 1, 'other': 2 };

        if (Array.isArray(quotaGroups) && quotaGroups.length > 0) {
            quotaGroups.forEach((g: any, idx: number) => {
                const rawBuckets: any[] = Array.isArray(g?.buckets) ? g.buckets : [];
                if (rawBuckets.length === 0) return;

                const rawGroupTitle = String(g.displayName || g.name || g.description || '').trim();
                const title = rawGroupTitle || deriveTitleFromBuckets(rawBuckets, idx);
                const palette = getAntigravityGroupPalette(title, groups.length);
                const id = slugifyGroupId(g.groupId || g.id || title, groups.length);

                const parsedBuckets: QuotaInfo[] = [];
                const seen = new Set<string>();
                for (const b of rawBuckets) {
                    const parsed = parseBucket(b, id, palette.color);
                    if (!parsed) continue;
                    const dedupeKey = `${parsed.windowKey}:${parsed.label}`;
                    if (seen.has(dedupeKey)) continue;
                    seen.add(dedupeKey);
                    parsedBuckets.push(parsed);
                }

                if (parsedBuckets.length === 0) return;

                parsedBuckets.sort((a, b) => windowOrder[a.windowKey || 'other'] - windowOrder[b.windowKey || 'other']);

                groups.push({
                    id,
                    title,
                    color: palette.color,
                    gradientStart: palette.gradientStart,
                    quotas: parsedBuckets
                });
            });
        }

        // Fallback when summary groups are empty: group clientModelConfigs by shared quota
        if (groups.length === 0) {
            const modelConfigs: any[] = (user?.cascadeModelConfigData?.clientModelConfigs || [])
                .filter((m: any) => Boolean(m?.quotaInfo) && !m?.disabled);
            const sharedMap = new Map<string, { configs: any[]; explicitTitle?: string }>();

            for (const m of modelConfigs) {
                const qInfo = m.quotaInfo;
                const modelId = m.modelId || m.modelOrAlias?.model || '';
                const explicitGroup = m.quotaGroupId || m.quotaGroup || qInfo.groupId || qInfo.bucketId;
                let key: string;
                let explicitTitle: string | undefined;

                if (explicitGroup) {
                    key = `explicit:${String(explicitGroup)}`;
                    explicitTitle = m.quotaGroupName || qInfo.groupName || undefined;
                } else if (qInfo.resetTime && qInfo.resetTime !== 'Ready') {
                    const isoReset = normalizeResetTime(qInfo.resetTime);
                    key = `reset:${isoReset}|${qInfo.remainingFraction ?? 'none'}`;
                } else {
                    const ident = `${m.label || ''} ${modelId}`;
                    if (/gemini/i.test(ident)) {
                        key = 'family:gemini';
                        explicitTitle = 'Gemini Models';
                    } else if (/claude|gpt|openai|anthropic/i.test(ident)) {
                        key = 'family:claude-gpt';
                        explicitTitle = 'Claude and GPT models';
                    } else {
                        const fallbackTitle = String(m.label || modelId || 'Other Models').trim();
                        key = `model:${fallbackTitle.toLowerCase()}`;
                        explicitTitle = fallbackTitle;
                    }
                }

                const existing = sharedMap.get(key);
                if (existing) {
                    existing.configs.push(m);
                    if (!existing.explicitTitle && explicitTitle) existing.explicitTitle = explicitTitle;
                } else {
                    sharedMap.set(key, { configs: [m], explicitTitle });
                }
            }

            for (const { configs, explicitTitle } of sharedMap.values()) {
                let title = explicitTitle;

                if (!title) {
                    const idents = configs.map(c => `${c.label || ''} ${c.modelId || c.modelOrAlias?.model || ''}`);
                    const allGemini = idents.every(s => /gemini/i.test(s));
                    const allClaudeGpt = idents.every(s => /claude|gpt|openai|anthropic/i.test(s));
                    if (allGemini) {
                        title = 'Gemini Models';
                    } else if (allClaudeGpt) {
                        title = 'Claude and GPT models';
                    } else {
                        const distinctLabels = Array.from(
                            new Set(configs.map(c => String(c.label || c.modelId || c.modelOrAlias?.model || '').trim()).filter(Boolean))
                        );
                        title = distinctLabels.slice(0, 2).join(' & ') || `Quota Group ${groups.length + 1}`;
                    }
                }

                const palette = getAntigravityGroupPalette(title, groups.length);
                const id = slugifyGroupId(title, groups.length);
                const primaryConfig = configs[0];
                const qInfo = primaryConfig.quotaInfo;
                const remaining = Math.max(0, Math.min(100, Math.round(Number(qInfo.remainingFraction || 0) * 100)));
                const resetTimeStr = normalizeResetTime(qInfo.resetTime);

                groups.push({
                    id,
                    title,
                    color: palette.color,
                    gradientStart: palette.gradientStart,
                    quotas: [{
                        label: '5-Hour Session',
                        remaining,
                        resetTime: resetTimeStr,
                        absResetTime: '',
                        themeColor: palette.color,
                        displayValue: `${remaining}%`,
                        style: 'fluid',
                        direction: 'down',
                        groupId: id,
                        windowKey: '5h'
                    }]
                });
            }
        }

        const quotas: QuotaInfo[] = groups.flatMap(g => g.quotas);

        return {
            name: user?.name || '',
            email: user?.email || '',
            tier: user?.userTier?.name || user?.planStatus?.planInfo?.planName || user?.planStatus?.planInfo?.teamsTier || '',
            groups,
            quotas
        };
    }

    async fetchDashboard(forceRediscover: boolean = false): Promise<DashboardData> {
        const [antigravity, codexResult, claude] = await Promise.all([
            this.fetchStatus(forceRediscover),
            getCodexRateLimitData(),
            this.claudeQuotaManager.fetchClaudeQuota()
        ]);

        return {
            antigravity,
            antigravityError: antigravity ? null : (this.lastError || 'noServer'),
            codex: codexResult.found ? codexResult.data : null,
            claude
        };
    }
}
