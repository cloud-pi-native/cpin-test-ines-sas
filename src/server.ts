import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { handleArrivalNotification } from './arrival-notification.js';
import { checkPassword, closeSession, openSession, requireSession } from './auth.js';
import { config } from './config.js';
import { listDispatches, listNotifications, recordDispatches } from './dispatches.js';
import { requestPull } from './ines.js';
import { logger } from './logger.js';
import { receiverStorage, senderStorage, type Storage, type StoredFile } from './storage.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  // Browsers send the file name as UTF-8 (multer assumes latin1 by default).
  defParamCharset: 'utf8',
});

function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  return clean || 'file';
}

async function listSafely(storage: Storage): Promise<{ files: StoredFile[]; error: string | null }> {
  try {
    return { files: await storage.list(), error: null };
  } catch (err) {
    logger.error({ err }, 'Cannot list storage');
    return { files: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Called by INES: deliberately unauthenticated and lenient about the payload format.
app.post(
  '/api/receiver/notifications',
  express.text({ type: () => true, limit: '1mb' }),
  async (req, res) => {
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const { accepted, outcome } = await handleArrivalNotification(rawBody);
    res.status(accepted ? 200 : 400).json({ outcome });
  },
);

app.get('/login', (_req, res) => {
  res.sendFile('login.html', { root: PUBLIC_DIR });
});

app.get('/style.css', (_req, res) => {
  res.sendFile('style.css', { root: PUBLIC_DIR });
});

app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!checkPassword(password)) {
    logger.warn('Failed login attempt');
    res.redirect('/login?error=1');
    return;
  }
  openSession(res);
  res.redirect('/');
});

app.post('/logout', (_req, res) => {
  closeSession(res);
  res.redirect('/login');
});

app.use(requireSession);
app.use(express.static(PUBLIC_DIR));

app.get('/api/state', async (_req, res) => {
  const [sender, receiver] = await Promise.all([listSafely(senderStorage), listSafely(receiverStorage)]);
  res.json({ sender, receiver, dispatches: listDispatches(), notifications: listNotifications() });
});

app.post('/api/sender/uploads', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'Aucun fichier reçu' });
    return;
  }
  const key = sanitizeFileName(req.file.originalname);
  await senderStorage.put(key, req.file.buffer, req.file.mimetype || 'application/octet-stream');
  logger.info({ key, size: req.file.size }, 'File uploaded to sender storage');
  res.status(201).json({ key });
});

app.post('/api/dispatches', async (_req, res) => {
  const files = await senderStorage.list();
  if (files.length === 0) {
    res.status(409).json({ error: 'Aucun fichier à envoyer' });
    return;
  }
  const response = await requestPull();
  const dispatches = recordDispatches(
    files.map((file) => file.key),
    response,
  );
  logger.info({ files: files.length, ok: response.ok, inesStatus: response.status }, 'Pull requested from INES');
  res.status(response.ok ? 202 : 502).json(dispatches);
});

app.get('/api/receiver/download', async (req, res) => {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key) {
    res.status(400).json({ error: 'Paramètre "key" requis' });
    return;
  }
  if (!(await receiverStorage.exists(key))) {
    res.status(404).json({ error: 'Fichier absent du Stockage du Récepteur' });
    return;
  }
  const { stream, contentType, contentLength } = await receiverStorage.read(key);
  res.attachment(key.split('/').pop() || key);
  if (contentType) res.type(contentType);
  if (contentLength !== undefined) res.setHeader('Content-Length', contentLength);
  stream.pipe(res);
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    res.status(413).json({ error: `Fichier trop volumineux (max ${config.maxUploadBytes / 1024 / 1024} Mo)` });
    return;
  }
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: err instanceof Error ? err.message : 'Erreur interne' });
});

app.listen(config.port, () => {
  logger.info({ port: config.port }, 'cpin-ines-s3 started');
});
