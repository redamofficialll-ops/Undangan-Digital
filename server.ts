import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

// Ensure local SQLite & upload directories exist
const dataDir = path.resolve(process.cwd(), 'data');
const uploadsDir = path.resolve(dataDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

// Local SQLite Database (100% independent from Firebase)
const dbPath = path.join(dataDir, 'wedding.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize SQLite schema
db.exec(`
  CREATE TABLE IF NOT EXISTS wedding_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    couple_title TEXT NOT NULL,
    bride_name TEXT NOT NULL,
    bride_parents TEXT NOT NULL,
    bride_photo TEXT NOT NULL,
    groom_name TEXT NOT NULL,
    groom_parents TEXT NOT NULL,
    groom_photo TEXT NOT NULL,
    hero_image TEXT NOT NULL,
    opening_quote TEXT NOT NULL,
    quote_source TEXT NOT NULL,
    event_date_iso TEXT NOT NULL,
    akad_date_label TEXT NOT NULL,
    akad_time TEXT NOT NULL,
    akad_venue TEXT NOT NULL,
    resepsi_date_label TEXT NOT NULL,
    resepsi_time TEXT NOT NULL,
    resepsi_venue TEXT NOT NULL,
    venue_address TEXT NOT NULL,
    map_lat REAL NOT NULL,
    map_lng REAL NOT NULL,
    map_embed_url TEXT NOT NULL DEFAULT '',
    map_directions_url TEXT NOT NULL,
    music_mode TEXT NOT NULL DEFAULT 'builtin',
    music_title TEXT NOT NULL,
    music_url TEXT NOT NULL DEFAULT '',
    spreadsheet_id TEXT NOT NULL DEFAULT '',
    spreadsheet_title TEXT NOT NULL DEFAULT '',
    sheet_name TEXT NOT NULL DEFAULT 'Data Tamu',
    auto_sync_sheets INTEGER NOT NULL DEFAULT 1,
    last_synced_at TEXT NOT NULL DEFAULT '',
    admin_password_hash TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    group_name TEXT NOT NULL DEFAULT 'Sahabat',
    phone TEXT NOT NULL DEFAULT '',
    rsvp_status TEXT NOT NULL DEFAULT 'pending',
    pax_count INTEGER NOT NULL DEFAULT 1,
    notes TEXT NOT NULL DEFAULT '',
    synced_to_sheet INTEGER NOT NULL DEFAULT 0,
    rsvp_updated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    caption TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS guestbook (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_slug TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL,
    attendance_status TEXT NOT NULL DEFAULT 'attending',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gift_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'bank',
    provider TEXT NOT NULL,
    account_number TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guest_slug TEXT NOT NULL DEFAULT '',
    sender_name TEXT NOT NULL,
    gift_type TEXT NOT NULL DEFAULT 'transfer',
    target_account TEXT NOT NULL DEFAULT '',
    amount INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
`);

// Seed initial settings if empty
const existingSettings = db.prepare('SELECT id FROM wedding_settings WHERE id = 1').get();
if (!existingSettings) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO wedding_settings (
      id, couple_title, bride_name, bride_parents, bride_photo,
      groom_name, groom_parents, groom_photo, hero_image,
      opening_quote, quote_source, event_date_iso,
      akad_date_label, akad_time, akad_venue,
      resepsi_date_label, resepsi_time, resepsi_venue,
      venue_address, map_lat, map_lng, map_embed_url, map_directions_url,
      music_mode, music_title, music_url,
      spreadsheet_id, spreadsheet_title, sheet_name, auto_sync_sheets, last_synced_at,
      admin_password_hash, updated_at
    ) VALUES (
      1, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?
    )
  `).run(
    'Anindya & Pramudya',
    'Anindya Larasati, S.Ars',
    'Putri Pertama Bapak Hendra Wijaya & Ibu Ratna Kusuma',
    '/src/assets/images/couple_portrait_bride_1795534646389.jpg',
    'Pramudya Bagaskara, S.T.',
    'Putra Kedua Bapak Surya Bagaskara & Ibu Dewi Anggraini',
    '/src/assets/images/couple_portrait_groom_1795534645670.jpg',
    '/src/assets/images/hero_wedding_arch_1795534646662.jpg',
    'Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan untukmu pasangan hidup dari jenismu sendiri, supaya kamu merasa tenteram kepadanya, dan dijadikan-Nya di antaramu rasa kasih dan sayang.',
    'QS. Ar-Rum: 21',
    '2026-12-12T08:00:00+07:00',
    'Sabtu, 12 Desember 2026',
    '08:00 – 10:00 WIB',
    'Pendopo Taman Sari, Menteng',
    'Sabtu, 12 Desember 2026',
    '11:00 – 14:30 WIB',
    'Glasshouse Conservatory, Menteng',
    'Jl. Taman Suropati No. 14, Menteng, Jakarta Pusat 10310',
    -6.1994,
    106.8326,
    '',
    'https://www.google.com/maps/search/?api=1&query=-6.1994,106.8326',
    'builtin',
    'Klasik Piano — Cahaya Pagi',
    '',
    '',
    '',
    'Data Tamu',
    1,
    '',
    '',
    now
  );
}

// Seed initial guests if empty
const guestCountRow = db.prepare('SELECT COUNT(*) as count FROM guests').get() as { count: number };
if (guestCountRow.count === 0) {
  const now = new Date().toISOString();
  const insertGuest = db.prepare(`
    INSERT INTO guests (name, slug, group_name, phone, rsvp_status, pax_count, notes, synced_to_sheet, rsvp_updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `);
  const seedGuests = [
    ['Bapak Budi Santoso & Keluarga', 'budi-santoso-k8m2', 'Keluarga', '081234567890', 'attending', 2, 'Hadir saat akad & resepsi', now, now],
    ['Siti Rahmawati', 'siti-rahmawati-p4n9', 'Sahabat', '081398765432', 'attending', 1, 'InsyaAllah hadir tepat waktu', now, now],
    ['Raka Pradipta', 'raka-pradipta-w2q7', 'Rekan Kerja', '081122334455', 'pending', 1, '', '', now],
    ['Dr. Maya Putri Lestari', 'maya-putri-j9x3', 'VIP', '081567890123', 'attending', 2, 'Meja VIP A', now, now],
    ['Dimas Aditya Nugroho', 'dimas-aditya-v6r1', 'Sahabat', '081789012345', 'not_attending', 1, 'Sedang bertugas di luar kota', now, now],
    ['Ibu Kartika Sari', 'kartika-sari-m3t5', 'Keluarga', '081901234567', 'pending', 2, '', '', now],
  ];
  const insertMany = db.transaction((rows: (string | number)[][]) => {
    for (const r of rows) insertGuest.run(...r);
  });
  insertMany(seedGuests);
}

// Seed initial gallery if empty
const galleryCountRow = db.prepare('SELECT COUNT(*) as count FROM gallery').get() as { count: number };
if (galleryCountRow.count === 0) {
  const now = new Date().toISOString();
  const insertGallery = db.prepare(`
    INSERT INTO gallery (title, caption, image_url, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertGallery.run('Konservatori Taman Pagi', 'Langkah pertama menuju lembaran baru di bawah naungan kaca taman.', '/src/assets/images/gallery_prewed_garden_1795534646462.jpg', 1, now);
  insertGallery.run('Janji & Cincin Pertunangan', 'Dua lingkar emas sederhana sebagai pengingat kesetiaan.', '/src/assets/images/gallery_rings_detail_1795534646241.jpg', 2, now);
  insertGallery.run('Pelaminan Taman Suropati', 'Nuansa bunga mawar putih dan dedaunan zaitun yang tenang.', '/src/assets/images/hero_wedding_arch_1795534646662.jpg', 3, now);
  insertGallery.run('Potret Mempelai Wanita', 'Dalam balutan kebaya putih gading dan riasan klasik.', '/src/assets/images/couple_portrait_bride_1795534646389.jpg', 4, now);
}

// Seed initial guestbook if empty
const guestbookCountRow = db.prepare('SELECT COUNT(*) as count FROM guestbook').get() as { count: number };
if (guestbookCountRow.count === 0) {
  const now = new Date().toISOString();
  const insertWish = db.prepare(`
    INSERT INTO guestbook (guest_slug, sender_name, attendance_status, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insertWish.run('budi-santoso-k8m2', 'Bapak Budi Santoso & Keluarga', 'attending', 'Barakallahu lakuma wa baraka alaikuma. Semoga menjadi keluarga yang sakinah, mawaddah, warahmah hingga akhir hayat.', now);
  insertWish.run('siti-rahmawati-p4n9', 'Siti Rahmawati', 'attending', 'Selamat berbahagia Anin dan Pram! Tidak sabar melihat kalian di pelaminan nanti.', now);
  insertWish.run('dimas-aditya-v6r1', 'Dimas Aditya Nugroho', 'not_attending', 'Mohon maaf belum bisa hadir langsung karena tugas di Surabaya. Doa terbaik selalu untuk kalian berdua.', now);
}

// Seed initial gift accounts if empty
const giftAccountCountRow = db.prepare('SELECT COUNT(*) as count FROM gift_accounts').get() as { count: number };
if (giftAccountCountRow.count === 0) {
  const now = new Date().toISOString();
  const insertGiftAcc = db.prepare(`
    INSERT INTO gift_accounts (type, provider, account_number, account_holder, notes, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertGiftAcc.run('bank', 'Bank BCA', '5420 8819 23', 'Anindya Larasati', 'Transfer Rekening BCA', 1, now);
  insertGiftAcc.run('ewallet', 'GoPay / Dana', '0812-8899-4411', 'Pramudya Bagaskara', 'Dompet Digital', 2, now);
  insertGiftAcc.run('address', 'Alamat Pengiriman Kado', 'Jl. Taman Suropati No. 14, Menteng, Jakarta Pusat 10310', 'Anindya & Pramudya (0812-8899-4411)', 'Rumah Mempelai Wanita', 3, now);
}

// Helpers
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function createAdminToken(): string {
  const exp = Date.now() + 1000 * 60 * 60 * 12; // 12 hours
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.role === 'admin' && typeof parsed.exp === 'number' && parsed.exp > Date.now();
  } catch {
    return false;
  }
}

function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (
    trimmed.startsWith('/src/') ||
    trimmed.startsWith('/uploads/') ||
    trimmed.startsWith('/assets/')
  ) {
    return true;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function makeSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 32) || 'tamu';
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${base}-${suffix}`;
}

function getPublicSettings() {
  const row = db.prepare(`
    SELECT
      couple_title, bride_name, bride_parents, bride_photo,
      groom_name, groom_parents, groom_photo, hero_image,
      opening_quote, quote_source, event_date_iso,
      akad_date_label, akad_time, akad_venue,
      resepsi_date_label, resepsi_time, resepsi_venue,
      venue_address, map_lat, map_lng, map_embed_url, map_directions_url,
      music_mode, music_title, music_url,
      spreadsheet_id, spreadsheet_title, sheet_name, auto_sync_sheets, last_synced_at,
      updated_at
    FROM wedding_settings WHERE id = 1
  `).get();
  return row;
}

function getStats() {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total_invited,
      SUM(CASE WHEN rsvp_status = 'attending' THEN 1 ELSE 0 END) as attending_count,
      SUM(CASE WHEN rsvp_status = 'not_attending' THEN 1 ELSE 0 END) as not_attending_count,
      SUM(CASE WHEN rsvp_status = 'pending' THEN 1 ELSE 0 END) as pending_count,
      COALESCE(SUM(CASE WHEN rsvp_status = 'attending' THEN pax_count ELSE 0 END), 0) as total_pax_attending,
      SUM(CASE WHEN synced_to_sheet = 0 THEN 1 ELSE 0 END) as unsynced_count
    FROM guests
  `).get() as Record<string, number | null>;
  return {
    total_invited: Number(row.total_invited || 0),
    attending_count: Number(row.attending_count || 0),
    not_attending_count: Number(row.not_attending_count || 0),
    pending_count: Number(row.pending_count || 0),
    total_pax_attending: Number(row.total_pax_attending || 0),
    unsynced_count: Number(row.unsynced_count || 0),
  };
}

// Express + HTTP + WebSocket Server
const app = express();
app.use(express.json({ limit: '2mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function broadcastWs(type: string, payload: unknown) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// File upload configuration (images & audio stored safely in ./data/uploads)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.m4a'];
    const safeExt = allowedExt.includes(ext) ? ext : '';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  fileFilter: (_req, file, cb) => {
    const okMime = file.mimetype.startsWith('image/') || file.mimetype.startsWith('audio/');
    if (!okMime) {
      cb(new Error('Hanya berkas gambar atau audio yang diperbolehkan.'));
      return;
    }
    cb(null, true);
  },
});

// Safe static serving of uploaded files with path confinement check
app.get('/uploads/:filename', (req: Request, res: Response) => {
  const rawName = String(req.params.filename || '');
  if (!rawName || rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
    res.status(400).json({ error: 'Nama berkas tidak valid' });
    return;
  }
  const resolved = path.resolve(uploadsDir, rawName);
  if (!resolved.startsWith(uploadsDir + path.sep)) {
    res.status(403).json({ error: 'Akses ditolak' });
    return;
  }
  if (!fs.existsSync(resolved)) {
    res.status(404).json({ error: 'Berkas tidak ditemukan' });
    return;
  }
  res.sendFile(resolved);
});

// Admin auth middleware
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!verifyAdminToken(token)) {
    res.status(401).json({ error: 'Sesi admin tidak valid atau telah berakhir.' });
    return;
  }
  next();
}

