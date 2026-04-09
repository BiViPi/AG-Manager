import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { glob } from 'glob';

const execAsync = promisify(exec);

// [ADDED] Utility: run a command with timeout, always using powershell.exe on Windows
async function execWithTimeout(command: string, timeoutMs: number = 8000): Promise<{ stdout: string, stderr: string }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Command timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        exec(command, { shell: 'powershell.exe' }, (error, stdout, stderr) => {
            clearTimeout(timer);
            if (error) {
                (error as any).stdout = stdout;
                (error as any).stderr = stderr;
                reject(error);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

export interface QuotaInfo {
    label: string;
    remaining: number;
    resetTime: string;
    themeColor?: string;
    absResetTime?: string;
    // [ADDED] Optional raw value for display (e.g. "23" or "20%")
    displayValue?: string;
    // [ADDED] Render style and direction
    style?: 'segmented' | 'fluid';
    direction?: 'up' | 'down';
}

export interface UserStatus {
    name: string;
    email: string;
    tier: string;
    quotas: QuotaInfo[];
    // [ADDED] Optional - used by Claude/Codex groups to show login prompt
    isAuthenticated?: boolean;
    error?: string;
}

// [ADDED] New interface for multi-service dashboard
export interface DashboardData {
    antigravity: UserStatus | null;
    codex?: RateLimitData | null;
    autoClick?: any;
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

export class QuotaService {
    private serverInfo: { port: number, token: string } | null = null;
    private discovering: Promise<boolean> | null = null;
    // [ADDED] Optional logger
    private logger?: vscode.OutputChannel;

    constructor(logger?: vscode.OutputChannel) {
        this.logger = logger;
    }

    private log(msg: string) {
        this.logger?.appendLine(`[${new Date().toLocaleTimeString()}] [QuotaService] ${msg}`);
    }

    async discoverLocalServer(): Promise<boolean> {
        if (this.discovering) return this.discovering;

        this.discovering = (async () => {
            try {
                const command = 'powershell -ExecutionPolicy Bypass -NoProfile -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'csrf_token\' } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress"';
                const { stdout } = await execAsync(command);
                if (!stdout || stdout.trim() === "" || stdout.trim() === "[]") return false;

                let processes: any[] = [];
                try {
                    const parsed = JSON.parse(stdout.trim());
                    processes = Array.isArray(parsed) ? parsed : [parsed];
                } catch { return false; }

                for (const proc of processes) {
                    const cmdLine = proc.CommandLine || "";
                    const csrfMatch = cmdLine.match(/--csrf_token[\s=]+(?:["']?)([a-zA-Z0-9\-_.]+)(?:["']?)/);
                    if (!csrfMatch) continue;

                    const pid = proc.ProcessId;
                    const token = csrfMatch[1];
                    const listeningPorts = await this.getListeningPorts(pid);

                    for (const port of listeningPorts) {
                        if (await this.testConnection(port, token)) {
                            this.serverInfo = { port, token };
                            return true;
                        }
                    }
                }
            } catch (e) {
                console.error('[SQM] Discovery failed:', e);
            } finally {
                this.discovering = null;
            }
            return false;
        })();

        return this.discovering;
    }

    private async getListeningPorts(pid: number): Promise<number[]> {
        try {
            const cmd = `powershell -NoProfile -Command "Get-NetTCPConnection -State Listen -OwningProcess ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique"`;
            const { stdout } = await execAsync(cmd);
            return stdout.trim().split(/\r?\n/).map(p => parseInt(p.trim())).filter(p => !isNaN(p) && p > 1024);
        } catch { return []; }
    }

    private async testConnection(port: number, token: string): Promise<boolean> {
        return new Promise((resolve) => {
            const options = {
                hostname: '127.0.0.1', port, path: API_PATH, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': token,
                    'Connect-Protocol-Version': '1'
                },
                timeout: 800
            };
            const req = http.request(options, (res) => resolve(res.statusCode === 200));
            req.on('error', () => resolve(false));
            req.on('timeout', () => { req.destroy(); resolve(false); });
            req.write(JSON.stringify({ wrapper_data: {} }));
            req.end();
        });
    }

    async fetchStatus(): Promise<UserStatus | null> {
        if (!this.serverInfo) {
            const found = await this.discoverLocalServer();
            if (!found) return null;
        }

        try {
            const options = {
                hostname: '127.0.0.1', port: this.serverInfo!.port, path: API_PATH, method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Codeium-Csrf-Token': this.serverInfo!.token,
                    'Connect-Protocol-Version': '1'
                },
                timeout: 5000
            };

            return new Promise((resolve, reject) => {
                const req = http.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try { resolve(this.parseResponse(JSON.parse(data))); } catch (e) { reject(e); }
                        } else { reject(new Error(`HTTP ${res.statusCode}`)); }
                    });
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
                req.write(JSON.stringify({ wrapper_data: {} }));
                req.end();
            });
        } catch (e) {
            this.serverInfo = null;
            return null;
        }
    }

    private parseResponse(resp: any): UserStatus {
        const user = resp.userStatus;
        const modelConfigs = user?.cascadeModelConfigData?.clientModelConfigs || [];
        const quotas: QuotaInfo[] = modelConfigs
            .filter((m: any) => m.quotaInfo)
            .map((m: any) => {
                const resetTimeStr = m.quotaInfo.resetTime;
                let resetLabel = 'Ready';
                let absResetLabel = '';
                if (resetTimeStr && resetTimeStr !== 'Ready') {
                    const resetDate = new Date(resetTimeStr);
                    const diffMs = resetDate.getTime() - new Date().getTime();
                    if (diffMs > 0) {
                        const mins = Math.floor(diffMs / 60000);
                        resetLabel = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
                        // Absolute time format: (13h00)
                        const absHours = resetDate.getHours().toString().padStart(2, '0');
                        const absMins = resetDate.getMinutes().toString().padStart(2, '0');
                        absResetLabel = `(${absHours}h${absMins})`;
                    } else { resetLabel = 'Refreshing...'; }
                }
                return {
                    label: m.label,
                    remaining: (m.quotaInfo.remainingFraction || 0) * 100,
                    resetTime: resetLabel,
                    absResetTime: absResetLabel,
                    themeColor: m.label.includes('Gemini') ? '#40C4FF' : (m.label.includes('Claude') ? '#FFAB40' : '#69F0AE')
                };
            });

        const ORDER = [
            'Gemini 3 Flash',
            'Gemini 3.1 Pro (High)',
            'Gemini 3.1 Pro (Low)',
            'Claude Sonnet 4.6 (Thinking)',
            'Claude Opus 4.6 (Thinking)',
            'GPT-OSS 120B (Medium)'
        ];

        quotas.sort((a, b) => {
            const indexA = ORDER.indexOf(a.label);
            const indexB = ORDER.indexOf(b.label);
            const wA = indexA === -1 ? 999 : indexA;
            const wB = indexB === -1 ? 999 : indexB;
            return wA - wB;
        });

        return {
            name: user?.name || 'User',
            email: user?.email || '',
            tier: user?.userTier?.name || user?.planStatus?.planInfo?.planName || 'Free',
            quotas
        };
    }

    // ─── [ADDED] Combined dashboard fetch ────────────────────────────────────
    async fetchDashboard(): Promise<DashboardData> {
        const [antigravity, codexResult] = await Promise.all([
            this.fetchStatus(),
            getCodexRateLimitData()
        ]);

        return {
            antigravity,
            codex: codexResult.found ? codexResult.data : null
        };
    }
}
