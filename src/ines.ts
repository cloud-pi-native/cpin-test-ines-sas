import { config } from './config.js';

// INES is an Axway SecureTransport: a dispatch triggers a pull of the sender site configured in INES.
// The request names no file: INES fetches whatever the site points to.

export interface InesResponse {
  ok: boolean;
  status: number | null;
  body: string;
}

const TIMEOUT_MS = 15_000;

export async function requestPull(): Promise<InesResponse> {
  const { baseUrl, accountName, site, destinationDirectory, idpId, csrfToken } = config.ines;
  try {
    const response = await fetch(`${baseUrl}/api/v2.0/transfers/operations?operation=pull`, {
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
    return { ok: response.ok, status: response.status, body: await response.text() };
  } catch (err) {
    return { ok: false, status: null, body: err instanceof Error ? err.message : String(err) };
  }
}
