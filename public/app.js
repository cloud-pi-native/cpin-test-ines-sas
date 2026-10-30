const REFRESH_INTERVAL_MS = 5000;

// UI text stays in French.
const STATUS_LABELS = { SENT: 'Envoyé', RECEIVED: 'Reçu', FAILED: 'Échec' };

function el(tag, content, className) {
  const node = document.createElement(tag);
  if (content instanceof Node) node.append(content);
  else if (content !== undefined && content !== null) node.textContent = String(content);
  if (className) node.className = className;
  return node;
}

function row(cells) {
  const tr = document.createElement('tr');
  for (const cell of cells) tr.append(cell instanceof Node && cell.tagName === 'TD' ? cell : el('td', cell));
  return tr;
}

function emptyRow(columns, text) {
  const td = el('td', text, 'muted');
  td.colSpan = columns;
  return row([td]);
}

function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('fr-FR') : '';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`;
}

function statusBadge(status) {
  return el('span', STATUS_LABELS[status] ?? status, `status status-${status}`);
}

function collapsible(text) {
  if (!text) return '';
  const details = el('details');
  details.append(el('summary', 'voir'), el('pre', text));
  return details;
}

async function call(url, options) {
  const response = await fetch(url, options);
  if (response.status === 401) {
    location.href = '/login';
    throw new Error('Non authentifié');
  }
  return response;
}

function showError(id, error) {
  const node = document.getElementById(id);
  node.hidden = !error;
  node.textContent = error ? `Stockage illisible : ${error}` : '';
}

function replaceRows(id, rows) {
  document.getElementById(id).replaceChildren(...rows);
}

async function dispatchAll() {
  const button = document.getElementById('dispatchButton');
  const message = document.getElementById('dispatchMessage');
  button.disabled = true;
  message.textContent = 'Envoi en cours…';
  try {
    const response = await call('/api/dispatches', { method: 'POST' });
    const body = await response.json();
    if (response.ok) message.textContent = `${body.length} fichier(s) envoyé(s)`;
    else if (response.status === 502) message.textContent = `Échec de l'appel INES (${body[0]?.reason ?? 'erreur'})`;
    else message.textContent = body.error;
  } catch (err) {
    message.textContent = err.message;
  } finally {
    button.disabled = false;
    await refresh();
  }
}

function renderSender({ files, error }, dispatches) {
  showError('senderError', error);
  const byPath = new Map(dispatches.map((dispatch) => [dispatch.path, dispatch]));
  const rows = files.map((file) => {
    const dispatch = byPath.get(file.key);
    return row([file.key, formatSize(file.size), formatDate(file.lastModified), dispatch ? statusBadge(dispatch.status) : '']);
  });
  replaceRows('senderFiles', rows.length ? rows : [emptyRow(4, 'Aucun fichier')]);
}

function renderReceiver({ files, error }) {
  showError('receiverError', error);
  const rows = files.map((file) => {
    const link = el('a', 'Télécharger');
    link.href = `/api/receiver/download?key=${encodeURIComponent(file.key)}`;
    return row([file.key, formatSize(file.size), formatDate(file.lastModified), link]);
  });
  replaceRows('receiverFiles', rows.length ? rows : [emptyRow(4, 'Aucun fichier')]);
}

function renderDispatches(dispatches) {
  const rows = dispatches.map((dispatch) =>
    row([
      dispatch.path,
      statusBadge(dispatch.status),
      formatDate(dispatch.sentAt),
      formatDate(dispatch.updatedAt),
      dispatch.reason ?? '',
      collapsible(`HTTP ${dispatch.inesResponse.status ?? '—'}\n${dispatch.inesResponse.body}`),
    ]),
  );
  replaceRows('dispatches', rows.length ? rows : [emptyRow(6, 'Aucun envoi')]);
}

function renderNotifications(notifications) {
  const rows = notifications.map((notification) =>
    row([
      formatDate(notification.receivedAt),
      notification.path ?? '',
      notification.dispatchPath ?? 'orpheline',
      notification.outcome,
      collapsible(notification.rawBody),
    ]),
  );
  replaceRows('notifications', rows.length ? rows : [emptyRow(5, 'Aucune notification')]);
}

async function refresh() {
  try {
    const response = await call('/api/state');
    const state = await response.json();
    renderSender(state.sender, state.dispatches);
    renderReceiver(state.receiver);
    renderDispatches(state.dispatches);
    renderNotifications(state.notifications);
    document.getElementById('lastRefresh').textContent = `Mis à jour à ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (err) {
    document.getElementById('lastRefresh').textContent = `Rafraîchissement impossible : ${err.message}`;
  }
}

document.getElementById('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('uploadMessage');
  message.textContent = 'Dépôt en cours…';
  try {
    const response = await call('/api/sender/uploads', { method: 'POST', body: new FormData(form) });
    const body = await response.json();
    message.textContent = response.ok ? `Déposé : ${body.key}` : body.error;
    if (response.ok) form.reset();
  } catch (err) {
    message.textContent = err.message;
  }
  await refresh();
});

document.getElementById('dispatchButton').addEventListener('click', dispatchAll);

refresh();
setInterval(refresh, REFRESH_INTERVAL_MS);
