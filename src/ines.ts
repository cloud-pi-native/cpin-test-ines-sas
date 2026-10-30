import { config } from './config.js';
import { logger } from './logger.js';

// INES is an Axway SecureTransport: a dispatch triggers a pull of the sender site configured in INES.
// The request names no file: INES fetches whatever the site points to.

export interface InesResponse {
  ok: boolean;
  status: number | null;
  body: string;
}

const TIMEOUT_MS = 15_000;
// Keeps log lines readable when INES answers with a large HTML error page.
const MAX_LOGGED_BODY = 2_000;

/** fetch only says "fetch failed": the actual network cause (DNS, TLS, refused, proxy…) is nested in `cause`. */
function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  while (current !== undefined && current !== null) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      parts.push(current.errors.map(describeError).join(' ; '));
      break;
    }
    if (!(current instanceof Error)) {
      parts.push(String(current));
      break;
    }
    const code = (current as NodeJS.ErrnoException).code;
    const message = code && !current.message.includes(code) ? `${current.message} (${code})` : current.message;
    if (message) parts.push(message);
    current = current.cause;
  }
  return parts.join(': ');
}

function truncate(text: string): string {
  return text.length > MAX_LOGGED_BODY ? `${text.slice(0, MAX_LOGGED_BODY)}… (${text.length} chars)` : text;
}

export async function requestPull(): Promise<InesResponse> {
  const { baseUrl, accountName, site, destinationDirectory, idpId, csrfToken } = config.ines;
  const url = `${baseUrl}/api/v2.0/transfers/operations?operation=pull`;
  // Credentials (idp_id, csrfToken) are deliberately left out of the logs.
  const log = logger.child({ ines: { url, accountName, site, destinationDirectory } });
  log.info('Requesting pull from INES');
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        idp_id: idpId,
        csrfToken,
      },
      body: JSON.stringify({ accountName, site, destinationDirectory }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await response.text();
    const details = {
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - startedAt,
      body: truncate(body),
    };
    if (response.ok) {
      log.info(details, 'INES accepted the pull');
    } else {
      const headers = Object.fromEntries([...response.headers].filter(([name]) => name !== 'set-cookie'));
      log.error({ ...details, headers }, 'INES rejected the pull');
    }
    return { ok: response.ok, status: response.status, body };
  } catch (err) {
    log.error({ err, durationMs: Date.now() - startedAt, timeoutMs: TIMEOUT_MS }, 'INES call failed');
    return { ok: false, status: null, body: describeError(err) };
  }
}
