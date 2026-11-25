import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

type RsvpStatus = 'pending' | 'attending' | 'not_attending';
type GiftAccountType = 'bank' | 'ewallet' | 'address';
type GiftType = 'transfer' | 'kado';

interface WeddingSettingsInternal {
  couple_title: string;
  bride_name: string;
  bride_parents: string;
  bride_photo: string;
  groom_name: string;
  groom_parents: string;
  groom_photo: string;
  hero_image: string;
  opening_quote: string;
  quote_source: string;
  event_date_iso: string;
  akad_date_label: string;
  akad_time: string;
  akad_venue: string;
  resepsi_date_label: string;
  resepsi_time: string;
  resepsi_venue: string;
  venue_address: string;
  map_lat: number;
  map_lng: number;
  map_embed_url: string;
  map_directions_url: string;
  music_mode: 'builtin' | 'custom';
  music_title: string;
  music_url: string;
  spreadsheet_id: string;
  spreadsheet_title: string;
  sheet_name: string;
  auto_sync_sheets: number;
  last_synced_at: string;
  admin_password_hash: string;
  updated_at: string;
}

interface Guest {
  id: number;
  name: string;
  slug: string;
  group_name: string;
  phone: string;
  rsvp_status: RsvpStatus;
  pax_count: number;
  notes: string;
  synced_to_sheet: number;
  rsvp_updated_at: string;
  created_at: string;
}

interface GalleryItem {
  id: number;
  title: string;
  caption: string;
  image_url: string;
  sort_order: number;
  created_at: string;
}

interface GuestbookEntry {
  id: number;
  guest_slug: string;
  sender_name: string;
  attendance_status: RsvpStatus;
  message: string;
  created_at: string;
}

interface GiftAccount {
  id: number;
  type: GiftAccountType;
  provider: string;
  account_number: string;
  account_holder: string;
  notes: string;
  sort_order: number;
  created_at: string;
}

interface GiftConfirmation {
  id: number;
  guest_slug: string;
  sender_name: string;
  gift_type: GiftType;
  target_account: string;
  amount: number;
  message: string;
  created_at: string;
}

interface WeddingDatabase {
  settings: WeddingSettingsInternal;
  guests: Guest[];
  gallery: GalleryItem[];
  guestbook: GuestbookEntry[];
  gift_accounts: GiftAccount[];
  gifts: GiftConfirmation[];
  counters: {
    guests: number;
    gallery: number;
    guestbook: number;
    gift_accounts: number;
    gifts: number;
  };
}

const STORE_NAME = 'niskala-wedding-data';
const DB_KEY = 'wedding-db.json';
const TMP_DB_PATH = '/tmp/niskala-wedding-db.json';
const TMP_UPLOADS_DIR = '/tmp/niskala-uploads';

// Deterministic per-site fallback ensures admin tokens stay valid across cold starts on Netlify
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  crypto
    .createHash('sha256')
    .update(
      process.env.SITE_ID ||
        process.env.URL ||
        process.env.DEPLOY_PRIME_URL ||
        'niskala-netlify-session-key'
    )
    .digest('hex');

