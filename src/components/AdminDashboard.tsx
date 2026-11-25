import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  Gift,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  Lock,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Music,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import {
  GalleryItem,
  GiftAccount,
  GiftAccountType,
  GiftConfirmation,
  Guest,
  GuestbookEntry,
  GuestStats,
  RsvpStatus,
  WeddingSettings,
} from '../types';
import {
  createWeddingSpreadsheet,
  extractSpreadsheetId,
  getSheetsAccessToken,
  getSpreadsheetInfo,
  googleSignInForSheets,
  googleSignOut,
  initGoogleAuth,
  syncGuestsToGoogleSheet,
} from '../services/googleSheets';
import { exportGuestsToExcel, exportGuestsToPDF } from '../services/exportData';
import { weddingAudio } from '../services/audioEngine';
import { ResilientImage } from './ResilientImage';

type AdminTab =
  | 'overview'
  | 'guests'
  | 'gifts'
  | 'sheets'
  | 'content'
  | 'gallery'
  | 'map_music'
  | 'guestbook';

interface AdminDashboardProps {
  onBackToInvitation: () => void;
  liveEventSignal: number; // increments when WS receives guest/rsvp/guestbook/settings updates
}

function statusText(status: RsvpStatus): string {
  if (status === 'attending') return 'Hadir';
  if (status === 'not_attending') return 'Tidak Hadir';
  return 'Menunggu';
}

function statusColorClass(status: RsvpStatus): string {
  if (status === 'attending') return 'text-[#1F4E3D] font-semibold';
  if (status === 'not_attending') return 'text-red-700 font-medium';
  return 'text-[#8A6A3E] font-medium';
}

function formatSafeDateTime(value: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID');
}

