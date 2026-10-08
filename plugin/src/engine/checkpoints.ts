// Checkpoints are recovery records, never credentials or a way to edit work scope.
// Keys are matched against an explicit denylist rather than any key containing
// "token", so benign metadata (max_tokens, token_count) never rejects a checkpoint.
export const CREDENTIAL_KEY = /^(?:token|tokens|lease_token|access_token|refresh_token|id_token|auth_token|api_key|apikey|password|passwd|secret|client_secret|authorization|cookie|set-cookie|private_key)$/i;
export const CREDENTIAL_VALUE = /(?:cgk_[a-f0-9-]{72}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/;

export function redactCredentials(text: string): string {
    return text.replace(new RegExp(CREDENTIAL_VALUE.source, 'g'), '[redacted]');
}

export function assertNoCredentials(value: any) {
    const walk = (v: any) => {
        if (typeof v === 'string' && CREDENTIAL_VALUE.test(v)) throw Error('Checkpoint cannot contain credentials');
        if (v && typeof v === 'object') for (const [key, item] of Object.entries(v)) { if (CREDENTIAL_KEY.test(key)) throw Error('Checkpoint cannot contain credential fields'); walk(item); }
    };
    walk(value);
}

// The size bound applies to what the engine stores, after journals are compacted.
export function assertCredentialFree(value: any) {
    assertNoCredentials(value);
    if (JSON.stringify(value).length > 180000) throw Error('Checkpoint too large; flush or archive delivered results');
}
