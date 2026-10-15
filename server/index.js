import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import db from './db.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED_TYPES[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) return cb(null, true);
    cb(new HttpError(400, `Formato não suportado: ${file.originalname}. Use JPG, PNG, GIF, WEBP ou AVIF.`));
  },
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Queries ----------

const q = {
  countPosts: db.prepare(`
    SELECT COUNT(*) AS total FROM posts
    WHERE (:term IS NULL OR title LIKE :term OR content LIKE :term)`),
  listPosts: db.prepare(`
    SELECT * FROM posts
    WHERE (:term IS NULL OR title LIKE :term OR content LIKE :term)
    ORDER BY created_at DESC, id DESC
    LIMIT :limit OFFSET :offset`),
  getPost: db.prepare('SELECT * FROM posts WHERE id = ?'),
  insertPost: db.prepare('INSERT INTO posts (title, content, mood) VALUES (?, ?, ?)'),
  updatePost: db.prepare(`
    UPDATE posts SET title = ?, content = ?, mood = ?, updated_at = datetime('now') WHERE id = ?`),
  deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
  imagesOf: db.prepare('SELECT id, filename, original FROM images WHERE post_id = ? ORDER BY position, id'),
  maxPosition: db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM images WHERE post_id = ?'),
  insertImage: db.prepare('INSERT INTO images (post_id, filename, original, position) VALUES (?, ?, ?, ?)'),
  getImage: db.prepare('SELECT * FROM images WHERE id = ? AND post_id = ?'),
  deleteImage: db.prepare('DELETE FROM images WHERE id = ?'),
};

function withImages(post) {
  const images = q.imagesOf.all(post.id).map((img) => ({
    id: img.id,
    url: `/uploads/${img.filename}`,
    original: img.original,
  }));
  return { ...post, images };
}

function removeFile(filename) {
  fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
}

function cleanupUploaded(files = []) {
  for (const f of files) removeFile(f.filename);
}

function validate(body) {
  const title = String(body.title ?? '').trim();
  const content = String(body.content ?? '').trim();
  const mood = String(body.mood ?? '').trim().slice(0, 16) || null;
  if (!title) throw new HttpError(400, 'O título é obrigatório.');
  if (title.length > 200) throw new HttpError(400, 'O título pode ter no máximo 200 caracteres.');
  if (!content) throw new HttpError(400, 'Escreva alguma coisa no texto do post.');
  return { title, content, mood };
}

function addImages(postId, files = []) {
  let pos = q.maxPosition.get(postId).max;
  for (const f of files) {
    // Multer decodifica o nome do arquivo como latin1; reconverte para UTF-8 (acentos)
    const original = Buffer.from(f.originalname, 'latin1').toString('utf8');
    q.insertImage.run(postId, f.filename, original, ++pos);
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Post não encontrado.');
  return id;
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- App ----------

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(PUBLIC_DIR));

app.get('/api/posts', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 6, 1), 50);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const search = String(req.query.q ?? '').trim();
  const term = search ? `%${search}%` : null;

  const { total } = q.countPosts.get({ term });
  const posts = q.listPosts.all({ term, limit, offset: (page - 1) * limit }).map(withImages);

  res.json({ posts, total, page, pages: Math.max(Math.ceil(total / limit), 1) });
});

app.get('/api/posts/:id', (req, res) => {
  const post = q.getPost.get(parseId(req.params.id));
  if (!post) throw new HttpError(404, 'Post não encontrado.');
  res.json(withImages(post));
});

app.post('/api/posts', upload.array('images'), (req, res) => {
  try {
    const { title, content, mood } = validate(req.body);
    const id = transaction(() => {
      const { lastInsertRowid } = q.insertPost.run(title, content, mood);
      addImages(lastInsertRowid, req.files);
      return lastInsertRowid;
    });
    res.status(201).json(withImages(q.getPost.get(id)));
  } catch (err) {
    cleanupUploaded(req.files);
    throw err;
  }
});

app.put('/api/posts/:id', upload.array('images'), (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!q.getPost.get(id)) throw new HttpError(404, 'Post não encontrado.');
    const { title, content, mood } = validate(req.body);

    let removeIds = [];
    try {
      removeIds = JSON.parse(req.body.removeImages || '[]').map(Number);
    } catch {
      throw new HttpError(400, 'Lista de imagens para remover inválida.');
    }

    const removedFiles = transaction(() => {
      q.updatePost.run(title, content, mood, id);
      const removed = [];
      for (const imgId of removeIds) {
        const img = q.getImage.get(imgId, id);
        if (!img) continue;
        q.deleteImage.run(imgId);
        removed.push(img.filename);
      }
      addImages(id, req.files);
      return removed;
    });
    removedFiles.forEach(removeFile);

    res.json(withImages(q.getPost.get(id)));
  } catch (err) {
    cleanupUploaded(req.files);
    throw err;
  }
});

app.delete('/api/posts/:id', (req, res) => {
  const id = parseId(req.params.id);
  const images = q.imagesOf.all(id);
  const { changes } = q.deletePost.run(id);
  if (!changes) throw new HttpError(404, 'Post não encontrado.');
  images.forEach((img) => removeFile(img.filename));
  res.status(204).end();
});

app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Rota não encontrada.')));

// SPA fallback
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const messages = {
      LIMIT_FILE_SIZE: 'Cada imagem pode ter no máximo 10 MB.',
      LIMIT_FILE_COUNT: 'Envie no máximo 20 imagens por vez.',
    };
    return res.status(400).json({ error: messages[err.code] || err.message });
  }
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Erro interno do servidor.' : err.message });
});

app.listen(PORT, HOST, () => {
  console.log(`📝 Blog rodando em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