export function AdminDashboard({
  onBackToInvitation,
  liveEventSignal,
}: AdminDashboardProps) {
  // Admin Auth State (token kept strictly in React memory)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [needsClaim, setNeedsClaim] = useState(false);
  const [envConfigured, setEnvConfigured] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [passwordInput, setPasswordInput] = useState('');
  const [confirmPasswordInput, setConfirmPasswordInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Dashboard Data State
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const el = mobileTabRefs.current[activeTab];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [activeTab]);

  const [settings, setSettings] = useState<WeddingSettings | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);
  const [guestbook, setGuestbook] = useState<GuestbookEntry[]>([]);
  const [giftAccounts, setGiftAccounts] = useState<GiftAccount[]>([]);
  const [gifts, setGifts] = useState<GiftConfirmation[]>([]);
  const [stats, setStats] = useState<GuestStats>({
    total_invited: 0,
    attending_count: 0,
    not_attending_count: 0,
    pending_count: 0,
    total_pax_attending: 0,
    unsynced_count: 0,
  });
  const [loadingData, setLoadingData] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Guest Filter & Form State
  const [guestSearch, setGuestSearch] = useState('');
  const [guestFilter, setGuestFilter] = useState<'all' | RsvpStatus>('all');
  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestGroup, setNewGuestGroup] = useState('Sahabat');
  const [newGuestPhone, setNewGuestPhone] = useState('');
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  // Gift Account Form State
  const [newGiftType, setNewGiftType] = useState<GiftAccountType>('bank');
  const [newGiftProvider, setNewGiftProvider] = useState('');
  const [newGiftNumber, setNewGiftNumber] = useState('');
  const [newGiftHolder, setNewGiftHolder] = useState('');
  const [newGiftNotes, setNewGiftNotes] = useState('');
  const [editingGiftAcc, setEditingGiftAcc] = useState<GiftAccount | null>(null);

  // Gallery Form State
  const [newPhotoTitle, setNewPhotoTitle] = useState('');
  const [newPhotoCaption, setNewPhotoCaption] = useState('');
  const [newPhotoUrl, setNewPhotoUrl] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);

  // Content & Map/Music Draft State
  const [draftSettings, setDraftSettings] = useState<WeddingSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewMuted, setPreviewMuted] = useState(false);

  // Google Sheets OAuth & Sync State
  const [googleUser, setGoogleUser] = useState<FirebaseUser | null>(null);
  const [sheetsToken, setSheetsToken] = useState<string | null>(getSheetsAccessToken());
  const [sheetInputId, setSheetInputId] = useState('');
  const [availableTabs, setAvailableTabs] = useState<string[]>([]);
  const [sheetsBusy, setSheetsBusy] = useState(false);
  const [sheetsStatusMsg, setSheetsStatusMsg] = useState('');
  const [confirmSyncModal, setConfirmSyncModal] = useState(false);
  const autoSyncLockRef = useRef(false);

  // Confirmation modal for deleting items
  const [confirmDelete, setConfirmDelete] = useState<{
    kind: 'guest' | 'gallery' | 'guestbook' | 'gift_account' | 'gift';
    id: number;
    label: string;
  } | null>(null);

  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      weddingAudio.stop();
    };
  }, []);

  // Check admin auth status on mount
  useEffect(() => {
    fetch('/api/admin/auth-status')
      .then((r) => {
        if (!r.ok) throw new Error('Gagal memeriksa status autentikasi');
        return r.json();
      })
      .then((d) => {
        setNeedsClaim(Boolean(d.needsClaim));
        setEnvConfigured(Boolean(d.envConfigured));
      })
      .catch(() => {
        setAuthError('Tidak dapat terhubung ke server lokal.');
      })
      .finally(() => setCheckingAuth(false));
  }, []);

  // Initialize Google Workspace auth listener
  useEffect(() => {
    const unsub = initGoogleAuth(
      (user, token) => {
        setGoogleUser(user);
        setSheetsToken(token);
      },
      () => {
        setGoogleUser(null);
        setSheetsToken(null);
      }
    );
    return () => unsub();
  }, []);

  const fetchDashboard = useCallback(async () => {
    if (!authToken) return;
    setLoadingData(true);
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.status === 401) {
        setAuthToken(null);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || 'Gagal memuat data dashboard.');
        return;
      }
      setSettings(data.settings);
      setDraftSettings((prev) => (prev ? prev : data.settings));
      setGuests(Array.isArray(data.guests) ? data.guests : []);
      setGallery(Array.isArray(data.gallery) ? data.gallery : []);
      setGuestbook(Array.isArray(data.guestbook) ? data.guestbook : []);
      setGiftAccounts(Array.isArray(data.giftAccounts) ? data.giftAccounts : []);
      setGifts(Array.isArray(data.gifts) ? data.gifts : []);
      if (data.stats) setStats(data.stats);
      if (data.settings?.spreadsheet_id) {
        setSheetInputId(data.settings.spreadsheet_id);
      }
    } catch {
      showToast('Koneksi ke server lokal terputus.');
    } finally {
      setLoadingData(false);
    }
  }, [authToken, showToast]);

  useEffect(() => {
    if (authToken) {
      void fetchDashboard();
    }
  }, [authToken, liveEventSignal, fetchDashboard]);

  // Automatic real-time Google Sheets sync whenever connected & unsynced guests exist
  useEffect(() => {
    if (
      !authToken ||
      !sheetsToken ||
      !settings?.spreadsheet_id ||
      !settings.auto_sync_sheets ||
      stats.unsynced_count === 0 ||
      autoSyncLockRef.current
    ) {
      return;
    }

    const runAutoSync = async () => {
      autoSyncLockRef.current = true;
      try {
        await syncGuestsToGoogleSheet({
          spreadsheetId: settings.spreadsheet_id,
          sheetName: settings.sheet_name || 'Data Tamu',
          guests,
          stats,
          originUrl: window.location.origin,
          accessToken: sheetsToken,
        });
        await fetch('/api/admin/guests/mark-synced', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ids: guests.map((g) => g.id) }),
        });
        setSheetsStatusMsg(
          `Tersinkronisasi otomatis pada ${new Date().toLocaleTimeString('id-ID')}`
        );
        void fetchDashboard();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Sinkronisasi otomatis gagal.';
        setSheetsStatusMsg(msg);
      } finally {
        autoSyncLockRef.current = false;
      }
    };

    void runAutoSync();
  }, [authToken, sheetsToken, settings, guests, stats, fetchDashboard]);

  const handleAdminAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (needsClaim && passwordInput !== confirmPasswordInput) {
      setAuthError('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setAuthSubmitting(true);
    try {
      const endpoint = needsClaim ? '/api/admin/bootstrap' : '/api/admin/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: passwordInput }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Autentikasi gagal.');
      setAuthToken(data.token);
      setNeedsClaim(false);
      setPasswordInput('');
      setConfirmPasswordInput('');
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Gagal masuk.');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleUploadFile = async (file: File): Promise<string | null> => {
    if (!authToken) return null;
    setUploadingFile(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/admin/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengunggah berkas.');
      return data.url as string;
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Unggahan gagal.');
      return null;
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSaveSettings = async (patch?: Partial<WeddingSettings>) => {
    if (!authToken || !draftSettings) return;
    setSavingSettings(true);
    try {
      let autoLat = draftSettings.map_lat;
      let autoLng = draftSettings.map_lng;
      if (draftSettings.map_directions_url) {
        const match =
          draftSettings.map_directions_url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
          draftSettings.map_directions_url.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/) ||
          draftSettings.map_directions_url.match(/ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (match) {
          const latVal = Number(match[1]);
          const lngVal = Number(match[2]);
          if (Number.isFinite(latVal) && Number.isFinite(lngVal)) {
            autoLat = latVal;
            autoLng = lngVal;
          }
        }
      }
      const baseWithCoords: WeddingSettings = {
        ...draftSettings,
        map_lat: autoLat,
        map_lng: autoLng,
      };
      const payload = patch ? { ...baseWithCoords, ...patch } : baseWithCoords;
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan pengaturan.');
      setSettings(data);
      setDraftSettings(data);
      showToast('Perubahan berhasil disimpan ke database SQL lokal.');
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menyimpan.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken || !newGuestName.trim()) return;
    try {
      const res = await fetch('/api/admin/guests', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newGuestName.trim(),
          group_name: newGuestGroup.trim() || 'Sahabat',
          phone: newGuestPhone.trim(),
          rsvp_status: 'pending',
          pax_count: 1,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menambahkan tamu.');
      setNewGuestName('');
      setNewGuestPhone('');
      showToast('Tamu baru berhasil ditambahkan.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menambahkan tamu.');
    }
  };

  const handleUpdateGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken || !editingGuest) return;
    try {
      const res = await fetch(`/api/admin/guests/${editingGuest.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingGuest),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui data tamu.');
      setEditingGuest(null);
      showToast('Data tamu diperbarui.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui data tamu.');
    }
  };

  const handleExecuteDelete = async () => {
    if (!authToken || !confirmDelete) return;
    const { kind, id } = confirmDelete;
    const endpoint =
      kind === 'guest'
        ? `/api/admin/guests/${id}`
        : kind === 'gallery'
        ? `/api/admin/gallery/${id}`
        : kind === 'gift_account'
        ? `/api/admin/gift-accounts/${id}`
        : kind === 'gift'
        ? `/api/admin/gifts/${id}`
        : `/api/admin/guestbook/${id}`;
    try {
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menghapus data.');
      setConfirmDelete(null);
      showToast('Data berhasil dihapus.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menghapus data.');
    }
  };

  const handleAddGiftAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken || !newGiftProvider.trim() || !newGiftNumber.trim() || !newGiftHolder.trim()) {
      return;
    }
    try {
      const res = await fetch('/api/admin/gift-accounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: newGiftType,
          provider: newGiftProvider.trim(),
          account_number: newGiftNumber.trim(),
          account_holder: newGiftHolder.trim(),
          notes: newGiftNotes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menambahkan rekening/alamat.');
      setNewGiftProvider('');
      setNewGiftNumber('');
      setNewGiftHolder('');
      setNewGiftNotes('');
      showToast('Rekening / alamat kado berhasil ditambahkan.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menambahkan rekening/alamat.');
    }
  };

  const handleUpdateGiftAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken || !editingGiftAcc) return;
    try {
      const res = await fetch(`/api/admin/gift-accounts/${editingGiftAcc.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(editingGiftAcc),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui data.');
      setEditingGiftAcc(null);
      showToast('Rekening / alamat kado diperbarui.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal memperbarui data.');
    }
  };

  const handleAddGalleryItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authToken || !newPhotoUrl.trim()) return;
    try {
      const res = await fetch('/api/admin/gallery', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: newPhotoTitle.trim() || 'Momen Spesial',
          caption: newPhotoCaption.trim(),
          image_url: newPhotoUrl.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal menambah foto.');
      setNewPhotoTitle('');
      setNewPhotoCaption('');
      setNewPhotoUrl('');
      showToast('Foto ditambahkan ke galeri.');
      void fetchDashboard();
    } catch (err: unknown) {
      showToast(err instanceof Error ? err.message : 'Gagal menambah foto.');
    }
  };

  const handleGoogleSignIn = async () => {
    setSheetsBusy(true);
    try {
      const { user, accessToken } = await googleSignInForSheets();
      setGoogleUser(user);
      setSheetsToken(accessToken);
      setSheetsStatusMsg('Terhubung dengan Google Sheets.');
      if (settings?.spreadsheet_id) {
        const info = await getSpreadsheetInfo(settings.spreadsheet_id, accessToken);
        setAvailableTabs(info.sheets);
      }
    } catch (err: unknown) {
      setSheetsStatusMsg(err instanceof Error ? err.message : 'Gagal masuk dengan Google.');
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleCreateNewSheet = async () => {
    if (!sheetsToken || !settings) return;
    setSheetsBusy(true);
    try {
      const tabName = draftSettings?.sheet_name || settings.sheet_name || 'Data Tamu';
      const info = await createWeddingSpreadsheet(settings.couple_title, tabName, sheetsToken);
      setSheetInputId(info.spreadsheetId);
      setAvailableTabs(info.sheets);
      await handleSaveSettings({
        spreadsheet_id: info.spreadsheetId,
        spreadsheet_title: info.title,
        sheet_name: info.sheets[0],
      });
      // Immediately populate the newly created spreadsheet
      await syncGuestsToGoogleSheet({
        spreadsheetId: info.spreadsheetId,
        sheetName: info.sheets[0],
        guests,
        stats,
        originUrl: window.location.origin,
        accessToken: sheetsToken,
      });
      await fetch('/api/admin/guests/mark-synced', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: guests.map((g) => g.id) }),
      });
      setSheetsStatusMsg(`Spreadsheet "${info.title}" dibuat & disinkronkan.`);
      void fetchDashboard();
    } catch (err: unknown) {
      setSheetsStatusMsg(err instanceof Error ? err.message : 'Gagal membuat spreadsheet.');
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleConnectExistingSheet = async () => {
    if (!sheetsToken || !sheetInputId.trim()) return;
    setSheetsBusy(true);
    try {
      const id = extractSpreadsheetId(sheetInputId);
      const info = await getSpreadsheetInfo(id, sheetsToken);
      setSheetInputId(info.spreadsheetId);
      setAvailableTabs(info.sheets);
      await handleSaveSettings({
        spreadsheet_id: info.spreadsheetId,
        spreadsheet_title: info.title,
        sheet_name: info.sheets[0] || 'Data Tamu',
      });
      setSheetsStatusMsg(`Terhubung ke "${info.title}".`);
    } catch (err: unknown) {
      setSheetsStatusMsg(err instanceof Error ? err.message : 'Spreadsheet tidak ditemukan atau akses ditolak.');
    } finally {
      setSheetsBusy(false);
    }
  };

  const handleConfirmManualSync = async () => {
    if (!sheetsToken || !settings?.spreadsheet_id || !authToken) return;
    setConfirmSyncModal(false);
    setSheetsBusy(true);
    try {
      await syncGuestsToGoogleSheet({
        spreadsheetId: settings.spreadsheet_id,
        sheetName: draftSettings?.sheet_name || settings.sheet_name || 'Data Tamu',
        guests,
        stats,
        originUrl: window.location.origin,
        accessToken: sheetsToken,
      });
      await fetch('/api/admin/guests/mark-synced', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ids: guests.map((g) => g.id) }),
      });
      setSheetsStatusMsg(`Berhasil sinkronisasi ${guests.length} data tamu.`);
      showToast('Data tamu tersinkronisasi ke Google Sheets.');
      void fetchDashboard();
    } catch (err: unknown) {
      setSheetsStatusMsg(err instanceof Error ? err.message : 'Gagal sinkronisasi.');
    } finally {
      setSheetsBusy(false);
    }
  };

  const getUniqueInviteLink = (slug: string) => {
    const cleanOrigin = window.location.origin.replace(/\/+$/, '');
    return `${cleanOrigin}/?tamu=${encodeURIComponent(slug)}`;
  };

  const copyTextSafely = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall back to execCommand below when iframe clipboard permission is restricted
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const handleCopyLink = async (guest: Guest) => {
    const link = getUniqueInviteLink(guest.slug);
    const copied = await copyTextSafely(link);
    if (copied) {
      setCopiedSlug(guest.slug);
      showToast(`Tautan unik untuk ${guest.name} disalin.`);
      window.setTimeout(() => setCopiedSlug(null), 2000);
    } else {
      showToast(`Gagal menyalin otomatis. Tautan: ?tamu=${guest.slug}`);
    }
  };

  const handleCopyWhatsAppMessage = async (guest: Guest) => {
    const link = getUniqueInviteLink(guest.slug);
    const couple = settings?.couple_title || 'Kami';
    const text = `Kepada Yth. ${guest.name},\n\nTanpa mengurangi rasa hormat, kami mengundang Bapak/Ibu/Saudara/i untuk menghadiri acara pernikahan ${couple}.\n\nBuka undangan digital & konfirmasi kehadiran melalui tautan khusus berikut:\n${link}\n\nMerupakan kehormatan dan kebahagiaan bagi kami apabila Bapak/Ibu/Saudara/i berkenan hadir dan memberikan doa restu.`;
    const copied = await copyTextSafely(text);
    showToast(
      copied
        ? `Pesan WhatsApp untuk ${guest.name} disalin.`
        : 'Browser membatasi akses clipboard otomatis.'
    );
  };

  const filteredGuests = useMemo(() => {
    return guests.filter((g) => {
      const matchFilter = guestFilter === 'all' || g.rsvp_status === guestFilter;
      const q = guestSearch.trim().toLowerCase();
      const matchSearch =
        !q ||
        g.name.toLowerCase().includes(q) ||
        g.group_name.toLowerCase().includes(q) ||
        g.phone.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [guests, guestFilter, guestSearch]);

  // Auth Gate Screen (Portal Mempelai — visually distinct dark slate studio)
  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-6">
        <p className="text-sm text-slate-300">Memeriksa akses Portal Mempelai...</p>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col items-center justify-center p-5">
        <div className="w-full max-w-md bg-[#1E293B] border border-slate-700 rounded-xl p-6 sm:p-8 shadow-xl">
          <div className="flex items-center justify-between mb-6">
            <button
              type="button"
              onClick={onBackToInvitation}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Tampilan Tamu</span>
            </button>
            <Lock className="w-4 h-4 text-emerald-400" />
          </div>

          <p className="text-xs uppercase tracking-[0.18em] text-emerald-400 font-medium mb-1.5">
            Portal Mempelai
          </p>
          <h1 className="text-2xl font-semibold text-white mb-2">
            {needsClaim ? 'Atur Kata Sandi Mempelai' : 'Masuk Studio Manajemen'}
          </h1>
          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            {needsClaim
              ? 'Buat kata sandi pertama untuk mengelola tamu undangan, statistik kehadiran, galeri foto, peta, musik latar, dan Google Sheets.'
              : 'Khusus kedua mempelai / pengelola acara untuk memperbarui konten undangan dan memantau kehadiran tamu.'}
          </p>

          <form onSubmit={handleAdminAuthSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-200 mb-1.5">
                Kata Sandi Mempelai
              </label>
              <input
                type="password"
                required
                minLength={needsClaim ? 6 : 1}
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={needsClaim ? 'Minimal 6 karakter' : 'Masukkan kata sandi'}
                className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#0F172A] border border-slate-600 text-white rounded-lg text-sm focus:outline-none focus:border-emerald-400"
              />
            </div>

            {needsClaim && (
              <div>
                <label className="block text-xs font-medium text-slate-200 mb-1.5">
                  Konfirmasi Kata Sandi
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmPasswordInput}
                  onChange={(e) => setConfirmPasswordInput(e.target.value)}
                  placeholder="Ulangi kata sandi"
                  className="w-full min-h-[44px] px-3.5 py-2.5 bg-[#0F172A] border border-slate-600 text-white rounded-lg text-sm focus:outline-none focus:border-emerald-400"
                />
              </div>
            )}

            {authError && (
              <p className="text-xs font-medium text-red-200 bg-red-950/60 border border-red-800 p-3 rounded-lg">
                {authError}
              </p>
            )}

            {!needsClaim && envConfigured && (
              <p className="text-[11px] text-slate-400">
                Gunakan kata sandi yang diatur pada <code className="text-slate-200">ADMIN_PASSCODE</code> di pengaturan Secrets server.
              </p>
            )}

            <button
              type="submit"
              disabled={authSubmitting}
              className="w-full min-h-[44px] py-2.5 px-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
            >
              {authSubmitting
                ? 'Memproses...'
                : needsClaim
                ? 'Simpan & Buka Portal Mempelai'
                : 'Masuk Portal Mempelai'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const navItems: {
    id: AdminTab;
    label: string;
    desc: string;
    icon: React.ReactNode;
    badge?: string | number;
  }[] = [
    {
      id: 'overview',
      label: 'Statistik',
      desc: 'Ringkasan kehadiran & estimasi pax',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'guests',
      label: 'Tamu & Tautan',
      desc: 'Daftar tamu, link personal & teks WA',
      icon: <Users className="w-4 h-4" />,
      badge: guests.length > 0 ? guests.length : undefined,
    },
    {
      id: 'gifts',
      label: 'Kirim Hadiah',
      desc: 'Rekening bank, e-wallet & kado fisik',
      icon: <Gift className="w-4 h-4" />,
      badge: gifts.length > 0 ? gifts.length : undefined,
    },
    {
      id: 'sheets',
      label: 'Google Sheets',
      desc: 'Sinkronisasi cloud otomatis realtime',
      icon: <FileSpreadsheet className="w-4 h-4" />,
    },
    {
      id: 'content',
      label: 'Konten & Acara',
      desc: 'Nama mempelai, foto & jadwal acara',
      icon: <Pencil className="w-4 h-4" />,
    },
    {
      id: 'gallery',
      label: 'Galeri Foto',
      desc: 'Foto momen prewed & kenangan',
      icon: <ImageIcon className="w-4 h-4" />,
      badge: gallery.length > 0 ? gallery.length : undefined,
    },
    {
      id: 'map_music',
      label: 'Peta & Musik',
      desc: 'Alamat, peta lokasi & audio latar',
      icon: <MapPin className="w-4 h-4" />,
    },
    {
      id: 'guestbook',
      label: 'Buku Tamu',
      desc: 'Pantau & moderasi ucapan doa restu',
      icon: <MessageSquare className="w-4 h-4" />,
      badge: guestbook.length > 0 ? guestbook.length : undefined,
    },
  ];

  const attendanceRate =
    stats.total_invited > 0
      ? Math.round((stats.attending_count / stats.total_invited) * 100)
      : 0;

  return (
    <div className="min-h-screen bg-[#F1F5F9] text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar (Dark Slate Executive Studio for Mempelai) */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-[#0F172A] text-slate-100 shrink-0">
        <div className="h-14 px-5 border-b border-slate-800 flex items-center justify-between">
          <span className="text-sm font-semibold tracking-wide text-white truncate">
            Portal Mempelai
          </span>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                activeTab === item.id
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-800 space-y-2">
          <button
            type="button"
            onClick={onBackToInvitation}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Pratinjau Tampilan Tamu</span>
          </button>
          <button
            type="button"
            onClick={() => setAuthToken(null)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-300 hover:bg-red-950/60 rounded-lg cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Keluar Portal</span>
          </button>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop Top Header (lg only) */}
        <header className="hidden lg:flex h-14 bg-white border-b border-slate-200 px-6 items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span>Portal Mempelai</span>
            <span aria-hidden="true" className="text-slate-300">/</span>
            <strong className="text-slate-900 font-semibold">
              {navItems.find((n) => n.id === activeTab)?.label}
            </strong>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                exportGuestsToExcel(
                  guests,
                  stats,
                  settings?.couple_title || 'Pernikahan',
                  window.location.origin
                )
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <Download className="w-3.5 h-3.5 text-[#1F4E3D]" />
              <span>Excel</span>
            </button>
            <button
              type="button"
              onClick={() =>
                exportGuestsToPDF(guests, stats, settings?.couple_title || 'Pernikahan')
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-lg cursor-pointer whitespace-nowrap shadow-2xs"
            >
              <FileText className="w-3.5 h-3.5 text-red-700" />
              <span>PDF</span>
            </button>
          </div>
        </header>

        {/* Unified Premium Mobile Top Bar (Mobile / Tablet) */}
        <header className="lg:hidden sticky top-0 z-40 bg-[#0F172A] border-b border-slate-800 text-slate-100 shadow-md">
          {/* Row 1: Brand & Actions */}
          <div className="h-14 px-3.5 sm:px-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 shrink-0">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 animate-pulse ring-2 ring-[#0F172A]" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-wider text-emerald-400 uppercase leading-none mb-0.5">
                  Portal Mempelai
                </p>
                <p className="text-xs font-semibold text-white truncate max-w-[130px] sm:max-w-[200px] leading-tight">
                  {settings?.couple_title || 'Niskala Studio'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onBackToInvitation}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:text-white bg-emerald-950/50 hover:bg-emerald-900/60 border border-emerald-800/70 rounded-lg cursor-pointer transition-all active:scale-95 shadow-2xs"
                title="Buka Pratinjau Tampilan Undangan Tamu"
              >
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[11px] font-semibold">Tamu</span>
              </button>

              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:text-white bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 rounded-lg cursor-pointer transition-all active:scale-95 shadow-2xs"
                title="Buka Menu Manajemen"
                aria-label="Buka Menu Navigasi"
              >
                <Menu className="w-3.5 h-3.5 text-slate-300" />
                <span className="text-[11px]">Menu</span>
              </button>

              <button
                type="button"
                onClick={() => setAuthToken(null)}
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-950/40 rounded-lg cursor-pointer transition-colors"
                title="Keluar Portal Mempelai"
                aria-label="Keluar Portal"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Row 2: Fluid Horizontal Scroll Carousel with Fade Edges */}
          <div className="relative border-t border-slate-800/80 bg-[#0B1120] py-2">
            {/* Scroll Indicator Gradient Fades */}
            <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-3 bg-gradient-to-r from-[#0B1120] to-transparent z-10" />
            <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-3 bg-gradient-to-l from-[#0B1120] to-transparent z-10" />

            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] px-3">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    ref={(el) => {
                      mobileTabRefs.current[item.id] = el;
                    }}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-all ${
                      isActive
                        ? 'bg-emerald-600 text-white font-semibold shadow-xs ring-1 ring-emerald-400/50 scale-[1.02]'
                        : 'text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                    {item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                          isActive
                            ? 'bg-emerald-800/90 text-white'
                            : 'bg-slate-700 text-slate-300'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Active Tab Context Strip */}
          <div className="border-t border-slate-800/60 bg-[#0B1120]/75 px-3.5 py-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span className="truncate max-w-[240px] sm:max-w-md">
              {navItems.find((n) => n.id === activeTab)?.desc}
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="text-emerald-400 hover:underline shrink-0 font-medium ml-2 cursor-pointer"
            >
              8 Menu &rarr;
            </button>
          </div>
        </header>

        {/* Mobile Navigation Drawer / Sheet */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex flex-col justify-end lg:hidden animate-in fade-in duration-200"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className="bg-[#0F172A] border-t border-slate-800 rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Handle Bar */}
              <div className="w-12 h-1 bg-slate-700 rounded-full mx-auto" />

              <div className="flex items-center justify-between pt-1">
                <div>
                  <h3 className="text-base font-semibold text-white">Menu Portal Mempelai</h3>
                  <p className="text-xs text-slate-400">Pilih menu manajemen yang ingin dibuka</p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 text-slate-400 hover:text-white bg-slate-800 rounded-lg cursor-pointer"
                  aria-label="Tutup Menu"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Grid of All 8 Tabs */}
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                {navItems.map((item) => {
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setActiveTab(item.id);
                        setMobileMenuOpen(false);
                      }}
                      className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        isActive
                          ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-xs'
                          : 'bg-slate-800/60 hover:bg-slate-800 border-slate-700/70 text-slate-300 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`p-1.5 rounded-lg ${
                            isActive ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {item.icon}
                        </span>
                        {item.badge !== undefined && (
                          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-slate-700 text-slate-200">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-xs font-semibold mt-1 text-white truncate w-full">
                        {item.label}
                      </span>
                      <span className="text-[10px] text-slate-400 line-clamp-1 leading-tight">
                        {item.desc}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Quick Actions in Mobile Drawer */}
              <div className="pt-3 border-t border-slate-800 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      exportGuestsToExcel(
                        guests,
                        stats,
                        settings?.couple_title || 'Pernikahan',
                        window.location.origin
                      );
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Ekspor Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      exportGuestsToPDF(guests, stats, settings?.couple_title || 'Pernikahan');
                      setMobileMenuOpen(false);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-red-400" />
                    <span>Ekspor PDF</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    onBackToInvitation();
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 bg-slate-800/80 hover:bg-slate-800 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span>Lihat Undangan Tamu</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setAuthToken(null);
                  }}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 text-red-300 hover:text-red-200 text-xs font-medium rounded-lg cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Keluar Portal Mempelai</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Toast notification */}
        {toast && (
          <div className="fixed bottom-5 right-5 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{toast}</span>
          </div>
        )}

        {/* Workspace Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl w-full mx-auto">
          {loadingData && !settings ? (
            <div className="py-20 text-center text-sm text-slate-500">
              Memuat data dari database SQL lokal...
            </div>
          ) : null}

          {/* TAB 1: OVERVIEW & STATISTICS */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Statistik Kehadiran & Monitor Tamu
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Data tersimpan mandiri di database SQL lokal dan terbarui secara real-time.
                </p>
              </div>

              {/* 4-column KPI Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Total Undangan</div>
                  <div className="font-mono tabular-nums text-3xl font-semibold text-slate-900 mt-2">
                    {stats.total_invited}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Tautan unik dibuat</div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Konfirmasi Hadir</div>
                  <div className="font-mono tabular-nums text-3xl font-semibold text-[#1F4E3D] mt-2">
                    {stats.attending_count}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {attendanceRate}% dari total undangan
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Estimasi Tamu (Pax)</div>
                  <div className="font-mono tabular-nums text-3xl font-semibold text-slate-900 mt-2">
                    {stats.total_pax_attending}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Total orang yang akan hadir</div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Tidak Hadir / Menunggu</div>
                  <div className="font-mono tabular-nums text-3xl font-semibold text-slate-900 mt-2">
                    {stats.not_attending_count} / {stats.pending_count}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">Berhalangan · Belum respon</div>
                </div>
              </div>

              {/* Attendance Breakdown Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Proporsi Konfirmasi Kehadiran
                  </h2>
                  <div className="flex items-center gap-4 text-xs text-slate-600">
                    <span className="font-medium text-[#1F4E3D]">
                      Hadir ({stats.attending_count})
                    </span>
                    <span className="font-medium text-red-700">
                      Tidak Hadir ({stats.not_attending_count})
                    </span>
                    <span className="font-medium text-amber-700">
                      Menunggu ({stats.pending_count})
                    </span>
                  </div>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-lg overflow-hidden flex">
                  {stats.total_invited > 0 && (
                    <>
                      <div
                        className="bg-[#1F4E3D] h-full"
                        style={{
                          width: `${(stats.attending_count / stats.total_invited) * 100}%`,
                        }}
                      />
                      <div
                        className="bg-red-600 h-full"
                        style={{
                          width: `${(stats.not_attending_count / stats.total_invited) * 100}%`,
                        }}
                      />
                      <div
                        className="bg-amber-400 h-full"
                        style={{
                          width: `${(stats.pending_count / stats.total_invited) * 100}%`,
                        }}
                      />
                    </>
                  )}
                </div>
              </div>

              {/* Quick Export & Sync Strip */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    Ekspor Laporan & Sinkronisasi Spreadsheet
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {settings?.spreadsheet_id
                      ? `Terhubung ke "${settings.spreadsheet_title || settings.spreadsheet_id}" · ${
                          stats.unsynced_count
                        } baris belum tersinkron`
                      : 'Belum terhubung ke Google Sheets. Hubungkan agar setiap pendaftar baru tersinkronisasi otomatis.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      exportGuestsToExcel(
                        guests,
                        stats,
                        settings?.couple_title || 'Pernikahan',
                        window.location.origin
                      )
                    }
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1F4E3D]" />
                    <span>Ekspor Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportGuestsToPDF(guests, stats, settings?.couple_title || 'Pernikahan')
                    }
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-red-700" />
                    <span>Ekspor PDF (.pdf)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('sheets')}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 py-2 text-xs font-medium bg-[#1F4E3D] hover:bg-[#163A2D] text-white rounded-lg cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Kelola Google Sheets</span>
                  </button>
                </div>
              </div>

              {/* Recent RSVPs */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Konfirmasi Tamu Terbaru
                  </h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('guests')}
                    className="text-xs font-medium text-[#1F4E3D] hover:underline cursor-pointer"
                  >
                    Kelola Semua Tamu
                  </button>
                </div>
                <div className="divide-y divide-slate-100">
                  {guests.slice(0, 5).map((g) => (
                    <div
                      key={g.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-4 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{g.name}</div>
                        <div className="text-xs text-slate-500">
                          {g.group_name} <span aria-hidden="true">·</span>{' '}
                          <span className="font-mono tabular-nums">{g.pax_count} pax</span>
                        </div>
                      </div>
                      <span className={`text-xs shrink-0 ${statusColorClass(g.rsvp_status)}`}>
                        {statusText(g.rsvp_status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: GUESTS & UNIQUE LINKS */}
          {activeTab === 'guests' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Kelola Nama Tamu & Tautan Unik
                  </h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Tambahkan tamu, bagikan tautan personal, atau ekspor laporan Excel dan PDF.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      exportGuestsToExcel(
                        guests,
                        stats,
                        settings?.couple_title || 'Pernikahan',
                        window.location.origin
                      )
                    }
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-[#1F4E3D]" />
                    <span>Ekspor Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportGuestsToPDF(guests, stats, settings?.couple_title || 'Pernikahan')
                    }
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 text-xs font-medium bg-white border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-red-700" />
                    <span>Ekspor PDF</span>
                  </button>
                </div>
              </div>

              {/* Add Guest Form */}
              <form
                onSubmit={handleAddGuest}
                className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
              >
                <div className="sm:col-span-5">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Tamu Undangan
                  </label>
                  <input
                    type="text"
                    required
                    value={newGuestName}
                    onChange={(e) => setNewGuestName(e.target.value)}
                    placeholder="Contoh: Bapak Hendra & Ibu Sari"
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Kategori / Grup
                  </label>
                  <select
                    value={newGuestGroup}
                    onChange={(e) => setNewGuestGroup(e.target.value)}
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                  >
                    <option value="Keluarga">Keluarga</option>
                    <option value="Sahabat">Sahabat</option>
                    <option value="Rekan Kerja">Rekan Kerja</option>
                    <option value="VIP">VIP</option>
                    <option value="Tamu Umum">Tamu Umum</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    No. WhatsApp
                  </label>
                  <input
                    type="tel"
                    value={newGuestPhone}
                    onChange={(e) => setNewGuestPhone(e.target.value)}
                    placeholder="0812..."
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    className="w-full min-h-[42px] inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Tambah Tamu</span>
                  </button>
                </div>
              </form>

              {/* Search & Segmented Filter — Fits 100% on Mobile with Zero Slide */}
              <div className="flex flex-col sm:flex-row gap-2 justify-between sm:items-center">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={guestSearch}
                    onChange={(e) => setGuestSearch(e.target.value)}
                    placeholder="Cari nama tamu, grup, atau HP..."
                    className="w-full min-h-[34px] pl-8 pr-2.5 py-1 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:border-[#1F4E3D]"
                  />
                </div>

                <div className="grid grid-cols-4 gap-1 p-0.5 bg-slate-200/80 rounded-lg w-full sm:w-auto">
                  {(
                    [
                      { id: 'all', label: `Semua (${guests.length})` },
                      { id: 'attending', label: `Hadir (${stats.attending_count})` },
                      { id: 'not_attending', label: `Batal (${stats.not_attending_count})` },
                      { id: 'pending', label: `Menunggu (${stats.pending_count})` },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setGuestFilter(tab.id)}
                      className={`w-full text-center py-1 px-1 text-[10px] sm:text-[11px] font-medium rounded-md truncate cursor-pointer transition-all ${
                        guestFilter === tab.id
                          ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Guest Table — 100% Width table-fixed, Zero Sliding, Fits Mobile Phone */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs w-full">
                <table className="w-full table-fixed border-collapse text-xs">
                  <colgroup>
                    <col className="w-[36%]" />
                    <col className="w-[16%]" />
                    <col className="w-[20%]" />
                    <col className="w-[8%]" />
                    <col className="w-[20%]" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/90 text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-2 px-1.5 sm:px-3 text-left">Nama Tamu</th>
                      <th className="py-2 px-1 sm:px-2 text-left">Grup</th>
                      <th className="py-2 px-1 sm:px-2 text-center">Status</th>
                      <th className="py-2 px-0.5 sm:px-2 text-center">Pax</th>
                      <th className="py-2 px-1 sm:px-2 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredGuests.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                          Belum ada data tamu yang cocok dengan filter.
                        </td>
                      </tr>
                    ) : (
                      filteredGuests.map((guest) => (
                        <tr key={guest.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-1.5 px-1.5 sm:px-3 align-middle overflow-hidden">
                            <div
                              className="font-semibold text-slate-900 text-[11px] sm:text-xs leading-tight truncate"
                              title={guest.name}
                            >
                              {guest.name}
                            </div>
                            <div className="text-[9px] sm:text-[10px] text-slate-400 font-mono truncate mt-0.5">
                              {guest.phone || `?tamu=${guest.slug}`}
                            </div>
                          </td>
                          <td className="py-1.5 px-1 sm:px-2 align-middle overflow-hidden">
                            <span className="inline-block px-1 py-0.5 rounded bg-slate-100 text-slate-600 text-[9px] sm:text-[10px] font-medium truncate max-w-full">
                              {guest.group_name}
                            </span>
                          </td>
                          <td className="py-1.5 px-1 sm:px-2 align-middle overflow-hidden text-center">
                            <span
                              className={`inline-block px-1 py-0.5 rounded text-[9px] sm:text-[10px] font-semibold truncate max-w-full leading-none ${
                                guest.rsvp_status === 'attending'
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200/60'
                                  : guest.rsvp_status === 'not_attending'
                                  ? 'bg-red-50 text-red-700 border border-red-200/60'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200/60'
                              }`}
                            >
                              {guest.rsvp_status === 'attending'
                                ? 'Hadir'
                                : guest.rsvp_status === 'not_attending'
                                ? 'Batal'
                                : 'Menunggu'}
                            </span>
                          </td>
                          <td className="py-1.5 px-0.5 sm:px-2 align-middle text-center font-mono tabular-nums text-[10px] sm:text-xs font-semibold text-slate-700">
                            {guest.rsvp_status === 'attending' ? guest.pax_count : '-'}
                          </td>
                          <td className="py-1.5 px-1 sm:px-2 align-middle overflow-hidden">
                            <div className="flex items-center justify-end gap-0.5">
                              <button
                                type="button"
                                onClick={() => handleCopyLink(guest)}
                                title="Salin Tautan Unik"
                                className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded cursor-pointer transition-colors"
                              >
                                {copiedSlug === guest.slug ? (
                                  <Check className="w-3 h-3 text-[#1F4E3D]" />
                                ) : (
                                  <Link2 className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => handleCopyWhatsAppMessage(guest)}
                                title="Salin Teks Undangan WA"
                                className="p-1 text-[#1F4E3D] hover:bg-emerald-50 rounded cursor-pointer transition-colors"
                              >
                                <Share2 className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingGuest({ ...guest })}
                                title="Ubah Tamu"
                                className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded cursor-pointer transition-colors"
                              >
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    kind: 'guest',
                                    id: guest.id,
                                    label: guest.name,
                                  })
                                }
                                title="Hapus Tamu"
                                className="p-1 text-red-500 hover:bg-red-50 rounded cursor-pointer transition-colors"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: GOOGLE SHEETS SYNC */}
          {activeTab === 'sheets' && (
            <div className="space-y-6 max-w-3xl">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Sinkronisasi Otomatis Google Sheets
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Seluruh data tamu tersimpan aman di database SQL lokal dan otomatis dikirim ke Google Sheets Anda setiap ada tamu baru mendaftar atau mengonfirmasi kehadiran.
                </p>
              </div>

              {/* Google Account Connection Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-900">
                      1. Hubungkan Akun Google Anda
                    </h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {sheetsToken && googleUser
                        ? `Terhubung sebagai ${googleUser.email || googleUser.displayName}`
                        : 'Masuk dengan Google untuk memberi izin membaca & menulis ke Google Sheets Anda.'}
                    </p>
                  </div>

                  {sheetsToken && googleUser ? (
                    <button
                      type="button"
                      onClick={() => googleSignOut()}
                      className="px-4 py-2 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer shrink-0"
                    >
                      Putuskan Akun Google
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={sheetsBusy}
                      onClick={handleGoogleSignIn}
                      className="gsi-material-button inline-flex items-center gap-3 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg text-sm font-medium text-slate-800 cursor-pointer shrink-0 shadow-xs"
                    >
                      <span className="w-4 h-4 block">
                        <svg viewBox="0 0 48 48" className="w-full h-full">
                          <path
                            fill="#EA4335"
                            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                          />
                          <path
                            fill="#4285F4"
                            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                          />
                          <path
                            fill="#FBBC05"
                            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                          />
                          <path
                            fill="#34A853"
                            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                          />
                        </svg>
                      </span>
                      <span>Sign in with Google</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Spreadsheet Selection & Auto-Sync */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">
                    2. Pilih atau Buat Spreadsheet Tujuan
                  </h2>
                  <p className="text-xs text-slate-500 mt-1">
                    Anda dapat membuat Google Spreadsheet baru secara instan atau menempelkan URL / ID spreadsheet yang sudah ada.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={!sheetsToken || sheetsBusy}
                    onClick={handleCreateNewSheet}
                    className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Buat Spreadsheet Baru Otomatis</span>
                  </button>

                  {settings?.spreadsheet_id && (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${settings.spreadsheet_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 min-h-[42px] px-4 py-2 border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-800 rounded-lg"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Buka di Google Sheets</span>
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end pt-2 border-t border-slate-100">
                  <div className="sm:col-span-8">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      URL atau ID Google Spreadsheet
                    </label>
                    <input
                      type="text"
                      value={sheetInputId}
                      onChange={(e) => setSheetInputId(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:border-[#1F4E3D]"
                    />
                  </div>
                  <div className="sm:col-span-4">
                    <button
                      type="button"
                      disabled={!sheetsToken || sheetsBusy || !sheetInputId.trim()}
                      onClick={handleConnectExistingSheet}
                      className="w-full min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                    >
                      Hubungkan Spreadsheet
                    </button>
                  </div>
                </div>

                {draftSettings && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Nama Tab / Sheet
                      </label>
                      {availableTabs.length > 0 ? (
                        <select
                          value={draftSettings.sheet_name}
                          onChange={(e) => {
                            const updated = { ...draftSettings, sheet_name: e.target.value };
                            setDraftSettings(updated);
                            void handleSaveSettings({ sheet_name: e.target.value });
                          }}
                          className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        >
                          {availableTabs.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={draftSettings.sheet_name}
                          onChange={(e) =>
                            setDraftSettings({ ...draftSettings, sheet_name: e.target.value })
                          }
                          className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                        />
                      )}
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2.5 min-h-[42px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(draftSettings.auto_sync_sheets)}
                          onChange={(e) => {
                            const val = e.target.checked ? 1 : 0;
                            setDraftSettings({ ...draftSettings, auto_sync_sheets: val });
                            void handleSaveSettings({ auto_sync_sheets: val });
                          }}
                          className="w-4 h-4 accent-[#1F4E3D]"
                        />
                        <span className="text-xs font-medium text-slate-800">
                          Sinkronisasi Otomatis Setiap Tamu Baru Mendaftar
                        </span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs text-slate-600">
                    {sheetsStatusMsg ? (
                      <span>{sheetsStatusMsg}</span>
                    ) : settings?.last_synced_at ? (
                      <span>
                        Terakhir sinkron:{' '}
                        {formatSafeDateTime(settings.last_synced_at)}
                      </span>
                    ) : (
                      <span>Belum pernah disinkronkan.</span>
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!sheetsToken || !settings?.spreadsheet_id || sheetsBusy}
                    onClick={() => setConfirmSyncModal(true)}
                    className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${sheetsBusy ? 'animate-spin' : ''}`} />
                    <span>Sinkronkan Sekarang ({guests.length} Tamu)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CONTENT & COUPLE DETAILS */}
          {activeTab === 'content' && draftSettings && (
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Konten Undangan & Mempelai
                  </h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Ubah nama pasangan, foto sampul & mempelai, kutipan, dan jadwal acara.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingSettings}
                  onClick={() => handleSaveSettings()}
                  className="min-h-[42px] px-5 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {savingSettings ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-5">
                <h2 className="text-sm font-semibold text-slate-900 border-b border-slate-100 pb-3">
                  Identitas & Foto Utama
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Judul Pasangan (Tampil di Sampul)
                    </label>
                    <input
                      type="text"
                      value={draftSettings.couple_title}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, couple_title: e.target.value })
                      }
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Foto Sampul Utama (URL atau Unggah)
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draftSettings.hero_image}
                        onChange={(e) =>
                          setDraftSettings({ ...draftSettings, hero_image: e.target.value })
                        }
                        className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                      <label className="inline-flex items-center gap-1.5 px-3 min-h-[42px] bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-lg cursor-pointer shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Unggah</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await handleUploadFile(f);
                            if (url) setDraftSettings({ ...draftSettings, hero_image: url });
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Bride & Groom */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-3 border-t border-slate-100">
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Mempelai Wanita
                    </h3>
                    <input
                      type="text"
                      value={draftSettings.bride_name}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, bride_name: e.target.value })
                      }
                      placeholder="Nama Lengkap Mempelai Wanita"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.bride_parents}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, bride_parents: e.target.value })
                      }
                      placeholder="Keterangan Orang Tua"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draftSettings.bride_photo}
                        onChange={(e) =>
                          setDraftSettings({ ...draftSettings, bride_photo: e.target.value })
                        }
                        placeholder="URL Foto Mempelai Wanita"
                        className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                      <label className="inline-flex items-center px-3 min-h-[42px] bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-lg cursor-pointer shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await handleUploadFile(f);
                            if (url) setDraftSettings({ ...draftSettings, bride_photo: url });
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Mempelai Pria
                    </h3>
                    <input
                      type="text"
                      value={draftSettings.groom_name}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, groom_name: e.target.value })
                      }
                      placeholder="Nama Lengkap Mempelai Pria"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.groom_parents}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, groom_parents: e.target.value })
                      }
                      placeholder="Keterangan Orang Tua"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={draftSettings.groom_photo}
                        onChange={(e) =>
                          setDraftSettings({ ...draftSettings, groom_photo: e.target.value })
                        }
                        placeholder="URL Foto Mempelai Pria"
                        className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                      <label className="inline-flex items-center px-3 min-h-[42px] bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-lg cursor-pointer shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await handleUploadFile(f);
                            if (url) setDraftSettings({ ...draftSettings, groom_photo: url });
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {/* Quote */}
                <div className="space-y-3 pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-700">
                    Kutipan / Doa Pembuka
                  </label>
                  <textarea
                    rows={2}
                    value={draftSettings.opening_quote}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, opening_quote: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <input
                    type="text"
                    value={draftSettings.quote_source}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, quote_source: e.target.value })
                    }
                    placeholder="Sumber Kutipan (Misal: QS. Ar-Rum: 21)"
                    className="w-full max-w-xs min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>

                {/* Schedule */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-3 border-t border-slate-100">
                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Jadwal Akad Nikah
                    </h3>
                    <input
                      type="text"
                      value={draftSettings.akad_date_label}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, akad_date_label: e.target.value })
                      }
                      placeholder="Hari & Tanggal"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.akad_time}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, akad_time: e.target.value })
                      }
                      placeholder="Waktu (08:00 - 10:00 WIB)"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.akad_venue}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, akad_venue: e.target.value })
                      }
                      placeholder="Lokasi Akad"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Jadwal Resepsi
                    </h3>
                    <input
                      type="text"
                      value={draftSettings.resepsi_date_label}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, resepsi_date_label: e.target.value })
                      }
                      placeholder="Hari & Tanggal"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.resepsi_time}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, resepsi_time: e.target.value })
                      }
                      placeholder="Waktu (11:00 - 14:30 WIB)"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <input
                      type="text"
                      value={draftSettings.resepsi_venue}
                      onChange={(e) =>
                        setDraftSettings({ ...draftSettings, resepsi_venue: e.target.value })
                      }
                      placeholder="Lokasi Resepsi"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tanggal & Waktu Hitung Mundur (ISO Format)
                  </label>
                  <input
                    type="text"
                    value={draftSettings.event_date_iso}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, event_date_iso: e.target.value })
                    }
                    placeholder="2026-12-12T08:00:00+07:00"
                    className="w-full max-w-sm min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: GALLERY */}
          {activeTab === 'gallery' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Kelola Galeri Foto
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Unggah foto dari perangkat Anda atau tambahkan melalui tautan URL.
                </p>
              </div>

              <form
                onSubmit={handleAddGalleryItem}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Judul Foto
                    </label>
                    <input
                      type="text"
                      required
                      value={newPhotoTitle}
                      onChange={(e) => setNewPhotoTitle(e.target.value)}
                      placeholder="Contoh: Momen Lamaran"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Keterangan Singkat (Opsional)
                    </label>
                    <input
                      type="text"
                      value={newPhotoCaption}
                      onChange={(e) => setNewPhotoCaption(e.target.value)}
                      placeholder="Cerita singkat di balik foto..."
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    URL Gambar atau Unggah Berkas Lokal
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      required
                      value={newPhotoUrl}
                      onChange={(e) => setNewPhotoUrl(e.target.value)}
                      placeholder="https://... atau klik Unggah Foto"
                      className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                    <label className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-lg cursor-pointer shrink-0">
                      <Upload className="w-4 h-4" />
                      <span>{uploadingFile ? 'Mengunggah...' : 'Unggah Foto'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const url = await handleUploadFile(f);
                          if (url) setNewPhotoUrl(url);
                        }}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={!newPhotoUrl.trim()}
                      className="inline-flex items-center justify-center gap-1.5 min-h-[42px] px-5 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-50 text-white text-xs font-semibold rounded-lg cursor-pointer shrink-0"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Tambah ke Galeri</span>
                    </button>
                  </div>
                </div>
              </form>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {gallery.map((item) => (
                  <div
                    key={item.id}
                    className="bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col"
                  >
                    <div className="aspect-[4/3] bg-slate-100 overflow-hidden">
                      <ResilientImage
                        src={item.image_url}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                      <div>
                        <h3 className="font-medium text-sm text-slate-900">{item.title}</h3>
                        {item.caption && (
                          <p className="text-xs text-slate-500 mt-1">{item.caption}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'gallery',
                            id: item.id,
                            label: item.title,
                          })
                        }
                        className="inline-flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus Foto</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 6: MAP & BACKGROUND MUSIC */}
          {activeTab === 'map_music' && draftSettings && (
            <div className="space-y-6 max-w-4xl">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-xl font-semibold text-slate-900">
                    Peta Lokasi & Musik Latar
                  </h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Sesuaikan koordinat atau tautan peta lokasi serta lagu latar undangan.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingSettings}
                  onClick={() => handleSaveSettings()}
                  className="min-h-[42px] px-5 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-60 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                >
                  {savingSettings ? 'Menyimpan...' : 'Simpan Pengaturan'}
                </button>
              </div>

              {/* Map Settings */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#1F4E3D]" />
                  <span>Peta Lokasi Acara</span>
                </h2>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Alamat Lengkap Lokasi
                  </label>
                  <input
                    type="text"
                    value={draftSettings.venue_address}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, venue_address: e.target.value })
                    }
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Nama gedung, jalan, dan kota lokasi acara pernikahan.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tautan Petunjuk Arah (Google Maps Link)
                  </label>
                  <input
                    type="url"
                    value={draftSettings.map_directions_url}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, map_directions_url: e.target.value })
                    }
                    placeholder="https://maps.app.goo.gl/... atau https://maps.google.com/?q=..."
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Tautan Google Maps yang akan langsung dibuka saat tamu menekan tombol "Buka Google Maps".
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    URL Embed Peta Kustom (Opsional — kosongkan untuk menggunakan peta otomatis dari koordinat)
                  </label>
                  <input
                    type="text"
                    value={draftSettings.map_embed_url}
                    onChange={(e) => {
                      let val = e.target.value;
                      const match = val.match(/src=["']([^"']+)["']/i);
                      if (match) val = match[1];
                      setDraftSettings({ ...draftSettings, map_embed_url: val });
                    }}
                    placeholder="https://www.google.com/maps/embed?pb=..."
                    className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>
              </div>

              {/* Music Settings */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 space-y-4">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  <Music className="w-4 h-4 text-[#1F4E3D]" />
                  <span>Musik Latar Undangan</span>
                </h2>

                <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg w-fit">
                  <button
                    type="button"
                    onClick={() =>
                      setDraftSettings({ ...draftSettings, music_mode: 'builtin' })
                    }
                    className={`px-3.5 py-2 text-xs font-medium rounded-md cursor-pointer ${
                      draftSettings.music_mode === 'builtin'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Piano Klasik Bawaan
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraftSettings({ ...draftSettings, music_mode: 'custom' })
                    }
                    className={`px-3.5 py-2 text-xs font-medium rounded-md cursor-pointer ${
                      draftSettings.music_mode === 'custom'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    Lagu Kustom (MP3 / URL)
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Judul Lagu yang Ditampilkan
                  </label>
                  <input
                    type="text"
                    value={draftSettings.music_title}
                    onChange={(e) =>
                      setDraftSettings({ ...draftSettings, music_title: e.target.value })
                    }
                    className="w-full max-w-md min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                  />
                </div>

                {draftSettings.music_mode === 'custom' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      URL Berkas Audio (.mp3 / .ogg / .wav) atau Unggah dari Perangkat
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={draftSettings.music_url}
                        onChange={(e) =>
                          setDraftSettings({ ...draftSettings, music_url: e.target.value })
                        }
                        placeholder="https://... atau klik Unggah Audio"
                        className="flex-1 min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                      <label className="inline-flex items-center justify-center gap-2 min-h-[42px] px-4 py-2 bg-slate-100 hover:bg-slate-200 text-xs font-medium rounded-lg cursor-pointer shrink-0">
                        <Upload className="w-4 h-4" />
                        <span>{uploadingFile ? 'Mengunggah...' : 'Unggah MP3/Audio'}</span>
                        <input
                          type="file"
                          accept="audio/*"
                          className="hidden"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const url = await handleUploadFile(f);
                            if (url) {
                              setDraftSettings({
                                ...draftSettings,
                                music_mode: 'custom',
                                music_url: url,
                                music_title: draftSettings.music_title || f.name.replace(/\.[^/.]+$/, ''),
                              });
                            }
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        weddingAudio.configure(draftSettings.music_mode, draftSettings.music_url);
                        if (!previewPlaying) {
                          await weddingAudio.play();
                          weddingAudio.setMuted(false);
                          setPreviewPlaying(true);
                          setPreviewMuted(false);
                        } else {
                          weddingAudio.stop();
                          setPreviewPlaying(false);
                        }
                      } catch {
                        showToast('Gagal memutar pratinjau audio.');
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    {previewPlaying ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                    <span>{previewPlaying ? 'Hentikan Pratinjau Audio' : 'Uji Putar Musik'}</span>
                  </button>
                  {previewPlaying && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = !previewMuted;
                        setPreviewMuted(next);
                        weddingAudio.setMuted(next);
                      }}
                      className="px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      {previewMuted ? 'Nyalakan Suara' : 'Matikan Suara'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: KIRIM HADIAH (GIFT ACCOUNTS & INCOMING CONFIRMATIONS) */}
          {activeTab === 'gifts' && (
            <div className="space-y-6">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Kelola Kirim Hadiah & Tanda Kasih
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Atur nomor rekening bank, dompet digital, alamat pengiriman kado fisik, dan pantau konfirmasi hadiah dari tamu.
                </p>
              </div>

              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Total Konfirmasi Hadiah</div>
                  <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-2">
                    {gifts.length}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Total Nominal Transfer Tercatat</div>
                  <div className="font-mono tabular-nums text-2xl font-semibold text-[#1F4E3D] mt-2">
                    Rp{' '}
                    {gifts
                      .filter((g) => g.gift_type === 'transfer')
                      .reduce((sum, g) => sum + (Number(g.amount) || 0), 0)
                      .toLocaleString('id-ID')}
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
                  <div className="text-xs font-medium text-slate-500">Kado Fisik / Paket</div>
                  <div className="font-mono tabular-nums text-2xl font-semibold text-slate-900 mt-2">
                    {gifts.filter((g) => g.gift_type === 'kado').length}
                  </div>
                </div>
              </div>

              {/* Add Gift Account Form */}
              <form
                onSubmit={handleAddGiftAccount}
                className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
              >
                <h2 className="text-sm font-semibold text-slate-900">
                  Tambah Rekening / Dompet Digital / Alamat Kado
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">Jenis</label>
                    <select
                      value={newGiftType}
                      onChange={(e) => setNewGiftType(e.target.value as GiftAccountType)}
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    >
                      <option value="bank">Transfer Bank</option>
                      <option value="ewallet">Dompet Digital</option>
                      <option value="address">Alamat Kado Fisik</option>
                    </select>
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Bank / Platform / Label
                    </label>
                    <input
                      type="text"
                      required
                      value={newGiftProvider}
                      onChange={(e) => setNewGiftProvider(e.target.value)}
                      placeholder="Contoh: Bank Mandiri"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      {newGiftType === 'address' ? 'Alamat Lengkap' : 'No. Rekening / HP'}
                    </label>
                    <input
                      type="text"
                      required
                      value={newGiftNumber}
                      onChange={(e) => setNewGiftNumber(e.target.value)}
                      placeholder={
                        newGiftType === 'address' ? 'Jl. Mawar No. 10...' : '137000...'
                      }
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Atas Nama / Penerima
                    </label>
                    <input
                      type="text"
                      required
                      value={newGiftHolder}
                      onChange={(e) => setNewGiftHolder(e.target.value)}
                      placeholder="Nama pemilik rekening"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 items-end">
                  <div className="flex-1 w-full">
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Catatan Singkat (Opsional)
                    </label>
                    <input
                      type="text"
                      value={newGiftNotes}
                      onChange={(e) => setNewGiftNotes(e.target.value)}
                      placeholder="Contoh: Cabang Jakarta / Patokan rumah pagar putih"
                      className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full sm:w-auto min-h-[42px] inline-flex items-center justify-center gap-1.5 px-5 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] text-white text-xs font-semibold rounded-lg cursor-pointer shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Simpan Tujuan Hadiah</span>
                  </button>
                </div>
              </form>

              {/* List of Gift Accounts */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {giftAccounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-1.5">
                      <span className="inline-block text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                        {acc.type === 'bank'
                          ? 'Transfer Bank'
                          : acc.type === 'ewallet'
                          ? 'Dompet Digital'
                          : 'Alamat Kado Fisik'}
                      </span>
                      <h3 className="text-base font-semibold text-slate-900">{acc.provider}</h3>
                      <p className="text-sm font-mono text-slate-800 break-words">
                        {acc.account_number}
                      </p>
                      <p className="text-xs text-slate-600">a.n. {acc.account_holder}</p>
                      {acc.notes && <p className="text-xs text-slate-400">{acc.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setEditingGiftAcc({ ...acc })}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        <span>Ubah</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'gift_account',
                            id: acc.id,
                            label: `${acc.provider} (${acc.account_holder})`,
                          })
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-red-700 border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Hapus</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Incoming Gift Confirmations Table */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h2 className="text-sm font-semibold text-slate-900">
                    Konfirmasi Hadiah Masuk dari Tamu
                  </h2>
                </div>
                {gifts.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Belum ada konfirmasi hadiah masuk dari tamu undangan.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {gifts.map((item) => (
                      <div
                        key={item.id}
                        className="p-4 sm:p-5 flex items-start justify-between gap-4"
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <span className="font-semibold text-sm text-slate-900">
                              {item.sender_name}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-emerald-700">
                              {item.gift_type === 'kado' ? 'Kado Fisik' : 'Transfer Digital'}
                            </span>
                            {item.gift_type === 'transfer' && item.amount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono font-semibold text-slate-900">
                                  Rp {Number(item.amount).toLocaleString('id-ID')}
                                </span>
                              </>
                            )}
                            <span aria-hidden="true">·</span>
                            <time className="font-mono tabular-nums">
                              {formatSafeDateTime(item.created_at)}
                            </time>
                          </div>
                          {item.target_account && (
                            <p className="text-xs text-slate-600">
                              Tujuan: <span className="font-medium">{item.target_account}</span>
                            </p>
                          )}
                          {item.message && (
                            <p className="text-sm text-slate-700 leading-relaxed">{item.message}</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDelete({
                              kind: 'gift',
                              id: item.id,
                              label: `konfirmasi hadiah dari ${item.sender_name}`,
                            })
                          }
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer shrink-0"
                          title="Hapus catatan"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: GUESTBOOK MODERATION */}
          {activeTab === 'guestbook' && (
            <div className="space-y-6 max-w-4xl">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">
                  Moderasi Buku Tamu Real-Time
                </h1>
                <p className="text-sm text-slate-500 mt-0.5">
                  Pantau dan kelola ucapan serta doa restu yang dikirimkan tamu.
                </p>
              </div>

              <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
                {guestbook.length === 0 ? (
                  <div className="p-10 text-center text-sm text-slate-500">
                    Belum ada ucapan di buku tamu.
                  </div>
                ) : (
                  guestbook.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-4 sm:p-5 flex items-start justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-semibold text-sm text-slate-900">
                            {entry.sender_name}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{statusText(entry.attendance_status)}</span>
                          <span aria-hidden="true">·</span>
                          <time className="font-mono tabular-nums">
                            {formatSafeDateTime(entry.created_at)}
                          </time>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">{entry.message}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            kind: 'guestbook',
                            id: entry.id,
                            label: `ucapan dari ${entry.sender_name}`,
                          })
                        }
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer shrink-0"
                        title="Hapus ucapan"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Edit Gift Account Modal */}
      {editingGiftAcc && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdateGiftAccount}
            className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Ubah Tujuan Hadiah</h3>
              <button
                type="button"
                onClick={() => setEditingGiftAcc(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Jenis</label>
              <select
                value={editingGiftAcc.type}
                onChange={(e) =>
                  setEditingGiftAcc({
                    ...editingGiftAcc,
                    type: e.target.value as GiftAccountType,
                  })
                }
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                <option value="bank">Transfer Bank</option>
                <option value="ewallet">Dompet Digital</option>
                <option value="address">Alamat Kado Fisik</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bank / Platform / Label
              </label>
              <input
                type="text"
                required
                value={editingGiftAcc.provider}
                onChange={(e) =>
                  setEditingGiftAcc({ ...editingGiftAcc, provider: e.target.value })
                }
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nomor Rekening / HP / Alamat Lengkap
              </label>
              <input
                type="text"
                required
                value={editingGiftAcc.account_number}
                onChange={(e) =>
                  setEditingGiftAcc({ ...editingGiftAcc, account_number: e.target.value })
                }
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Atas Nama / Penerima
              </label>
              <input
                type="text"
                required
                value={editingGiftAcc.account_holder}
                onChange={(e) =>
                  setEditingGiftAcc({ ...editingGiftAcc, account_holder: e.target.value })
                }
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Catatan</label>
              <input
                type="text"
                value={editingGiftAcc.notes}
                onChange={(e) => setEditingGiftAcc({ ...editingGiftAcc, notes: e.target.value })}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingGiftAcc(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-[#1F4E3D] text-white rounded-lg hover:bg-[#163A2D] cursor-pointer"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Guest Modal */}
      {editingGuest && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleUpdateGuest}
            className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">Ubah Data Tamu</h3>
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Nama Tamu</label>
              <input
                type="text"
                required
                value={editingGuest.name}
                onChange={(e) => setEditingGuest({ ...editingGuest, name: e.target.value })}
                className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Grup</label>
                <input
                  type="text"
                  value={editingGuest.group_name}
                  onChange={(e) =>
                    setEditingGuest({ ...editingGuest, group_name: e.target.value })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">No. HP/WA</label>
                <input
                  type="text"
                  value={editingGuest.phone}
                  onChange={(e) => setEditingGuest({ ...editingGuest, phone: e.target.value })}
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Status Kehadiran
                </label>
                <select
                  value={editingGuest.rsvp_status}
                  onChange={(e) => {
                    const nextStatus = e.target.value as RsvpStatus;
                    setEditingGuest({
                      ...editingGuest,
                      rsvp_status: nextStatus,
                      pax_count:
                        nextStatus === 'attending'
                          ? Math.max(1, editingGuest.pax_count || 1)
                          : 0,
                    });
                  }}
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm"
                >
                  <option value="pending">Belum Konfirmasi</option>
                  <option value="attending">Hadir</option>
                  <option value="not_attending">Tidak Hadir</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Jumlah Pax
                </label>
                <input
                  type="number"
                  min={editingGuest.rsvp_status === 'attending' ? 1 : 0}
                  max={10}
                  disabled={editingGuest.rsvp_status !== 'attending'}
                  value={editingGuest.rsvp_status === 'attending' ? editingGuest.pax_count : 0}
                  onChange={(e) =>
                    setEditingGuest({
                      ...editingGuest,
                      pax_count: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                    })
                  }
                  className="w-full min-h-[42px] px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingGuest(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-[#1F4E3D] text-white rounded-lg hover:bg-[#163A2D] cursor-pointer"
              >
                Simpan Perubahan
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-sm w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Konfirmasi Hapus</h3>
            <p className="text-sm text-slate-600">
              Apakah Anda yakin ingin menghapus <strong>{confirmDelete.label}</strong>? Tindakan ini tidak dapat dibatalkan.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleExecuteDelete}
                className="px-4 py-2 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 cursor-pointer"
              >
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Google Sheets Overwrite Sync Modal (Mandatory Workspace confirmation) */}
      {confirmSyncModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">
              Konfirmasi Pembaruan Google Sheets
            </h3>
            <p className="text-sm text-slate-600 leading-relaxed">
              Aplikasi akan memperbarui isi tab{' '}
              <strong>{draftSettings?.sheet_name || settings?.sheet_name || 'Data Tamu'}</strong>{' '}
              pada spreadsheet{' '}
              <strong>{settings?.spreadsheet_title || settings?.spreadsheet_id}</strong> dengan{' '}
              <strong>{guests.length} baris data tamu</strong> dan ringkasan statistik terbaru.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmSyncModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmManualSync}
                className="px-4 py-2 text-xs font-semibold bg-[#1F4E3D] text-white rounded-lg hover:bg-[#163A2D] cursor-pointer"
              >
                Konfirmasi & Sinkronkan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