// Public API Routes
app.get('/api/public/invitation', (req: Request, res: Response) => {
  const slug = typeof req.query.tamu === 'string' ? req.query.tamu.trim() : '';
  const settings = getPublicSettings();
  const gallery = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, id ASC').all();
  const guestbook = db.prepare('SELECT * FROM guestbook ORDER BY id DESC LIMIT 100').all();
  const giftAccounts = db.prepare('SELECT * FROM gift_accounts ORDER BY sort_order ASC, id ASC').all();
  const stats = getStats();
  let guest = null;
  if (slug) {
    guest = db.prepare('SELECT * FROM guests WHERE slug = ?').get(slug) || null;
  }
  res.json({ settings, gallery, guestbook, giftAccounts, stats, guest });
});

// Public RSVP submission (creates guest if unregistered, or updates existing guest by slug)
app.post('/api/public/rsvp', (req: Request, res: Response) => {
  const { slug, name, phone, group_name, rsvp_status, pax_count, notes } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  const cleanStatus = ['attending', 'not_attending', 'pending'].includes(rsvp_status) ? rsvp_status : 'attending';
  const cleanPax = cleanStatus === 'attending' ? Math.max(1, Math.min(10, Number(pax_count) || 1)) : 0;
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 300) : '';
  const cleanPhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : '';
  const cleanGroup = typeof group_name === 'string' && group_name.trim() ? group_name.trim().slice(0, 50) : 'Tamu Umum';
  const now = new Date().toISOString();

  if (!cleanName) {
    res.status(400).json({ error: 'Nama tamu wajib diisi.' });
    return;
  }

  let updatedGuest: unknown = null;
  let isNew = false;

  if (typeof slug === 'string' && slug.trim()) {
    const existing = db.prepare('SELECT * FROM guests WHERE slug = ?').get(slug.trim()) as { id: number } | undefined;
    if (existing) {
      db.prepare(`
        UPDATE guests
        SET name = ?, phone = COALESCE(NULLIF(?, ''), phone), rsvp_status = ?, pax_count = ?, notes = ?, synced_to_sheet = 0, rsvp_updated_at = ?
        WHERE id = ?
      `).run(cleanName, cleanPhone, cleanStatus, cleanPax, cleanNotes, now, existing.id);
      updatedGuest = db.prepare('SELECT * FROM guests WHERE id = ?').get(existing.id);
    }
  }

  if (!updatedGuest) {
    const newSlug = makeSlug(cleanName);
    const info = db.prepare(`
      INSERT INTO guests (name, slug, group_name, phone, rsvp_status, pax_count, notes, synced_to_sheet, rsvp_updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(cleanName, newSlug, cleanGroup, cleanPhone, cleanStatus, cleanPax, cleanNotes, now, now);
    updatedGuest = db.prepare('SELECT * FROM guests WHERE id = ?').get(info.lastInsertRowid);
    isNew = true;
  }

  const stats = getStats();
  broadcastWs(isNew ? 'guest:created' : 'rsvp:updated', { guest: updatedGuest, stats });
  res.json({ guest: updatedGuest, stats });
});

// Public Real-Time Guestbook submission
app.post('/api/public/guestbook', (req: Request, res: Response) => {
  const { guest_slug, sender_name, attendance_status, message } = req.body || {};
  const cleanName = typeof sender_name === 'string' ? sender_name.trim().slice(0, 100) : '';
  const cleanMsg = typeof message === 'string' ? message.trim().slice(0, 600) : '';
  const cleanStatus = ['attending', 'not_attending', 'pending'].includes(attendance_status) ? attendance_status : 'attending';
  const cleanSlug = typeof guest_slug === 'string' ? guest_slug.trim().slice(0, 80) : '';

  if (!cleanName || !cleanMsg) {
    res.status(400).json({ error: 'Nama pengirim dan ucapan doa wajib diisi.' });
    return;
  }

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO guestbook (guest_slug, sender_name, attendance_status, message, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanSlug, cleanName, cleanStatus, cleanMsg, now);

  const entry = db.prepare('SELECT * FROM guestbook WHERE id = ?').get(info.lastInsertRowid);
  broadcastWs('guestbook:created', entry);
  res.status(201).json(entry);
});

// Public Gift Confirmation submission
app.post('/api/public/gifts', (req: Request, res: Response) => {
  const { guest_slug, sender_name, gift_type, target_account, amount, message } = req.body || {};
  const cleanName = typeof sender_name === 'string' ? sender_name.trim().slice(0, 120) : '';
  const cleanType = gift_type === 'kado' ? 'kado' : 'transfer';
  const cleanTarget = typeof target_account === 'string' ? target_account.trim().slice(0, 160) : '';
  const rawAmount = Number(amount);
  const cleanAmount = cleanType === 'transfer' && Number.isFinite(rawAmount) && rawAmount > 0
    ? Math.min(1000000000, Math.round(rawAmount))
    : 0;
  const cleanMessage = typeof message === 'string' ? message.trim().slice(0, 400) : '';
  const cleanSlug = typeof guest_slug === 'string' ? guest_slug.trim().slice(0, 80) : '';

  if (!cleanName) {
    res.status(400).json({ error: 'Nama pengirim hadiah wajib diisi.' });
    return;
  }

  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO gifts (guest_slug, sender_name, gift_type, target_account, amount, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cleanSlug, cleanName, cleanType, cleanTarget, cleanAmount, cleanMessage, now);

  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(info.lastInsertRowid);
  broadcastWs('gift:created', gift);
  res.status(201).json(gift);
});

// Admin Auth Endpoints
app.get('/api/admin/auth-status', (req: Request, res: Response) => {
  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  const row = db.prepare('SELECT admin_password_hash FROM wedding_settings WHERE id = 1').get() as { admin_password_hash: string } | undefined;
  const hasStoredHash = Boolean(row?.admin_password_hash);
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  res.json({
    needsClaim: !envPass && !hasStoredHash,
    envConfigured: Boolean(envPass),
    authenticated: verifyAdminToken(token),
  });
});

app.post('/api/admin/bootstrap', (req: Request, res: Response) => {
  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  if (envPass) {
    res.status(403).json({ error: 'Kata sandi admin sudah dikonfigurasi melalui pengaturan lingkungan server.' });
    return;
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.trim().length < 6) {
    res.status(400).json({ error: 'Kata sandi minimal 6 karakter.' });
    return;
  }
  const row = db.prepare('SELECT admin_password_hash FROM wedding_settings WHERE id = 1').get() as { admin_password_hash: string } | undefined;
  if (row?.admin_password_hash) {
    res.status(409).json({ error: 'Kata sandi admin sudah pernah dibuat.' });
    return;
  }
  const hashed = hashPassword(password.trim());
  const result = db.prepare(`
    UPDATE wedding_settings SET admin_password_hash = ? WHERE id = 1 AND (admin_password_hash = '' OR admin_password_hash IS NULL)
  `).run(hashed);
  if (result.changes === 0) {
    res.status(409).json({ error: 'Kata sandi admin sudah diklaim.' });
    return;
  }
  const token = createAdminToken();
  res.json({ token });
});

app.post('/api/admin/login', (req: Request, res: Response) => {
  const { password } = req.body || {};
  const cleanPassword = typeof password === 'string' ? password.trim() : '';
  if (!cleanPassword) {
    res.status(400).json({ error: 'Masukkan kata sandi admin.' });
    return;
  }
  const envPass = (process.env.ADMIN_PASSCODE || '').trim();
  const row = db.prepare('SELECT admin_password_hash FROM wedding_settings WHERE id = 1').get() as { admin_password_hash: string } | undefined;

  let isValid = false;
  if (envPass) {
    const a = Buffer.from(cleanPassword);
    const b = Buffer.from(envPass);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
      isValid = true;
    }
  }
  if (!isValid && row?.admin_password_hash) {
    if (verifyPassword(cleanPassword, row.admin_password_hash)) {
      isValid = true;
    }
  }

  if (!isValid) {
    res.status(401).json({ error: 'Kata sandi admin salah.' });
    return;
  }
  res.json({ token: createAdminToken() });
});

// Protected Admin Data Routes
app.get('/api/admin/dashboard', requireAdmin, (_req: Request, res: Response) => {
  const settings = getPublicSettings();
  const guests = db.prepare('SELECT * FROM guests ORDER BY id DESC').all();
  const gallery = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, id ASC').all();
  const guestbook = db.prepare('SELECT * FROM guestbook ORDER BY id DESC').all();
  const giftAccounts = db.prepare('SELECT * FROM gift_accounts ORDER BY sort_order ASC, id ASC').all();
  const gifts = db.prepare('SELECT * FROM gifts ORDER BY id DESC').all();
  const stats = getStats();
  res.json({ settings, guests, gallery, guestbook, giftAccounts, gifts, stats });
});

app.put('/api/admin/settings', requireAdmin, (req: Request, res: Response) => {
  const body = req.body || {};
  const current = getPublicSettings() as Record<string, unknown>;
  if (!current) {
    res.status(404).json({ error: 'Pengaturan tidak ditemukan.' });
    return;
  }

  if (typeof body.map_embed_url === 'string') {
    const iframeMatch = body.map_embed_url.match(/src=["']([^"']+)["']/i);
    if (iframeMatch) {
      body.map_embed_url = iframeMatch[1];
    }
  }

  const urlFields = ['bride_photo', 'groom_photo', 'hero_image', 'map_embed_url', 'map_directions_url', 'music_url'];
  for (const field of urlFields) {
    if (typeof body[field] === 'string' && !isSafeUrl(body[field])) {
      res.status(400).json({ error: `URL pada kolom ${field} tidak valid.` });
      return;
    }
  }

  const parsedLat = Number(body.map_lat);
  const parsedLng = Number(body.map_lng);

  const next = {
    couple_title: typeof body.couple_title === 'string' ? body.couple_title.trim().slice(0, 120) : current.couple_title,
    bride_name: typeof body.bride_name === 'string' ? body.bride_name.trim().slice(0, 120) : current.bride_name,
    bride_parents: typeof body.bride_parents === 'string' ? body.bride_parents.trim().slice(0, 200) : current.bride_parents,
    bride_photo: typeof body.bride_photo === 'string' ? body.bride_photo.trim() : current.bride_photo,
    groom_name: typeof body.groom_name === 'string' ? body.groom_name.trim().slice(0, 120) : current.groom_name,
    groom_parents: typeof body.groom_parents === 'string' ? body.groom_parents.trim().slice(0, 200) : current.groom_parents,
    groom_photo: typeof body.groom_photo === 'string' ? body.groom_photo.trim() : current.groom_photo,
    hero_image: typeof body.hero_image === 'string' ? body.hero_image.trim() : current.hero_image,
    opening_quote: typeof body.opening_quote === 'string' ? body.opening_quote.trim().slice(0, 500) : current.opening_quote,
    quote_source: typeof body.quote_source === 'string' ? body.quote_source.trim().slice(0, 80) : current.quote_source,
    event_date_iso: typeof body.event_date_iso === 'string' ? body.event_date_iso.trim().slice(0, 40) : current.event_date_iso,
    akad_date_label: typeof body.akad_date_label === 'string' ? body.akad_date_label.trim().slice(0, 80) : current.akad_date_label,
    akad_time: typeof body.akad_time === 'string' ? body.akad_time.trim().slice(0, 80) : current.akad_time,
    akad_venue: typeof body.akad_venue === 'string' ? body.akad_venue.trim().slice(0, 160) : current.akad_venue,
    resepsi_date_label: typeof body.resepsi_date_label === 'string' ? body.resepsi_date_label.trim().slice(0, 80) : current.resepsi_date_label,
    resepsi_time: typeof body.resepsi_time === 'string' ? body.resepsi_time.trim().slice(0, 80) : current.resepsi_time,
    resepsi_venue: typeof body.resepsi_venue === 'string' ? body.resepsi_venue.trim().slice(0, 160) : current.resepsi_venue,
    venue_address: typeof body.venue_address === 'string' ? body.venue_address.trim().slice(0, 300) : current.venue_address,
    map_lat: body.map_lat !== undefined && body.map_lat !== '' && Number.isFinite(parsedLat) ? parsedLat : Number(current.map_lat),
    map_lng: body.map_lng !== undefined && body.map_lng !== '' && Number.isFinite(parsedLng) ? parsedLng : Number(current.map_lng),
    map_embed_url: typeof body.map_embed_url === 'string' ? body.map_embed_url.trim() : current.map_embed_url,
    map_directions_url: typeof body.map_directions_url === 'string' ? body.map_directions_url.trim() : current.map_directions_url,
    music_mode: body.music_mode === 'custom' ? 'custom' : (body.music_mode === 'builtin' ? 'builtin' : current.music_mode),
    music_title: typeof body.music_title === 'string' ? body.music_title.trim().slice(0, 120) : current.music_title,
    music_url: typeof body.music_url === 'string' ? body.music_url.trim() : current.music_url,
    spreadsheet_id: typeof body.spreadsheet_id === 'string' ? body.spreadsheet_id.trim().slice(0, 120) : current.spreadsheet_id,
    spreadsheet_title: typeof body.spreadsheet_title === 'string' ? body.spreadsheet_title.trim().slice(0, 160) : current.spreadsheet_title,
    sheet_name: typeof body.sheet_name === 'string' ? body.sheet_name.trim().slice(0, 80) : current.sheet_name,
    auto_sync_sheets: typeof body.auto_sync_sheets === 'number' ? (body.auto_sync_sheets ? 1 : 0) : (typeof body.auto_sync_sheets === 'boolean' ? (body.auto_sync_sheets ? 1 : 0) : current.auto_sync_sheets),
    last_synced_at: typeof body.last_synced_at === 'string' ? body.last_synced_at.trim() : current.last_synced_at,
    updated_at: new Date().toISOString(),
  };

  db.prepare(`
    UPDATE wedding_settings SET
      couple_title = @couple_title,
      bride_name = @bride_name,
      bride_parents = @bride_parents,
      bride_photo = @bride_photo,
      groom_name = @groom_name,
      groom_parents = @groom_parents,
      groom_photo = @groom_photo,
      hero_image = @hero_image,
      opening_quote = @opening_quote,
      quote_source = @quote_source,
      event_date_iso = @event_date_iso,
      akad_date_label = @akad_date_label,
      akad_time = @akad_time,
      akad_venue = @akad_venue,
      resepsi_date_label = @resepsi_date_label,
      resepsi_time = @resepsi_time,
      resepsi_venue = @resepsi_venue,
      venue_address = @venue_address,
      map_lat = @map_lat,
      map_lng = @map_lng,
      map_embed_url = @map_embed_url,
      map_directions_url = @map_directions_url,
      music_mode = @music_mode,
      music_title = @music_title,
      music_url = @music_url,
      spreadsheet_id = @spreadsheet_id,
      spreadsheet_title = @spreadsheet_title,
      sheet_name = @sheet_name,
      auto_sync_sheets = @auto_sync_sheets,
      last_synced_at = @last_synced_at,
      updated_at = @updated_at
    WHERE id = 1
  `).run(next);

  const updated = getPublicSettings();
  broadcastWs('settings:updated', updated);
  res.json(updated);
});

// Guest CRUD
app.post('/api/admin/guests', requireAdmin, (req: Request, res: Response) => {
  const { name, group_name, phone, rsvp_status, pax_count, notes } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  if (!cleanName) {
    res.status(400).json({ error: 'Nama tamu wajib diisi.' });
    return;
  }
  const cleanGroup = typeof group_name === 'string' && group_name.trim() ? group_name.trim().slice(0, 50) : 'Sahabat';
  const cleanPhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : '';
  const cleanStatus = ['attending', 'not_attending', 'pending'].includes(rsvp_status) ? rsvp_status : 'pending';
  const cleanPax = Math.max(0, Math.min(10, Number(pax_count) || 1));
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 300) : '';
  const now = new Date().toISOString();
  const slug = makeSlug(cleanName);

  const info = db.prepare(`
    INSERT INTO guests (name, slug, group_name, phone, rsvp_status, pax_count, notes, synced_to_sheet, rsvp_updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(cleanName, slug, cleanGroup, cleanPhone, cleanStatus, cleanPax, cleanNotes, cleanStatus === 'pending' ? '' : now, now);

  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(info.lastInsertRowid);
  const stats = getStats();
  broadcastWs('guest:created', { guest, stats });
  res.status(201).json({ guest, stats });
});

app.put('/api/admin/guests/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID tamu tidak valid.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM guests WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Tamu tidak ditemukan.' });
    return;
  }
  const { name, group_name, phone, rsvp_status, pax_count, notes } = req.body || {};
  const cleanName = typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : String(existing.name);
  const cleanGroup = typeof group_name === 'string' && group_name.trim() ? group_name.trim().slice(0, 50) : String(existing.group_name);
  const cleanPhone = typeof phone === 'string' ? phone.trim().slice(0, 30) : String(existing.phone);
  const cleanStatus = ['attending', 'not_attending', 'pending'].includes(rsvp_status) ? rsvp_status : String(existing.rsvp_status);
  const rawPax = pax_count !== undefined ? Number(pax_count) : Number(existing.pax_count);
  const cleanPax =
    cleanStatus === 'attending'
      ? Math.max(1, Math.min(10, Number.isFinite(rawPax) && rawPax > 0 ? Math.round(rawPax) : 1))
      : 0;
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 300) : String(existing.notes);
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE guests
    SET name = ?, group_name = ?, phone = ?, rsvp_status = ?, pax_count = ?, notes = ?, synced_to_sheet = 0, rsvp_updated_at = ?
    WHERE id = ?
  `).run(cleanName, cleanGroup, cleanPhone, cleanStatus, cleanPax, cleanNotes, cleanStatus === 'pending' ? '' : now, id);

  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
  const stats = getStats();
  broadcastWs('guest:updated', { guest, stats });
  res.json({ guest, stats });
});

app.delete('/api/admin/guests/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID tamu tidak valid.' });
    return;
  }
  db.prepare('DELETE FROM guests WHERE id = ?').run(id);
  const stats = getStats();
  broadcastWs('guest:deleted', { id, stats });
  res.json({ deleted: true, stats });
});

app.post('/api/admin/guests/mark-synced', requireAdmin, (req: Request, res: Response) => {
  const { ids } = req.body || {};
  const now = new Date().toISOString();
  if (Array.isArray(ids) && ids.length > 0) {
    const validIds = ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
    if (validIds.length > 0) {
      const placeholders = validIds.map(() => '?').join(',');
      db.prepare(`UPDATE guests SET synced_to_sheet = 1 WHERE id IN (${placeholders})`).run(...validIds);
    }
  } else {
    db.prepare('UPDATE guests SET synced_to_sheet = 1').run();
  }
  db.prepare('UPDATE wedding_settings SET last_synced_at = ? WHERE id = 1').run(now);
  const stats = getStats();
  res.json({ stats, last_synced_at: now });
});

// Gallery CRUD
app.post('/api/admin/gallery', requireAdmin, (req: Request, res: Response) => {
  const { title, caption, image_url } = req.body || {};
  const cleanTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'Momen Spesial';
  const cleanCaption = typeof caption === 'string' ? caption.trim().slice(0, 240) : '';
  const cleanUrl = typeof image_url === 'string' ? image_url.trim() : '';
  if (!cleanUrl || !isSafeUrl(cleanUrl)) {
    res.status(400).json({ error: 'URL gambar tidak valid.' });
    return;
  }
  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM gallery').get() as { m: number }).m;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO gallery (title, caption, image_url, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleanTitle, cleanCaption, cleanUrl, maxOrder + 1, now);

  const gallery = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gallery:updated', gallery);
  res.status(201).json(gallery);
});

app.put('/api/admin/gallery/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID foto tidak valid.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Foto galeri tidak ditemukan.' });
    return;
  }
  const { title, caption, image_url } = req.body || {};
  const cleanTitle = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : String(existing.title);
  const cleanCaption = typeof caption === 'string' ? caption.trim().slice(0, 240) : String(existing.caption);
  const cleanUrl = typeof image_url === 'string' && image_url.trim() ? image_url.trim() : String(existing.image_url);
  if (!isSafeUrl(cleanUrl)) {
    res.status(400).json({ error: 'URL gambar tidak valid.' });
    return;
  }
  db.prepare('UPDATE gallery SET title = ?, caption = ?, image_url = ? WHERE id = ?').run(cleanTitle, cleanCaption, cleanUrl, id);
  const gallery = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gallery:updated', gallery);
  res.json(gallery);
});

app.delete('/api/admin/gallery/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID foto tidak valid.' });
    return;
  }
  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  const gallery = db.prepare('SELECT * FROM gallery ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gallery:updated', gallery);
  res.json(gallery);
});

// Guestbook moderation
app.delete('/api/admin/guestbook/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID ucapan tidak valid.' });
    return;
  }
  db.prepare('DELETE FROM guestbook WHERE id = ?').run(id);
  broadcastWs('guestbook:deleted', { id });
  res.json({ deleted: true });
});

// Gift Accounts CRUD & Gift Confirmations moderation
app.post('/api/admin/gift-accounts', requireAdmin, (req: Request, res: Response) => {
  const { type, provider, account_number, account_holder, notes } = req.body || {};
  const cleanType = ['bank', 'ewallet', 'address'].includes(type) ? type : 'bank';
  const cleanProvider = typeof provider === 'string' ? provider.trim().slice(0, 80) : '';
  const cleanNumber = typeof account_number === 'string' ? account_number.trim().slice(0, 240) : '';
  const cleanHolder = typeof account_holder === 'string' ? account_holder.trim().slice(0, 120) : '';
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 160) : '';

  if (!cleanProvider || !cleanNumber || !cleanHolder) {
    res.status(400).json({ error: 'Nama bank/platform, nomor/alamat, dan nama penerima wajib diisi.' });
    return;
  }

  const maxOrder = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM gift_accounts').get() as { m: number }).m;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO gift_accounts (type, provider, account_number, account_holder, notes, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(cleanType, cleanProvider, cleanNumber, cleanHolder, cleanNotes, maxOrder + 1, now);

  const giftAccounts = db.prepare('SELECT * FROM gift_accounts ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gift_accounts:updated', giftAccounts);
  res.status(201).json(giftAccounts);
});

app.put('/api/admin/gift-accounts/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID rekening/alamat tidak valid.' });
    return;
  }
  const existing = db.prepare('SELECT * FROM gift_accounts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Rekening/alamat tidak ditemukan.' });
    return;
  }
  const { type, provider, account_number, account_holder, notes } = req.body || {};
  const cleanType = ['bank', 'ewallet', 'address'].includes(type) ? type : String(existing.type);
  const cleanProvider = typeof provider === 'string' && provider.trim() ? provider.trim().slice(0, 80) : String(existing.provider);
  const cleanNumber = typeof account_number === 'string' && account_number.trim() ? account_number.trim().slice(0, 240) : String(existing.account_number);
  const cleanHolder = typeof account_holder === 'string' && account_holder.trim() ? account_holder.trim().slice(0, 120) : String(existing.account_holder);
  const cleanNotes = typeof notes === 'string' ? notes.trim().slice(0, 160) : String(existing.notes);

  db.prepare(`
    UPDATE gift_accounts SET type = ?, provider = ?, account_number = ?, account_holder = ?, notes = ? WHERE id = ?
  `).run(cleanType, cleanProvider, cleanNumber, cleanHolder, cleanNotes, id);

  const giftAccounts = db.prepare('SELECT * FROM gift_accounts ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gift_accounts:updated', giftAccounts);
  res.json(giftAccounts);
});

app.delete('/api/admin/gift-accounts/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID rekening/alamat tidak valid.' });
    return;
  }
  db.prepare('DELETE FROM gift_accounts WHERE id = ?').run(id);
  const giftAccounts = db.prepare('SELECT * FROM gift_accounts ORDER BY sort_order ASC, id ASC').all();
  broadcastWs('gift_accounts:updated', giftAccounts);
  res.json(giftAccounts);
});

app.delete('/api/admin/gifts/:id', requireAdmin, (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'ID konfirmasi hadiah tidak valid.' });
    return;
  }
  db.prepare('DELETE FROM gifts WHERE id = ?').run(id);
  broadcastWs('gift:deleted', { id });
  res.json({ deleted: true });
});

// Upload image or audio file locally to ./data/uploads
app.post('/api/admin/upload', requireAdmin, upload.single('file'), (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'Berkas gagal diunggah.' });
    return;
  }
  res.json({ url: `/uploads/${req.file.filename}`, filename: req.file.originalname });
});

// Return JSON 404 for unknown API routes instead of falling through to SPA HTML
app.all('/api/*', (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint API tidak ditemukan.' });
});

// Global & Multer error handler
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err && err.message) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

// Serve Vite in dev or static dist in production
async function start() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
      plugins: [
        {
          name: 'disable-hmr-websocket-transport',
          enforce: 'pre',
          transform(code, id) {
            if (id.replace(/\\/g, '/').includes('vite/dist/client/client.mjs')) {
              return code
                .replace(
                  'transport.connect(createHMRHandler(handleMessage));',
                  '/* HMR WebSocket disabled */'
                )
                .replace(
                  'setupForwardConsoleHandler(transport, forwardConsole);',
                  '/* Console forwarding disabled */'
                )
                .replace(
                  'console.debug("[vite] connecting...");',
                  'console.debug("[vite] hmr disabled");'
                );
            }
            return null;
          },
        },
      ],
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Niskala server running on http://0.0.0.0:${PORT}`);
  });
}

start();