function createInitialDb(): WeddingDatabase {
  const now = new Date().toISOString();
  return {
    settings: {
      couple_title: 'Anindya & Pramudya',
      bride_name: 'Anindya Larasati, S.Ars',
      bride_parents: 'Putri Pertama Bapak Hendra Wijaya & Ibu Ratna Kusuma',
      bride_photo: '/src/assets/images/couple_portrait_bride_1795534646389.jpg',
      groom_name: 'Pramudya Bagaskara, S.T.',
      groom_parents: 'Putra Kedua Bapak Surya Bagaskara & Ibu Dewi Anggraini',
      groom_photo: '/src/assets/images/couple_portrait_groom_1795534645670.jpg',
      hero_image: '/src/assets/images/hero_wedding_arch_1795534646662.jpg',
      opening_quote:
        'Dan di antara tanda-tanda kekuasaan-Nya ialah Dia menciptakan untukmu pasangan hidup dari jenismu sendiri, supaya kamu merasa tenteram kepadanya, dan dijadikan-Nya di antaramu rasa kasih dan sayang.',
      quote_source: 'QS. Ar-Rum: 21',
      event_date_iso: '2026-12-12T08:00:00+07:00',
      akad_date_label: 'Sabtu, 12 Desember 2026',
      akad_time: '08:00 – 10:00 WIB',
      akad_venue: 'Pendopo Taman Sari, Menteng',
      resepsi_date_label: 'Sabtu, 12 Desember 2026',
      resepsi_time: '11:00 – 14:30 WIB',
      resepsi_venue: 'Glasshouse Conservatory, Menteng',
      venue_address: 'Jl. Taman Suropati No. 14, Menteng, Jakarta Pusat 10310',
      map_lat: -6.1994,
      map_lng: 106.8326,
      map_embed_url: '',
      map_directions_url: 'https://www.google.com/maps/search/?api=1&query=-6.1994,106.8326',
      music_mode: 'builtin',
      music_title: 'Klasik Piano — Cahaya Pagi',
      music_url: '',
      spreadsheet_id: '',
      spreadsheet_title: '',
      sheet_name: 'Data Tamu',
      auto_sync_sheets: 1,
      last_synced_at: '',
      admin_password_hash: '',
      updated_at: now,
    },
    guests: [
      {
        id: 1,
        name: 'Bapak Budi Santoso & Keluarga',
        slug: 'budi-santoso-k8m2',
        group_name: 'Keluarga',
        phone: '081234567890',
        rsvp_status: 'attending',
        pax_count: 2,
        notes: 'Hadir saat akad & resepsi',
        synced_to_sheet: 0,
        rsvp_updated_at: now,
        created_at: now,
      },
      {
        id: 2,
        name: 'Siti Rahmawati',
        slug: 'siti-rahmawati-p4n9',
        group_name: 'Sahabat',
        phone: '081398765432',
        rsvp_status: 'attending',
        pax_count: 1,
        notes: 'InsyaAllah hadir tepat waktu',
        synced_to_sheet: 0,
        rsvp_updated_at: now,
        created_at: now,
      },
      {
        id: 3,
        name: 'Raka Pradipta',
        slug: 'raka-pradipta-w2q7',
        group_name: 'Rekan Kerja',
        phone: '081122334455',
        rsvp_status: 'pending',
        pax_count: 1,
        notes: '',
        synced_to_sheet: 0,
        rsvp_updated_at: '',
        created_at: now,
      },
      {
        id: 4,
        name: 'Dr. Maya Putri Lestari',
        slug: 'maya-putri-j9x3',
        group_name: 'VIP',
        phone: '081567890123',
        rsvp_status: 'attending',
        pax_count: 2,
        notes: 'Meja VIP A',
        synced_to_sheet: 0,
        rsvp_updated_at: now,
        created_at: now,
      },
      {
        id: 5,
        name: 'Dimas Aditya Nugroho',
        slug: 'dimas-aditya-v6r1',
        group_name: 'Sahabat',
        phone: '081789012345',
        rsvp_status: 'not_attending',
        pax_count: 0,
        notes: 'Sedang bertugas di luar kota',
        synced_to_sheet: 0,
        rsvp_updated_at: now,
        created_at: now,
      },
      {
        id: 6,
        name: 'Ibu Kartika Sari',
        slug: 'kartika-sari-m3t5',
        group_name: 'Keluarga',
        phone: '081901234567',
        rsvp_status: 'pending',
        pax_count: 2,
        notes: '',
        synced_to_sheet: 0,
        rsvp_updated_at: '',
        created_at: now,
      },
    ],
    gallery: [
      {
        id: 1,
        title: 'Konservatori Taman Pagi',
        caption: 'Langkah pertama menuju lembaran baru di bawah naungan kaca taman.',
        image_url: '/src/assets/images/gallery_prewed_garden_1795534646462.jpg',
        sort_order: 1,
        created_at: now,
      },
      {
        id: 2,
        title: 'Janji & Cincin Pertunangan',
        caption: 'Dua lingkar emas sederhana sebagai pengingat kesetiaan.',
        image_url: '/src/assets/images/gallery_rings_detail_1795534646241.jpg',
        sort_order: 2,
        created_at: now,
      },
      {
        id: 3,
        title: 'Pelaminan Taman Suropati',
        caption: 'Nuansa bunga mawar putih dan dedaunan zaitun yang tenang.',
        image_url: '/src/assets/images/hero_wedding_arch_1795534646662.jpg',
        sort_order: 3,
        created_at: now,
      },
      {
        id: 4,
        title: 'Potret Mempelai Wanita',
        caption: 'Dalam balutan kebaya putih gading dan riasan klasik.',
        image_url: '/src/assets/images/couple_portrait_bride_1795534646389.jpg',
        sort_order: 4,
        created_at: now,
      },
    ],
    guestbook: [
      {
        id: 1,
        guest_slug: 'budi-santoso-k8m2',
        sender_name: 'Bapak Budi Santoso & Keluarga',
        attendance_status: 'attending',
        message:
          'Barakallahu lakuma wa baraka alaikuma. Semoga menjadi keluarga yang sakinah, mawaddah, warahmah hingga akhir hayat.',
        created_at: now,
      },
      {
        id: 2,
        guest_slug: 'siti-rahmawati-p4n9',
        sender_name: 'Siti Rahmawati',
        attendance_status: 'attending',
        message: 'Selamat berbahagia Anin dan Pram! Tidak sabar melihat kalian di pelaminan nanti.',
        created_at: now,
      },
      {
        id: 3,
        guest_slug: 'dimas-aditya-v6r1',
        sender_name: 'Dimas Aditya Nugroho',
        attendance_status: 'not_attending',
        message:
          'Mohon maaf belum bisa hadir langsung karena tugas di Surabaya. Doa terbaik selalu untuk kalian berdua.',
        created_at: now,
      },
    ],
    gift_accounts: [
      {
        id: 1,
        type: 'bank',
        provider: 'Bank BCA',
        account_number: '5420 8819 23',
        account_holder: 'Anindya Larasati',
        notes: 'Transfer Rekening BCA',
        sort_order: 1,
        created_at: now,
      },
      {
        id: 2,
        type: 'ewallet',
        provider: 'GoPay / Dana',
        account_number: '0812-8899-4411',
        account_holder: 'Pramudya Bagaskara',
        notes: 'Dompet Digital',
        sort_order: 2,
        created_at: now,
      },
      {
        id: 3,
        type: 'address',
        provider: 'Alamat Pengiriman Kado',
        account_number: 'Jl. Taman Suropati No. 14, Menteng, Jakarta Pusat 10310',
        account_holder: 'Anindya & Pramudya (0812-8899-4411)',
        notes: 'Rumah Mempelai Wanita',
        sort_order: 3,
        created_at: now,
      },
    ],
    gifts: [],
    counters: {
      guests: 6,
      gallery: 4,
      guestbook: 3,
      gift_accounts: 3,
      gifts: 0,
    },
  };
}

