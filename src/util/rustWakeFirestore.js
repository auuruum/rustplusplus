const Https = require('https');

const RustWakeFcmClient = require('./rustWakeFcmClient.js');

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
        if (body !== undefined) req.write(JSON.stringify(body));
        req.end();
    });
}

class RustWakeFirestore {
    constructor(serviceAccountPath, collection = 'rustWakeLinks') {
        this.fcmClient = new RustWakeFcmClient(serviceAccountPath);
        this.collection = collection;
    }

    isConfigured() {
        return this.fcmClient.isConfigured();
    }

    async createLinkSession(session) {
        const sa = this.fcmClient.loadServiceAccount();
        const accessToken = await this.fcmClient.getAccessToken();
        const url = this.documentUrl(sa.project_id, session.code);
        const now = new Date().toISOString();
        const document = {
            fields: {
                code: stringField(session.code),
                guildId: stringField(session.guildId),
                userId: stringField(session.userId),
                status: stringField('pending'),
                createdAt: timestampField(now),
                expiresAt: timestampField(session.expiresAt)
            }
        };
        return requestJson(url, {
            method: 'PATCH',
            headers: this.headers(accessToken)
        }, document);
    }

    async getLinkSession(code) {
        const sa = this.fcmClient.loadServiceAccount();
        const accessToken = await this.fcmClient.getAccessToken();
        const cleanCode = String(code || '').replace(/\D/g, '');
        const url = this.documentUrl(sa.project_id, cleanCode);
        const doc = await requestJson(url, {
            method: 'GET',
            headers: this.headers(accessToken)
        });
        return decodeDocument(doc);
    }

    async deleteLinkSession(code) {
        const sa = this.fcmClient.loadServiceAccount();
        const accessToken = await this.fcmClient.getAccessToken();
        const cleanCode = String(code || '').replace(/\D/g, '');
        const url = this.documentUrl(sa.project_id, cleanCode);
        return requestJson(url, {
            method: 'DELETE',
            headers: this.headers(accessToken)
        });
    }

    documentUrl(projectId, code) {
        return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${this.collection}/${code}`;
    }

    headers(accessToken) {
        return {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=utf-8'
        };
    }
}

function stringField(value) {
    return { stringValue: String(value || '') };
}

function timestampField(value) {
    return { timestampValue: value };
}

function decodeDocument(doc) {
    const fields = doc.fields || {};
    const value = name => {
        const field = fields[name];
        if (!field) return null;
        if (field.stringValue !== undefined) return field.stringValue;
        if (field.timestampValue !== undefined) return field.timestampValue;
        if (field.booleanValue !== undefined) return field.booleanValue;
        return null;
    };

    return {
        name: doc.name,
        code: value('code'),
        guildId: value('guildId'),
        userId: value('userId'),
        status: value('status'),
        fcmToken: value('fcmToken'),
        deviceName: value('deviceName') || 'Rust Wake Android',
        appVersion: value('appVersion'),
        createdAt: value('createdAt'),
        expiresAt: value('expiresAt'),
        linkedAt: value('linkedAt')
    };
}

module.exports = RustWakeFirestore;
