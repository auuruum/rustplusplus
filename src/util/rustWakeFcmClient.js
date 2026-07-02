const Crypto = require('crypto');
const Fs = require('fs');
const Https = require('https');

function base64url(input) {
    return Buffer.from(input).toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function requestJson(url, options, body) {
    return new Promise((resolve, reject) => {
        const req = Https.request(url, options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = null;
                try { parsed = data ? JSON.parse(data) : null; }
                catch (e) { parsed = data; }

                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`);
                    err.statusCode = res.statusCode;
                    err.body = parsed;
                    reject(err);
                    return;
                }

                resolve(parsed);
            });
        });

        req.on('error', reject);
        if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
        req.end();
    });
}

class RustWakeFcmClient {
    constructor(serviceAccountPath) {
        this.serviceAccountPath = serviceAccountPath;
        this.serviceAccount = null;
        this.cachedAccessToken = null;
        this.cachedAccessTokenExp = 0;
    }

    isConfigured() {
        return Boolean(this.serviceAccountPath && Fs.existsSync(this.serviceAccountPath));
    }

    loadServiceAccount() {
        if (this.serviceAccount) return this.serviceAccount;
        if (!this.isConfigured()) {
            throw new Error('Rust Wake FCM service account file is not configured or does not exist. Set RPP_RUST_WAKE_FCM_SERVICE_ACCOUNT.');
        }
        this.serviceAccount = JSON.parse(Fs.readFileSync(this.serviceAccountPath, 'utf8'));
        return this.serviceAccount;
    }

    async getAccessToken() {
        const now = Math.floor(Date.now() / 1000);
        if (this.cachedAccessToken && this.cachedAccessTokenExp > now + 60) {
            return this.cachedAccessToken;
        }

        const sa = this.loadServiceAccount();
        const header = { alg: 'RS256', typ: 'JWT' };
        const claim = {
            iss: sa.client_email,
            scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: sa.token_uri,
            iat: now,
            exp: now + 3600
        };

        const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
        const signature = Crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
        const jwt = `${unsigned}.${base64url(signature)}`;

        const response = await requestJson(sa.token_uri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }, `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`);

        this.cachedAccessToken = response.access_token;
        this.cachedAccessTokenExp = now + Number(response.expires_in || 3600);
        return this.cachedAccessToken;
    }

    async sendAlert(token, alert) {
        const sa = this.loadServiceAccount();
        const accessToken = await this.getAccessToken();
        const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
        const message = {
            message: {
                token,
                data: {
                    id: alert.id || `rust-wake-${Date.now()}`,
                    title: alert.title || 'RAID WAKE',
                    base: alert.base || 'Unknown base',
                    grid: alert.grid || '?',
                    server: alert.server || 'Rust server',
                    trigger: alert.trigger || 'Rust+ alert'
                },
                android: {
                    priority: 'HIGH',
                    ttl: '60s'
                }
            }
        };

        return requestJson(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        }, message);
    }
}

module.exports = RustWakeFcmClient;
