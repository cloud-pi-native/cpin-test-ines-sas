import type { InesResponse } from './ines.js';

// In-memory state: lost on restart, hence a single replica on Kubernetes.

export type DispatchStatus = 'SENT' | 'RECEIVED' | 'FAILED';

export interface Dispatch {
  path: string;
  fileName: string;
  status: DispatchStatus;
  /** Shown as-is in the UI, hence in French. */
  reason: string | null;
  sentAt: string;
  updatedAt: string;
  inesResponse: { status: number | null; body: string };
}

export interface ReceivedNotification {
  receivedAt: string;
  rawBody: string;
  path: string | null;
  dispatchPath: string | null;
  /** Shown as-is in the UI, hence in French. */
  outcome: string;
}

const MAX_NOTIFICATIONS = 100;

const dispatches = new Map<string, Dispatch>();
const notifications: ReceivedNotification[] = [];

export function fileNameOf(path: string): string {
  return path.split('/').pop() || path;
}

function failureReason(response: InesResponse): string | null {
  if (response.ok) return null;
  if (response.status === null) return 'INES injoignable';
  return `INES a répondu ${response.status}`;
}

/** One INES pull covers every file present in the sender storage: each one is tracked separately. */
export function recordDispatches(paths: string[], response: InesResponse): Dispatch[] {
  const now = new Date().toISOString();
  const reason = failureReason(response);
  return paths.map((path) => {
    const dispatch: Dispatch = {
      path,
      fileName: fileNameOf(path),
      status: response.ok ? 'SENT' : 'FAILED',
      reason,
      sentAt: now,
      updatedAt: now,
      inesResponse: { status: response.status, body: response.body },
    };
    dispatches.set(path, dispatch);
    return dispatch;
  });
}

/** Matches by file name: INES may store the file under another prefix on the receiver side. */
export function findDispatchByFileName(fileName: string): Dispatch | undefined {
  let latest: Dispatch | undefined;
  for (const dispatch of dispatches.values()) {
    if (dispatch.fileName !== fileName) continue;
    if (!latest || dispatch.sentAt > latest.sentAt) latest = dispatch;
  }
  return latest;
}

export function updateStatus(dispatch: Dispatch, status: DispatchStatus, reason: string | null): void {
  dispatch.status = status;
  dispatch.reason = reason;
  dispatch.updatedAt = new Date().toISOString();
}

export function listDispatches(): Dispatch[] {
  return [...dispatches.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));
}

export function recordNotification(notification: ReceivedNotification): void {
  notifications.unshift(notification);
  notifications.length = Math.min(notifications.length, MAX_NOTIFICATIONS);
}

export function listNotifications(): ReceivedNotification[] {
  return notifications;
}