function getBlobStore() {
  try {
    return getStore({ name: STORE_NAME, consistency: 'strong' });
  } catch {
    return null;
  }
}

async function loadDb(): Promise<WeddingDatabase> {
  const store = getBlobStore();
  if (store) {
    try {
      const data = (await store.get(DB_KEY, { type: 'json' })) as WeddingDatabase | null;
      if (data && data.settings) return data;
      const seeded = createInitialDb();
      await store.setJSON(DB_KEY, seeded);
      return seeded;
    } catch {
      // Fall back to /tmp below if Blobs is unavailable in a non-Netlify environment
    }
  }

  try {
    if (fs.existsSync(TMP_DB_PATH)) {
      const raw = fs.readFileSync(TMP_DB_PATH, 'utf8');
      const parsed = JSON.parse(raw) as WeddingDatabase;
      if (parsed && parsed.settings) return parsed;
    }
  } catch {
    // ignore corrupted tmp cache
  }
  const seeded = createInitialDb();
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(seeded), 'utf8');
  } catch {
    // ignore read-only error
  }
  return seeded;
}

async function saveDb(db: WeddingDatabase): Promise<void> {
  const store = getBlobStore();
  if (store) {
    try {
      await store.setJSON(DB_KEY, db);
      return;
    } catch {
      // fallback to /tmp
    }
  }
  try {
    fs.writeFileSync(TMP_DB_PATH, JSON.stringify(db), 'utf8');
  } catch {
    // ignore
  }
}

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
  const exp = Date.now() + 1000 * 60 * 60 * 12;
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token: string | undefined): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(payload)
    .digest('base64url');
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
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 32) || 'tamu';
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${base}-${suffix}`;
}

function getPublicSettings(db: WeddingDatabase) {
  const { admin_password_hash: _hidden, ...publicFields } = db.settings;
  return publicFields;
}

function getStats(db: WeddingDatabase) {
  let attending_count = 0;
  let not_attending_count = 0;
  let pending_count = 0;
  let total_pax_attending = 0;
  let unsynced_count = 0;

  for (const g of db.guests) {
    if (g.rsvp_status === 'attending') {
      attending_count += 1;
      total_pax_attending += Number(g.pax_count) || 0;
    } else if (g.rsvp_status === 'not_attending') {
      not_attending_count += 1;
    } else {
      pending_count += 1;
    }
    if (!g.synced_to_sheet) {
      unsynced_count += 1;
    }
  }

  return {
    total_invited: db.guests.length,
    attending_count,
    not_attending_count,
    pending_count,
    total_pax_attending,
    unsynced_count,
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function getBearerToken(req: Request): string {
  const authHeader = req.headers.get('authorization') || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await req.json()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default async (req: Request, _context: Context): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '') || '/';
  const method = req.method.toUpperCase();

  // Serve uploaded media files
  if (method === 'GET' && pathname.startsWith('/uploads/')) {
    const rawName = decodeURIComponent(pathname.slice('/uploads/'.length));
    if (!rawName || rawName.includes('..') || rawName.includes('/') || rawName.includes('\\')) {
      return json({ error: 'Nama berkas tidak valid' }, 400);
    }
    const store = getBlobStore();
    if (store) {
      try {
        const res = await store.getWithMetadata(`upload:${rawName}`, { type: 'arrayBuffer' });
        if (res) {
          const contentType =
            typeof res.metadata?.contentType === 'string'
              ? res.metadata.contentType
              : 'application/octet-stream';
          return new Response(res.data, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=31536000, immutable',
            },
          });
        }
      } catch {
        // fall through to /tmp
      }
    }

    const filePath = path.resolve(TMP_UPLOADS_DIR, rawName);
    if (filePath.startsWith(TMP_UPLOADS_DIR + path.sep) && fs.existsSync(filePath)) {
      const buf = fs.readFileSync(filePath);
      const metaPath = `${filePath}.meta.json`;
      let contentType = 'application/octet-stream';
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { contentType?: string };
          if (meta.contentType) contentType = meta.contentType;
        } catch {
          // ignore
        }
      }
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }
    return json({ error: 'Berkas tidak ditemukan' }, 404);
  }

  // Public Invitation Bundle
  if (method === 'GET' && pathname === '/api/public/invitation') {
    const db = await loadDb();
    const slug = (url.searchParams.get('tamu') || '').trim();
    const guest = slug ? db.guests.find((g) => g.slug === slug) || null : null;
    return json({
      settings: getPublicSettings(db),
      gallery: [...db.gallery].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
      guestbook: [...db.guestbook].sort((a, b) => b.id - a.id).slice(0, 100),
      giftAccounts: [...db.gift_accounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
      stats: getStats(db),
      guest,
      realtimeMode: 'polling',
    });
  }

  // Public RSVP
  if (method === 'POST' && pathname === '/api/public/rsvp') {
    const body = await readJsonBody(req);
    const cleanName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    const rsvpStatus = String(body.rsvp_status || '');
    const cleanStatus: RsvpStatus = ['attending', 'not_attending', 'pending'].includes(rsvpStatus)
      ? (rsvpStatus as RsvpStatus)
      : 'attending';
    const cleanPax =
      cleanStatus === 'attending' ? Math.max(1, Math.min(10, Number(body.pax_count) || 1)) : 0;
    const cleanNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : '';
    const cleanPhone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
    const cleanGroup =
      typeof body.group_name === 'string' && body.group_name.trim()
        ? body.group_name.trim().slice(0, 50)
        : 'Tamu Umum';
    const slugInput = typeof body.slug === 'string' ? body.slug.trim() : '';

    if (!cleanName) {
      return json({ error: 'Nama tamu wajib diisi.' }, 400);
    }

    const db = await loadDb();
    const now = new Date().toISOString();
    let updatedGuest: Guest | null = null;

    if (slugInput) {
      const existing = db.guests.find((g) => g.slug === slugInput);
      if (existing) {
        existing.name = cleanName;
        if (cleanPhone) existing.phone = cleanPhone;
        existing.rsvp_status = cleanStatus;
        existing.pax_count = cleanPax;
        existing.notes = cleanNotes;
        existing.synced_to_sheet = 0;
        existing.rsvp_updated_at = now;
        updatedGuest = existing;
      }
    }

    if (!updatedGuest) {
      db.counters.guests += 1;
      updatedGuest = {
        id: db.counters.guests,
        name: cleanName,
        slug: makeSlug(cleanName),
        group_name: cleanGroup,
        phone: cleanPhone,
        rsvp_status: cleanStatus,
        pax_count: cleanPax,
        notes: cleanNotes,
        synced_to_sheet: 0,
        rsvp_updated_at: now,
        created_at: now,
      };
      db.guests.push(updatedGuest);
    }

    await saveDb(db);
    return json({ guest: updatedGuest, stats: getStats(db) });
  }

  // Public Guestbook
  if (method === 'POST' && pathname === '/api/public/guestbook') {
    const body = await readJsonBody(req);
    const cleanName =
      typeof body.sender_name === 'string' ? body.sender_name.trim().slice(0, 100) : '';
    const cleanMsg = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
    const attStatus = String(body.attendance_status || '');
    const cleanStatus: RsvpStatus = ['attending', 'not_attending', 'pending'].includes(attStatus)
      ? (attStatus as RsvpStatus)
      : 'attending';
    const cleanSlug = typeof body.guest_slug === 'string' ? body.guest_slug.trim().slice(0, 80) : '';

    if (!cleanName || !cleanMsg) {
      return json({ error: 'Nama pengirim dan ucapan doa wajib diisi.' }, 400);
    }

    const db = await loadDb();
    db.counters.guestbook += 1;
    const entry: GuestbookEntry = {
      id: db.counters.guestbook,
      guest_slug: cleanSlug,
      sender_name: cleanName,
      attendance_status: cleanStatus,
      message: cleanMsg,
      created_at: new Date().toISOString(),
    };
    db.guestbook.push(entry);
    await saveDb(db);
    return json(entry, 201);
  }

  // Public Gifts
  if (method === 'POST' && pathname === '/api/public/gifts') {
    const body = await readJsonBody(req);
    const cleanName =
      typeof body.sender_name === 'string' ? body.sender_name.trim().slice(0, 120) : '';
    const cleanType: GiftType = body.gift_type === 'kado' ? 'kado' : 'transfer';
    const cleanTarget =
      typeof body.target_account === 'string' ? body.target_account.trim().slice(0, 160) : '';
    const rawAmount = Number(body.amount);
    const cleanAmount =
      cleanType === 'transfer' && Number.isFinite(rawAmount) && rawAmount > 0
        ? Math.min(1000000000, Math.round(rawAmount))
        : 0;
    const cleanMessage = typeof body.message === 'string' ? body.message.trim().slice(0, 400) : '';
    const cleanSlug = typeof body.guest_slug === 'string' ? body.guest_slug.trim().slice(0, 80) : '';

    if (!cleanName) {
      return json({ error: 'Nama pengirim hadiah wajib diisi.' }, 400);
    }

    const db = await loadDb();
    db.counters.gifts += 1;
    const gift: GiftConfirmation = {
      id: db.counters.gifts,
      guest_slug: cleanSlug,
      sender_name: cleanName,
      gift_type: cleanType,
      target_account: cleanTarget,
      amount: cleanAmount,
      message: cleanMessage,
      created_at: new Date().toISOString(),
    };
    db.gifts.push(gift);
    await saveDb(db);
    return json(gift, 201);
  }

  // Admin Auth Status
  if (method === 'GET' && pathname === '/api/admin/auth-status') {
    const db = await loadDb();
    const envPass = (process.env.ADMIN_PASSCODE || '').trim();
    const hasStoredHash = Boolean(db.settings.admin_password_hash);
    const token = getBearerToken(req);
    return json({
      needsClaim: !envPass && !hasStoredHash,
      envConfigured: Boolean(envPass),
      authenticated: verifyAdminToken(token),
    });
  }

  // Admin Bootstrap
  if (method === 'POST' && pathname === '/api/admin/bootstrap') {
    const envPass = (process.env.ADMIN_PASSCODE || '').trim();
    if (envPass) {
      return json(
        { error: 'Kata sandi admin sudah dikonfigurasi melalui pengaturan lingkungan server.' },
        403
      );
    }
    const body = await readJsonBody(req);
    const password = typeof body.password === 'string' ? body.password.trim() : '';
    if (password.length < 6) {
      return json({ error: 'Kata sandi minimal 6 karakter.' }, 400);
    }
    const db = await loadDb();
    if (db.settings.admin_password_hash) {
      return json({ error: 'Kata sandi admin sudah pernah dibuat.' }, 409);
    }
    db.settings.admin_password_hash = hashPassword(password);
    await saveDb(db);
    return json({ token: createAdminToken() });
  }

  // Admin Login
  if (method === 'POST' && pathname === '/api/admin/login') {
    const body = await readJsonBody(req);
    const cleanPassword = typeof body.password === 'string' ? body.password.trim() : '';
    if (!cleanPassword) {
      return json({ error: 'Masukkan kata sandi admin.' }, 400);
    }
    const db = await loadDb();
    const envPass = (process.env.ADMIN_PASSCODE || '').trim();

    let isValid = false;
    if (envPass) {
      const a = Buffer.from(cleanPassword);
      const b = Buffer.from(envPass);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        isValid = true;
      }
    }
    if (!isValid && db.settings.admin_password_hash) {
      if (verifyPassword(cleanPassword, db.settings.admin_password_hash)) {
        isValid = true;
      }
    }

    if (!isValid) {
      return json({ error: 'Kata sandi admin salah.' }, 401);
    }
    return json({ token: createAdminToken() });
  }

  // Protected Admin Routes
  if (pathname.startsWith('/api/admin/')) {
    const token = getBearerToken(req);
    if (!verifyAdminToken(token)) {
      return json({ error: 'Sesi admin tidak valid atau telah berakhir.' }, 401);
    }

    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      const db = await loadDb();
      return json({
        settings: getPublicSettings(db),
        guests: [...db.guests].sort((a, b) => b.id - a.id),
        gallery: [...db.gallery].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
        guestbook: [...db.guestbook].sort((a, b) => b.id - a.id),
        giftAccounts: [...db.gift_accounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
        gifts: [...db.gifts].sort((a, b) => b.id - a.id),
        stats: getStats(db),
      });
    }

    if (method === 'PUT' && pathname === '/api/admin/settings') {
      const body = await readJsonBody(req);
      const db = await loadDb();
      const current = db.settings;

      if (typeof body.map_embed_url === 'string') {
        const iframeMatch = body.map_embed_url.match(/src=["']([^"']+)["']/i);
        if (iframeMatch) {
          body.map_embed_url = iframeMatch[1];
        }
      }

      const urlFields = [
        'bride_photo',
        'groom_photo',
        'hero_image',
        'map_embed_url',
        'map_directions_url',
        'music_url',
      ];
      for (const field of urlFields) {
        const val = body[field];
        if (typeof val === 'string' && !isSafeUrl(val)) {
          return json({ error: `URL pada kolom ${field} tidak valid.` }, 400);
        }
      }

      const parsedLat = Number(body.map_lat);
      const parsedLng = Number(body.map_lng);

      db.settings = {
        ...current,
        couple_title:
          typeof body.couple_title === 'string'
            ? body.couple_title.trim().slice(0, 120)
            : current.couple_title,
        bride_name:
          typeof body.bride_name === 'string'
            ? body.bride_name.trim().slice(0, 120)
            : current.bride_name,
        bride_parents:
          typeof body.bride_parents === 'string'
            ? body.bride_parents.trim().slice(0, 200)
            : current.bride_parents,
        bride_photo:
          typeof body.bride_photo === 'string' ? body.bride_photo.trim() : current.bride_photo,
        groom_name:
          typeof body.groom_name === 'string'
            ? body.groom_name.trim().slice(0, 120)
            : current.groom_name,
        groom_parents:
          typeof body.groom_parents === 'string'
            ? body.groom_parents.trim().slice(0, 200)
            : current.groom_parents,
        groom_photo:
          typeof body.groom_photo === 'string' ? body.groom_photo.trim() : current.groom_photo,
        hero_image:
          typeof body.hero_image === 'string' ? body.hero_image.trim() : current.hero_image,
        opening_quote:
          typeof body.opening_quote === 'string'
            ? body.opening_quote.trim().slice(0, 500)
            : current.opening_quote,
        quote_source:
          typeof body.quote_source === 'string'
            ? body.quote_source.trim().slice(0, 80)
            : current.quote_source,
        event_date_iso:
          typeof body.event_date_iso === 'string'
            ? body.event_date_iso.trim().slice(0, 40)
            : current.event_date_iso,
        akad_date_label:
          typeof body.akad_date_label === 'string'
            ? body.akad_date_label.trim().slice(0, 80)
            : current.akad_date_label,
        akad_time:
          typeof body.akad_time === 'string'
            ? body.akad_time.trim().slice(0, 80)
            : current.akad_time,
        akad_venue:
          typeof body.akad_venue === 'string'
            ? body.akad_venue.trim().slice(0, 160)
            : current.akad_venue,
        resepsi_date_label:
          typeof body.resepsi_date_label === 'string'
            ? body.resepsi_date_label.trim().slice(0, 80)
            : current.resepsi_date_label,
        resepsi_time:
          typeof body.resepsi_time === 'string'
            ? body.resepsi_time.trim().slice(0, 80)
            : current.resepsi_time,
        resepsi_venue:
          typeof body.resepsi_venue === 'string'
            ? body.resepsi_venue.trim().slice(0, 160)
            : current.resepsi_venue,
        venue_address:
          typeof body.venue_address === 'string'
            ? body.venue_address.trim().slice(0, 300)
            : current.venue_address,
        map_lat:
          body.map_lat !== undefined && body.map_lat !== '' && Number.isFinite(parsedLat)
            ? parsedLat
            : current.map_lat,
        map_lng:
          body.map_lng !== undefined && body.map_lng !== '' && Number.isFinite(parsedLng)
            ? parsedLng
            : current.map_lng,
        map_embed_url:
          typeof body.map_embed_url === 'string' ? body.map_embed_url.trim() : current.map_embed_url,
        map_directions_url:
          typeof body.map_directions_url === 'string'
            ? body.map_directions_url.trim()
            : current.map_directions_url,
        music_mode:
          body.music_mode === 'custom'
            ? 'custom'
            : body.music_mode === 'builtin'
            ? 'builtin'
            : current.music_mode,
        music_title:
          typeof body.music_title === 'string'
            ? body.music_title.trim().slice(0, 120)
            : current.music_title,
        music_url:
          typeof body.music_url === 'string' ? body.music_url.trim() : current.music_url,
        spreadsheet_id:
          typeof body.spreadsheet_id === 'string'
            ? body.spreadsheet_id.trim().slice(0, 120)
            : current.spreadsheet_id,
        spreadsheet_title:
          typeof body.spreadsheet_title === 'string'
            ? body.spreadsheet_title.trim().slice(0, 160)
            : current.spreadsheet_title,
        sheet_name:
          typeof body.sheet_name === 'string'
            ? body.sheet_name.trim().slice(0, 80)
            : current.sheet_name,
        auto_sync_sheets:
          typeof body.auto_sync_sheets === 'number'
            ? body.auto_sync_sheets
              ? 1
              : 0
            : typeof body.auto_sync_sheets === 'boolean'
            ? body.auto_sync_sheets
              ? 1
              : 0
            : current.auto_sync_sheets,
        last_synced_at:
          typeof body.last_synced_at === 'string'
            ? body.last_synced_at.trim()
            : current.last_synced_at,
        updated_at: new Date().toISOString(),
      };

      await saveDb(db);
      return json(getPublicSettings(db));
    }

    if (method === 'POST' && pathname === '/api/admin/guests') {
      const body = await readJsonBody(req);
      const cleanName = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
      if (!cleanName) return json({ error: 'Nama tamu wajib diisi.' }, 400);
      const cleanGroup =
        typeof body.group_name === 'string' && body.group_name.trim()
          ? body.group_name.trim().slice(0, 50)
          : 'Sahabat';
      const cleanPhone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : '';
      const rawStatus = String(body.rsvp_status || '');
      const cleanStatus: RsvpStatus = ['attending', 'not_attending', 'pending'].includes(rawStatus)
        ? (rawStatus as RsvpStatus)
        : 'pending';
      const cleanPax = Math.max(0, Math.min(10, Number(body.pax_count) || 1));
      const cleanNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : '';
      const now = new Date().toISOString();

      const db = await loadDb();
      db.counters.guests += 1;
      const guest: Guest = {
        id: db.counters.guests,
        name: cleanName,
        slug: makeSlug(cleanName),
        group_name: cleanGroup,
        phone: cleanPhone,
        rsvp_status: cleanStatus,
        pax_count: cleanPax,
        notes: cleanNotes,
        synced_to_sheet: 0,
        rsvp_updated_at: cleanStatus === 'pending' ? '' : now,
        created_at: now,
      };
      db.guests.push(guest);
      await saveDb(db);
      return json({ guest, stats: getStats(db) }, 201);
    }

    if (method === 'POST' && pathname === '/api/admin/guests/mark-synced') {
      const body = await readJsonBody(req);
      const db = await loadDb();
      const now = new Date().toISOString();
      if (Array.isArray(body.ids) && body.ids.length > 0) {
        const idSet = new Set(
          body.ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0)
        );
        for (const g of db.guests) {
          if (idSet.has(g.id)) g.synced_to_sheet = 1;
        }
      } else {
        for (const g of db.guests) {
          g.synced_to_sheet = 1;
        }
      }
      db.settings.last_synced_at = now;
      await saveDb(db);
      return json({ stats: getStats(db), last_synced_at: now });
    }

    const guestMatch = pathname.match(/^\/api\/admin\/guests\/(\d+)$/);
    if (guestMatch) {
      const id = Number(guestMatch[1]);
      const db = await loadDb();
      const idx = db.guests.findIndex((g) => g.id === id);
      if (method === 'PUT') {
        if (idx === -1) return json({ error: 'Tamu tidak ditemukan.' }, 404);
        const existing = db.guests[idx];
        const body = await readJsonBody(req);
        const cleanName =
          typeof body.name === 'string' && body.name.trim()
            ? body.name.trim().slice(0, 120)
            : existing.name;
        const cleanGroup =
          typeof body.group_name === 'string' && body.group_name.trim()
            ? body.group_name.trim().slice(0, 50)
            : existing.group_name;
        const cleanPhone =
          typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : existing.phone;
        const rawStatus = String(body.rsvp_status || '');
        const cleanStatus: RsvpStatus = ['attending', 'not_attending', 'pending'].includes(
          rawStatus
        )
          ? (rawStatus as RsvpStatus)
          : existing.rsvp_status;
        const rawPax = body.pax_count !== undefined ? Number(body.pax_count) : existing.pax_count;
        const cleanPax =
          cleanStatus === 'attending'
            ? Math.max(1, Math.min(10, Number.isFinite(rawPax) && rawPax > 0 ? Math.round(rawPax) : 1))
            : 0;
        const cleanNotes =
          typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : existing.notes;
        const now = new Date().toISOString();

        db.guests[idx] = {
          ...existing,
          name: cleanName,
          group_name: cleanGroup,
          phone: cleanPhone,
          rsvp_status: cleanStatus,
          pax_count: cleanPax,
          notes: cleanNotes,
          synced_to_sheet: 0,
          rsvp_updated_at: cleanStatus === 'pending' ? '' : now,
        };
        await saveDb(db);
        return json({ guest: db.guests[idx], stats: getStats(db) });
      }
      if (method === 'DELETE') {
        if (idx !== -1) {
          db.guests.splice(idx, 1);
          await saveDb(db);
        }
        return json({ deleted: true, stats: getStats(db) });
      }
    }

    if (method === 'POST' && pathname === '/api/admin/gallery') {
      const body = await readJsonBody(req);
      const cleanTitle =
        typeof body.title === 'string' && body.title.trim()
          ? body.title.trim().slice(0, 120)
          : 'Momen Spesial';
      const cleanCaption =
        typeof body.caption === 'string' ? body.caption.trim().slice(0, 240) : '';
      const cleanUrl = typeof body.image_url === 'string' ? body.image_url.trim() : '';
      if (!cleanUrl || !isSafeUrl(cleanUrl)) {
        return json({ error: 'URL gambar tidak valid.' }, 400);
      }
      const db = await loadDb();
      const maxOrder = db.gallery.reduce((m, x) => Math.max(m, x.sort_order), 0);
      db.counters.gallery += 1;
      db.gallery.push({
        id: db.counters.gallery,
        title: cleanTitle,
        caption: cleanCaption,
        image_url: cleanUrl,
        sort_order: maxOrder + 1,
        created_at: new Date().toISOString(),
      });
      await saveDb(db);
      const sorted = [...db.gallery].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      return json(sorted, 201);
    }

    const galleryMatch = pathname.match(/^\/api\/admin\/gallery\/(\d+)$/);
    if (galleryMatch) {
      const id = Number(galleryMatch[1]);
      const db = await loadDb();
      const idx = db.gallery.findIndex((g) => g.id === id);
      if (method === 'PUT') {
        if (idx === -1) return json({ error: 'Foto galeri tidak ditemukan.' }, 404);
        const existing = db.gallery[idx];
        const body = await readJsonBody(req);
        const cleanTitle =
          typeof body.title === 'string' && body.title.trim()
            ? body.title.trim().slice(0, 120)
            : existing.title;
        const cleanCaption =
          typeof body.caption === 'string' ? body.caption.trim().slice(0, 240) : existing.caption;
        const cleanUrl =
          typeof body.image_url === 'string' && body.image_url.trim()
            ? body.image_url.trim()
            : existing.image_url;
        if (!isSafeUrl(cleanUrl)) {
          return json({ error: 'URL gambar tidak valid.' }, 400);
        }
        db.gallery[idx] = {
          ...existing,
          title: cleanTitle,
          caption: cleanCaption,
          image_url: cleanUrl,
        };
        await saveDb(db);
        return json([...db.gallery].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      }
      if (method === 'DELETE') {
        if (idx !== -1) {
          db.gallery.splice(idx, 1);
          await saveDb(db);
        }
        return json([...db.gallery].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      }
    }

    const guestbookMatch = pathname.match(/^\/api\/admin\/guestbook\/(\d+)$/);
    if (guestbookMatch && method === 'DELETE') {
      const id = Number(guestbookMatch[1]);
      const db = await loadDb();
      db.guestbook = db.guestbook.filter((g) => g.id !== id);
      await saveDb(db);
      return json({ deleted: true });
    }

    if (method === 'POST' && pathname === '/api/admin/gift-accounts') {
      const body = await readJsonBody(req);
      const rawType = String(body.type || '');
      const cleanType: GiftAccountType = ['bank', 'ewallet', 'address'].includes(rawType)
        ? (rawType as GiftAccountType)
        : 'bank';
      const cleanProvider = typeof body.provider === 'string' ? body.provider.trim().slice(0, 80) : '';
      const cleanNumber =
        typeof body.account_number === 'string' ? body.account_number.trim().slice(0, 240) : '';
      const cleanHolder =
        typeof body.account_holder === 'string' ? body.account_holder.trim().slice(0, 120) : '';
      const cleanNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 160) : '';

      if (!cleanProvider || !cleanNumber || !cleanHolder) {
        return json(
          { error: 'Nama bank/platform, nomor/alamat, dan nama penerima wajib diisi.' },
          400
        );
      }

      const db = await loadDb();
      const maxOrder = db.gift_accounts.reduce((m, x) => Math.max(m, x.sort_order), 0);
      db.counters.gift_accounts += 1;
      db.gift_accounts.push({
        id: db.counters.gift_accounts,
        type: cleanType,
        provider: cleanProvider,
        account_number: cleanNumber,
        account_holder: cleanHolder,
        notes: cleanNotes,
        sort_order: maxOrder + 1,
        created_at: new Date().toISOString(),
      });
      await saveDb(db);
      return json(
        [...db.gift_accounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
        201
      );
    }

    const giftAccMatch = pathname.match(/^\/api\/admin\/gift-accounts\/(\d+)$/);
    if (giftAccMatch) {
      const id = Number(giftAccMatch[1]);
      const db = await loadDb();
      const idx = db.gift_accounts.findIndex((g) => g.id === id);
      if (method === 'PUT') {
        if (idx === -1) return json({ error: 'Rekening/alamat tidak ditemukan.' }, 404);
        const existing = db.gift_accounts[idx];
        const body = await readJsonBody(req);
        const rawType = String(body.type || '');
        const cleanType: GiftAccountType = ['bank', 'ewallet', 'address'].includes(rawType)
          ? (rawType as GiftAccountType)
          : existing.type;
        const cleanProvider =
          typeof body.provider === 'string' && body.provider.trim()
            ? body.provider.trim().slice(0, 80)
            : existing.provider;
        const cleanNumber =
          typeof body.account_number === 'string' && body.account_number.trim()
            ? body.account_number.trim().slice(0, 240)
            : existing.account_number;
        const cleanHolder =
          typeof body.account_holder === 'string' && body.account_holder.trim()
            ? body.account_holder.trim().slice(0, 120)
            : existing.account_holder;
        const cleanNotes =
          typeof body.notes === 'string' ? body.notes.trim().slice(0, 160) : existing.notes;

        db.gift_accounts[idx] = {
          ...existing,
          type: cleanType,
          provider: cleanProvider,
          account_number: cleanNumber,
          account_holder: cleanHolder,
          notes: cleanNotes,
        };
        await saveDb(db);
        return json([...db.gift_accounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      }
      if (method === 'DELETE') {
        if (idx !== -1) {
          db.gift_accounts.splice(idx, 1);
          await saveDb(db);
        }
        return json([...db.gift_accounts].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id));
      }
    }

    const giftMatch = pathname.match(/^\/api\/admin\/gifts\/(\d+)$/);
    if (giftMatch && method === 'DELETE') {
      const id = Number(giftMatch[1]);
      const db = await loadDb();
      db.gifts = db.gifts.filter((g) => g.id !== id);
      await saveDb(db);
      return json({ deleted: true });
    }

    if (method === 'POST' && pathname === '/api/admin/upload') {
      try {
        const formData = await req.formData();
        const file = formData.get('file');
        if (!file || !(file instanceof File)) {
          return json({ error: 'Berkas gagal diunggah.' }, 400);
        }
        if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
          return json({ error: 'Hanya berkas gambar atau audio yang diperbolehkan.' }, 400);
        }
        if (file.size > 5.5 * 1024 * 1024) {
          return json({ error: 'Ukuran berkas maksimal 5,5 MB pada mode serverless.' }, 400);
        }

        const ext = path.extname(file.name).toLowerCase().replace(/[^a-z0-9.]/g, '');
        const allowedExt = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.wav', '.ogg', '.m4a'];
        const safeExt = allowedExt.includes(ext) ? ext : '';
        const filename = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
        const buf = await file.arrayBuffer();

        const store = getBlobStore();
        if (store) {
          try {
            await store.set(`upload:${filename}`, buf, {
              metadata: { contentType: file.type || 'application/octet-stream' },
            });
            return json({ url: `/uploads/${filename}`, filename: file.name });
          } catch {
            // fall through to /tmp
          }
        }

        fs.mkdirSync(TMP_UPLOADS_DIR, { recursive: true });
        fs.writeFileSync(path.join(TMP_UPLOADS_DIR, filename), Buffer.from(buf));
        fs.writeFileSync(
          path.join(TMP_UPLOADS_DIR, `${filename}.meta.json`),
          JSON.stringify({ contentType: file.type || 'application/octet-stream' })
        );
        return json({ url: `/uploads/${filename}`, filename: file.name });
      } catch {
        return json({ error: 'Gagal memproses berkas unggahan.' }, 400);
      }
    }
  }

  return json({ error: 'Endpoint API tidak ditemukan.' }, 404);
};

export const config: Config = {
  path: ['/api/*', '/uploads/*'],
};
