import { fileNameOf, findDispatchByFileName, recordNotification, updateStatus } from './dispatches.js';
import { logger } from './logger.js';
import { receiverStorage } from './storage.js';

// Provisional arrival notification contract: the only file to adapt once the contract is known.

const PATH_FIELDS = ['path', 'key', 'fileName', 'file'] as const;

interface ParsedNotification {
  path: string | null;
  failureReported: boolean;
}

function parseNotification(rawBody: string): ParsedNotification {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { path: null, failureReported: false };
  }
  if (typeof body !== 'object' || body === null) return { path: null, failureReported: false };

  const fields = body as Record<string, unknown>;
  const path =
    PATH_FIELDS.map((field) => fields[field]).find(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ) ?? null;
  const failureReported = typeof fields.status === 'string' && fields.status.toUpperCase() === 'KO';
  return { path, failureReported };
}

async function checkPresence(path: string): Promise<{ present: boolean; error: string | null }> {
  try {
    return { present: await receiverStorage.exists(path), error: null };
  } catch (err) {
    return { present: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface NotificationResult {
  accepted: boolean;
  outcome: string;
}

export async function handleArrivalNotification(rawBody: string): Promise<NotificationResult> {
  const { path, failureReported } = parseNotification(rawBody);
  const receivedAt = new Date().toISOString();

  if (!path) {
    const outcome = `Chemin introuvable dans le payload (champs attendus : ${PATH_FIELDS.join(', ')})`;
    recordNotification({ receivedAt, rawBody, path: null, dispatchPath: null, outcome });
    logger.warn({ rawBody }, 'Arrival notification without a file path');
    return { accepted: false, outcome };
  }

  const dispatch = findDispatchByFileName(fileNameOf(path));
  let outcome: string;

  if (failureReported) {
    outcome = 'Échec signalé par INES';
    if (dispatch) updateStatus(dispatch, 'FAILED', outcome);
  } else {
    const { present, error } = await checkPresence(path);
    if (error) {
      outcome = `Vérification impossible dans le Stockage du Récepteur : ${error}`;
      if (dispatch) updateStatus(dispatch, 'FAILED', outcome);
    } else if (present) {
      outcome = 'Fichier présent dans le Stockage du Récepteur';
      if (dispatch) updateStatus(dispatch, 'RECEIVED', null);
    } else {
      outcome = 'Notifié mais introuvable dans le Stockage du Récepteur';
      if (dispatch) updateStatus(dispatch, 'FAILED', outcome);
    }
  }

  if (!dispatch) outcome = `Notification orpheline — ${outcome}`;

  recordNotification({ receivedAt, rawBody, path, dispatchPath: dispatch?.path ?? null, outcome });
  logger.info(
    { path, dispatchPath: dispatch?.path ?? null, status: dispatch?.status ?? null, orphan: !dispatch },
    'Arrival notification received',
  );
  return { accepted: true, outcome };
}
