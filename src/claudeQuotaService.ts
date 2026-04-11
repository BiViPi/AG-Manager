import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';

/**
 * Claude Quota Provider
 * Chuyên bóc tách token từ Claude Code để lấy Quota "xịn" từ Anthropic
 */
export interface ClaudeQuotaInfo {
    subscriptionType: string;
    session: {
        pctUsed: number;   // Ví dụ: 0.85 tương đương 85%
        resetAt: Date;     // Thời điểm reset hạn mức 5h
    } | null;
    weekly: {
        pctUsed: number;
        resetAt: Date;     // Thời điểm reset hạn mức tuần
    } | null;
}

export class ClaudeQuotaManager {
    private readonly credsPath = path.join(os.homedir(), '.claude', '.credentials.json');

    /**
     * Payload chính để lấy Quota
     */
    async fetchClaudeQuota(): Promise<ClaudeQuotaInfo | null> {
        try {
            // 1. Kiểm tra file tồn tại trước khi đọc
            if (!fsSync.existsSync(this.credsPath)) {
                return null;
            }

            // 2. Phẫu thuật file credentials của Claude Code
            const credsRaw = await fs.readFile(this.credsPath, 'utf-8');
            const creds = JSON.parse(credsRaw);

            const token = creds?.claudeAiOauth?.accessToken;
            const subType = creds?.claudeAiOauth?.subscriptionType || 'Free';

            if (!token) {
                return null;
            }

            // 2. Gửi request lên API Anthropic với Beta Header
            const data = await this.requestUsageAPI(token);

            // 3. Format lại dữ liệu cho AG Manager
            return {
                subscriptionType: subType,
                session: this.parseLimitObj(data?.five_hour),
                weekly: this.parseLimitObj(data?.seven_day)
            };
        } catch (error) {
            console.error("[AG Manager] Lỗi khi lấy Quota:", error);
            return null;
        }
    }

    private requestUsageAPI(token: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.anthropic.com',
                path: '/api/oauth/usage',
                method: 'GET',
                timeout: 5000, // Thêm timeout để không bị treo dashboard
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'anthropic-beta': 'oauth-2025-04-20',
                    'User-Agent': 'ag-manager-vscode/1.0.0'
                }
            };

            const req = https.request(options, (res) => {
                let chunks = '';
                res.on('data', (d) => chunks += d);
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        return resolve(null); // Trả về null thay vì reject để dashboard vẫn chạy
                    }
                    try {
                        resolve(JSON.parse(chunks));
                    } catch (e) {
                        resolve(null);
                    }
                });
            });

            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });

            req.on('error', (e) => {
                resolve(null);
            });
            req.end();
        });
    }

    private parseLimitObj(obj: any) {
        if (!obj || typeof obj.utilization !== 'number') return null;
        return {
            pctUsed: obj.utilization / 100,
            resetAt: new Date(obj.resets_at)
        };
    }
}
