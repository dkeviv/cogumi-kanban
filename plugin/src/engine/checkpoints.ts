// Checkpoints are recovery records, never credentials or a way to edit work scope.
// Keys are matched by credential-shaped names (token/secret/password/api key suffixes)
// rather than any key containing "token", so benign metadata such as max_tokens,
// prompt_tokens or token_count never rejects a checkpoint.
export const CREDENTIAL_KEY = /(?:^|[_-])(?:token|secret|password|passwd|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret)$|^(?:authorization|cookie|set-cookie|apikey)$/i;
// Every pattern starts at a token boundary, and auth-scheme values must look like
// credentials (digits or base64 symbols), so ordinary words such as "task-...",
// "desk-..." or "Basic authentication" are never touched.
const B = '(?<![A-Za-z0-9_-])';
export const CREDENTIAL_VALUE = new RegExp([
    `${B}cgk_[a-f0-9-]{72}`,
    `\\b(?:Bearer|Basic)\\s+(?=[A-Za-z._~-]*[0-9+/=])[A-Za-z0-9._~+/=-]{12,}`,
    `${B}sk-[A-Za-z0-9_-]{16,}`,
    `${B}gh[pousr]_[A-Za-z0-9]{20,}`,
    `${B}github_pat_[A-Za-z0-9_]{20,}`,
    `${B}xox[abpr]-[A-Za-z0-9-]{10,}`,
    `${B}AKIA[0-9A-Z]{16}`,
    `${B}AIza[0-9A-Za-z_-]{30,}`,
    `${B}eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}`,
    '-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)',
].join('|'));

// Identifiers and enumerations are never rewritten: changing them would break
// lookups (bindings, IDs) or silently change meaning.
const IDENTIFIER_KEY = /(?:^|_)ids?$|^(?:binding|bindings|branch|worker|commit|starting_commit|end_commit|lease_token|phase|phases|environment|environments|status|kind|classification|check_ids|dependencies|requirement_ids|version|criterion_revision|result)$/;

export function redactCredentials(text: string): string {
    return text.replace(new RegExp(CREDENTIAL_VALUE.source, 'g'), '[redacted]');
}

// Deep value redaction of free text; keys are kept so payload shapes stay valid, and
// identifier fields are left exactly as given.
export function redactValues<T>(value: T, key = ''): T {
    if (IDENTIFIER_KEY.test(key)) return value;
    if (typeof value === 'string') return redactCredentials(value) as T;
    if (Array.isArray(value)) return value.map(v => redactValues(v, key)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValues(v, k)])) as T;
    return value;
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
