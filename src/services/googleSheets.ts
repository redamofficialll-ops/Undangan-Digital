import { initializeApp, getApps } from 'firebase/app';
import {
  Auth,
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { Guest, GuestStats } from '../types';

export const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

let auth: Auth | null = null;
try {
  if (firebaseConfig?.apiKey && firebaseConfig?.projectId) {
    const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
    auth = getAuth(app);
  }
} catch {
  auth = null;
}

const provider = new GoogleAuthProvider();
SCOPES.forEach((scope) => provider.addScope(scope));

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initGoogleAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  if (!auth) {
    onAuthFailure?.();
    return () => {};
  }
  try {
    return onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        if (cachedAccessToken) {
          onAuthSuccess?.(user, cachedAccessToken);
        } else if (!isSigningIn) {
          cachedAccessToken = null;
          onAuthFailure?.();
        }
      } else {
        cachedAccessToken = null;
        onAuthFailure?.();
      }
    });
  } catch {
    onAuthFailure?.();
    return () => {};
  }
};

export const googleSignInForSheets = async (): Promise<{ user: User; accessToken: string }> => {
  if (!auth) {
    throw new Error('Konfigurasi Firebase Authentication belum tersedia.');
  }
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal mendapatkan token akses Google Sheets.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/popup-blocked') {
      throw new Error('Popup login Google diblokir oleh browser. Izinkan popup untuk situs ini lalu coba lagi.');
    }
    if (code === 'auth/popup-closed-by-user') {
      throw new Error('Jendela login Google ditutup sebelum selesai.');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error('Domain pratinjau ini belum terdaftar di Authorized Domains Firebase Authentication.');
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const getSheetsAccessToken = (): string | null => cachedAccessToken;

export const googleSignOut = async () => {
  try {
    if (auth) {
      await auth.signOut();
    }
  } finally {
    cachedAccessToken = null;
  }
};

export function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) return match[1];
  return trimmed;
}

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  sheets: string[];
  spreadsheetUrl: string;
}

export async function getSpreadsheetInfo(
  spreadsheetId: string,
  accessToken: string
): Promise<SpreadsheetInfo> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || 'Gagal membaca metadata Google Spreadsheet.');
  }
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || 'Spreadsheet Pernikahan',
    sheets: Array.isArray(data.sheets)
      ? data.sheets.map((s: { properties?: { title?: string } }) => s.properties?.title || 'Sheet1')
      : ['Sheet1'],
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
  };
}

export async function createWeddingSpreadsheet(
  coupleTitle: string,
  sheetName: string,
  accessToken: string
): Promise<SpreadsheetInfo> {
  const tabTitle = sheetName.trim() || 'Data Tamu';
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        title: `Daftar Tamu & RSVP — ${coupleTitle}`,
      },
      sheets: [
        {
          properties: {
            title: tabTitle,
            gridProperties: { frozenRowCount: 1 },
          },
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || 'Gagal membuat Google Spreadsheet baru.');
  }
  return {
    spreadsheetId: data.spreadsheetId,
    title: data.properties?.title || `Daftar Tamu & RSVP — ${coupleTitle}`,
    sheets: [tabTitle],
    spreadsheetUrl: data.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${data.spreadsheetId}`,
  };
}

function statusLabel(status: string): string {
  if (status === 'attending') return 'Hadir';
  if (status === 'not_attending') return 'Tidak Hadir';
  return 'Belum Konfirmasi';
}

export async function syncGuestsToGoogleSheet(params: {
  spreadsheetId: string;
  sheetName: string;
  guests: Guest[];
  stats: GuestStats;
  originUrl: string;
  accessToken: string;
}): Promise<void> {
  const { spreadsheetId, sheetName, guests, stats, originUrl, accessToken } = params;
  const info = await getSpreadsheetInfo(spreadsheetId, accessToken);
  const targetTab = info.sheets.includes(sheetName) ? sheetName : info.sheets[0];

  const headerRow = [
    'ID',
    'Nama Tamu',
    'Kategori / Grup',
    'No. Telepon / WA',
    'Status Kehadiran',
    'Jumlah Tamu (Pax)',
    'Catatan',
    'Tautan Unik Undangan',
    'Waktu Konfirmasi',
  ];

  const cleanOrigin = originUrl.replace(/\/+$/, '');
  const sortedGuests = [...guests].sort((a, b) => a.id - b.id);
  const rows = sortedGuests.map((g) => [
    String(g.id),
    g.name,
    g.group_name,
    g.phone || '-',
    statusLabel(g.rsvp_status),
    String(g.rsvp_status === 'attending' ? g.pax_count : 0),
    g.notes || '-',
    `${cleanOrigin}/?tamu=${encodeURIComponent(g.slug)}`,
    g.rsvp_updated_at ? new Date(g.rsvp_updated_at).toLocaleString('id-ID') : '-',
  ]);

  const summaryRows = [
    [],
    ['RINGKASAN STATISTIK', '', '', '', '', '', '', '', ''],
    ['Total Tamu Diundang', String(stats.total_invited)],
    ['Konfirmasi Hadir (Undangan)', String(stats.attending_count)],
    ['Total Orang Hadir (Pax)', String(stats.total_pax_attending)],
    ['Tidak Hadir', String(stats.not_attending_count)],
    ['Belum Konfirmasi', String(stats.pending_count)],
    ['Terakhir Disinkronkan', new Date().toLocaleString('id-ID')],
  ];

  const values = [headerRow, ...rows, ...summaryRows];
  const encodedRange = encodeURIComponent(`${targetTab}!A1`);

  // Clear existing sheet contents first so deleted/updated rows stay clean
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(targetTab)}:clear`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!writeRes.ok) {
    const err = await writeRes.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Gagal menulis data tamu ke Google Sheets.');
  }
}
