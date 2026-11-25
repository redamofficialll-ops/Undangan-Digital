import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Calendar,
  CalendarHeart,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Gift,
  Heart,
  Image as ImageIcon,
  Lock,
  MailOpen,
  MapPin,
  MessageSquareHeart,
  Music,
  Package,
  Send,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from 'lucide-react';
import {
  GiftAccount,
  GiftType,
  Guest,
  GuestbookEntry,
  GuestStats,
  GalleryItem,
  RsvpStatus,
  WeddingSettings,
} from '../types';
import { ResilientImage } from './ResilientImage';
import { downloadCalendarIcs } from '../services/exportData';
import { weddingAudio } from '../services/audioEngine';

type InvitationSection = 'mempelai' | 'acara' | 'lokasi' | 'galeri' | 'hadiah' | 'rsvp';

interface InvitationPageProps {
  settings: WeddingSettings;
  gallery: GalleryItem[];
  guestbook: GuestbookEntry[];
  giftAccounts: GiftAccount[];
  stats: GuestStats;
  initialGuest: Guest | null;
  adHocGuestName: string;
  onRsvpSuccess: (guest: Guest, stats: GuestStats) => void;
  onWishCreated: (entry: GuestbookEntry) => void;
  onOpenAdmin: () => void;
}

function getSafeMapEmbedUrl(settings: WeddingSettings): string {
  const custom = settings.map_embed_url?.trim();
  if (custom) {
    const iframeMatch = custom.match(/src=["']([^"']+)["']/i);
    const candidate = iframeMatch ? iframeMatch[1] : custom;
    try {
      const u = new URL(candidate);
      if (
        u.protocol === 'https:' &&
        (u.pathname.includes('/embed') || u.hostname.includes('openstreetmap.org'))
      ) {
        return candidate;
      }
    } catch {
      // fall through to OSM
    }
  }
  const rawLat = Number(settings.map_lat);
  const rawLng = Number(settings.map_lng);
  const lat = Number.isFinite(rawLat) ? rawLat : -6.1994;
  const lng = Number.isFinite(rawLng) ? rawLng : 106.8326;
  const delta = 0.008;
  const bbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat},${lng}`;
}

function getSafeExternalUrl(
  url: string,
  lat: number,
  lng: number,
  address?: string
): string {
  const trimmed = url?.trim();
  if (trimmed) {
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'https:' || u.protocol === 'http:') return trimmed;
    } catch {
      // fallback
    }
  }
  if (address?.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address.trim())}`;
  }
  const safeLat = Number.isFinite(Number(lat)) ? Number(lat) : -6.1994;
  const safeLng = Number.isFinite(Number(lng)) ? Number(lng) : 106.8326;
  return `https://www.google.com/maps/search/?api=1&query=${safeLat},${safeLng}`;
}

function formatStatusLabel(status: RsvpStatus): string {
  if (status === 'attending') return 'Hadir';
  if (status === 'not_attending') return 'Berhalangan';
  return 'Menunggu';
}

function formatSafeDate(value: string): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InvitationPage({
  settings,
  gallery,
  guestbook,
  giftAccounts,
  stats: _stats,
  initialGuest,
  adHocGuestName,
  onRsvpSuccess,
  onWishCreated,
  onOpenAdmin,
}: InvitationPageProps) {
  const [opened, setOpened] = useState(false);
  const [activeSection, setActiveSection] = useState<InvitationSection>('mempelai');
  const tapCountRef = useRef(0);
  const tapResetRef = useRef<number | null>(null);

  const handleSecretCoupleTap = () => {
    if (!onOpenAdmin) return;
    tapCountRef.current += 1;
    if (tapResetRef.current !== null) window.clearTimeout(tapResetRef.current);
    if (tapCountRef.current >= 3) {
      tapCountRef.current = 0;
      onOpenAdmin();
      return;
    }
    tapResetRef.current = window.setTimeout(() => {
      tapCountRef.current = 0;
    }, 1000);
  };
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [lightboxItem, setLightboxItem] = useState<GalleryItem | null>(null);

  // Countdown state
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, mins: 0, secs: 0 });

  // RSVP & Guestbook Form state
  const displayGuestName = initialGuest?.name || adHocGuestName || '';
  const [guestName, setGuestName] = useState(displayGuestName);
  const [phone, setPhone] = useState(initialGuest?.phone || '');
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus>(
    initialGuest?.rsvp_status && initialGuest.rsvp_status !== 'pending'
      ? initialGuest.rsvp_status
      : 'attending'
  );
  const [paxCount, setPaxCount] = useState(initialGuest?.pax_count || 1);
  const [notes, setNotes] = useState(initialGuest?.notes || '');
  const [wishMessage, setWishMessage] = useState('');
  const [submittingRsvp, setSubmittingRsvp] = useState(false);
  const [rsvpFeedback, setRsvpFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Separate quick wish form
  const [quickWishName, setQuickWishName] = useState(displayGuestName);
  const [quickWishMsg, setQuickWishMsg] = useState('');
  const [submittingWish, setSubmittingWish] = useState(false);
  const [wishFeedback, setWishFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Kirim Hadiah state
  const [copiedGiftId, setCopiedGiftId] = useState<number | null>(null);
  const [showGiftForm, setShowGiftForm] = useState(false);
  const [giftSenderName, setGiftSenderName] = useState(displayGuestName);
  const [giftType, setGiftType] = useState<GiftType>('transfer');
  const [giftTargetAccount, setGiftTargetAccount] = useState('');
  const [giftAmount, setGiftAmount] = useState('');
  const [giftMessage, setGiftMessage] = useState('');
  const [submittingGift, setSubmittingGift] = useState(false);
  const [giftFeedback, setGiftFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (initialGuest) {
      setGuestName(initialGuest.name);
      setQuickWishName(initialGuest.name);
      setGiftSenderName(initialGuest.name);
      if (initialGuest.phone) setPhone(initialGuest.phone);
      if (initialGuest.rsvp_status !== 'pending') setRsvpStatus(initialGuest.rsvp_status);
      if (initialGuest.pax_count) setPaxCount(initialGuest.pax_count);
      if (initialGuest.notes) setNotes(initialGuest.notes);
    } else if (adHocGuestName) {
      setGuestName(adHocGuestName);
      setQuickWishName(adHocGuestName);
      setGiftSenderName(adHocGuestName);
    }
  }, [initialGuest, adHocGuestName]);

  useEffect(() => {
    if (giftAccounts.length > 0 && !giftTargetAccount) {
      const first = giftAccounts[0];
      setGiftTargetAccount(`${first.provider} — ${first.account_holder}`);
    }
  }, [giftAccounts, giftTargetAccount]);

  useEffect(() => {
    weddingAudio.configure(settings.music_mode, settings.music_url);
  }, [settings.music_mode, settings.music_url]);

  useEffect(() => {
    const updateCountdown = () => {
      const target = new Date(settings.event_date_iso).getTime();
      if (Number.isNaN(target)) return;
      const diff = Math.max(0, target - Date.now());
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
      const mins = Math.floor((diff / (1000 * 60)) % 60);
      const secs = Math.floor((diff / 1000) % 60);
      setCountdown({ days, hours, mins, secs });
    };
    updateCountdown();
    const id = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(id);
  }, [settings.event_date_iso]);

  useEffect(() => {
    return () => {
      if (tapResetRef.current !== null) window.clearTimeout(tapResetRef.current);
      weddingAudio.stop();
    };
  }, []);

  const sections = useMemo(() => {
    const list: { id: InvitationSection; label: string; shortLabel: string; icon: React.ReactNode }[] = [
      { id: 'mempelai', label: 'Mempelai', shortLabel: 'Mempelai', icon: <Users className="w-4 h-4" /> },
      { id: 'acara', label: 'Rincian Acara', shortLabel: 'Acara', icon: <CalendarHeart className="w-4 h-4" /> },
      { id: 'lokasi', label: 'Peta Lokasi', shortLabel: 'Lokasi', icon: <MapPin className="w-4 h-4" /> },
      { id: 'galeri', label: 'Galeri Foto', shortLabel: 'Galeri', icon: <ImageIcon className="w-4 h-4" /> },
    ];
    if (giftAccounts.length > 0) {
      list.push({ id: 'hadiah', label: 'Kirim Hadiah', shortLabel: 'Hadiah', icon: <Gift className="w-4 h-4" /> });
    }
    list.push({
      id: 'rsvp',
      label: 'RSVP & Doa',
      shortLabel: 'RSVP & Doa',
      icon: <MessageSquareHeart className="w-4 h-4" />,
    });
    return list;
  }, [giftAccounts.length]);

  useEffect(() => {
    if (!sections.some((s) => s.id === activeSection)) {
      setActiveSection('mempelai');
    }
  }, [sections, activeSection]);

  const activeIndex = Math.max(
    0,
    sections.findIndex((s) => s.id === activeSection)
  );
  const prevSection = activeIndex > 0 ? sections[activeIndex - 1] : null;
  const nextSection = activeIndex < sections.length - 1 ? sections[activeIndex + 1] : null;

  const handleOpenInvitation = async () => {
    setOpened(true);
    setActiveSection('mempelai');
    try {
      const ok = await weddingAudio.play();
      setIsPlaying(ok);
      setIsMuted(false);
    } catch {
      setIsPlaying(false);
    }
  };

  const handleToggleMusic = async () => {
    try {
      if (!isPlaying) {
        const ok = await weddingAudio.play();
        setIsPlaying(ok);
        setIsMuted(false);
        weddingAudio.setMuted(false);
      } else {
        const nextMuted = !isMuted;
        setIsMuted(nextMuted);
        weddingAudio.setMuted(nextMuted);
      }
    } catch {
      setIsPlaying(false);
    }
  };

  const handleSubmitRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setRsvpFeedback({ type: 'err', text: 'Mohon masukkan nama lengkap Anda.' });
      return;
    }
    setSubmittingRsvp(true);
    setRsvpFeedback(null);
    try {
      const res = await fetch('/api/public/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: initialGuest?.slug || '',
          name: guestName.trim(),
          phone: phone.trim(),
          group_name: initialGuest?.group_name || 'Tamu Umum',
          rsvp_status: rsvpStatus,
          pax_count: rsvpStatus === 'attending' ? paxCount : 0,
          notes: notes.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim konfirmasi.');
      onRsvpSuccess(data.guest, data.stats);

      if (wishMessage.trim()) {
        const wishRes = await fetch('/api/public/guestbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guest_slug: data.guest.slug,
            sender_name: guestName.trim(),
            attendance_status: rsvpStatus,
            message: wishMessage.trim(),
          }),
        });
        if (wishRes.ok) {
          const entry = await wishRes.json();
          onWishCreated(entry);
          setWishMessage('');
        }
      }

      setRsvpFeedback({
        type: 'ok',
        text: 'Terima kasih! Konfirmasi kehadiran Anda telah tersimpan.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Terjadi kesalahan.';
      setRsvpFeedback({ type: 'err', text: msg });
    } finally {
      setSubmittingRsvp(false);
    }
  };

  const handleSubmitQuickWish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickWishName.trim() || !quickWishMsg.trim()) return;
    setSubmittingWish(true);
    setWishFeedback(null);
    try {
      const res = await fetch('/api/public/guestbook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_slug: initialGuest?.slug || '',
          sender_name: quickWishName.trim(),
          attendance_status: rsvpStatus,
          message: quickWishMsg.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim ucapan doa.');
      onWishCreated(data);
      setQuickWishMsg('');
      setWishFeedback({ type: 'ok', text: 'Doa restu Anda berhasil ditambahkan.' });
    } catch (err: unknown) {
      setWishFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal terhubung ke server.',
      });
    } finally {
      setSubmittingWish(false);
    }
  };

  const handleCopyGiftAccount = async (account: GiftAccount) => {
    const value = account.account_number;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        ok = true;
      }
    } catch {
      // fallback below
    }
    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopiedGiftId(account.id);
      window.setTimeout(() => setCopiedGiftId(null), 2000);
    }
  };

  const handleSubmitGift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!giftSenderName.trim()) {
      setGiftFeedback({ type: 'err', text: 'Mohon masukkan nama pengirim.' });
      return;
    }
    setSubmittingGift(true);
    setGiftFeedback(null);
    try {
      const numericAmount = Number(giftAmount.replace(/[^0-9]/g, '')) || 0;
      const res = await fetch('/api/public/gifts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guest_slug: initialGuest?.slug || '',
          sender_name: giftSenderName.trim(),
          gift_type: giftType,
          target_account: giftTargetAccount.trim(),
          amount: giftType === 'transfer' ? numericAmount : 0,
          message: giftMessage.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Gagal mengirim konfirmasi hadiah.');
      setGiftAmount('');
      setGiftMessage('');
      setGiftFeedback({
        type: 'ok',
        text: 'Terima kasih banyak! Konfirmasi tanda kasih Anda telah diterima oleh mempelai.',
      });
    } catch (err: unknown) {
      setGiftFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Gagal terhubung ke server.',
      });
    } finally {
      setSubmittingGift(false);
    }
  };

  const safeMapSrc = useMemo(() => getSafeMapEmbedUrl(settings), [settings]);
  const safeDirectionsHref = useMemo(
    () =>
      getSafeExternalUrl(
        settings.map_directions_url,
        settings.map_lat,
        settings.map_lng,
        settings.venue_address
      ),
    [settings]
  );

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#FBF9F5] text-[#1C1917] flex flex-col">
      <AnimatePresence mode="wait">
        {!opened ? (
          /* FULL-SCREEN NON-SCROLLING COVER ENVELOPE GATE */
          <motion.section
            key="cover-gate"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -24 }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="relative h-full w-full flex items-center justify-center overflow-hidden p-4 sm:p-6"
          >
            <ResilientImage
              src={settings.hero_image}
              alt={`Pernikahan ${settings.couple_title}`}
              className="absolute inset-0 w-full h-full object-cover scale-105"
              fallbackLabel={settings.couple_title}
            />
            <div
              className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/80"
              aria-hidden="true"
            />

            <div className="relative z-10 w-full max-w-lg mx-auto text-center">
              {/* Elevated Architectural Botanical Cover Card */}
              <div className="bg-[#FBF9F5]/95 backdrop-blur-md rounded-2xl p-6 sm:p-10 border border-[#D8CFC0] shadow-2xl">
                <div className="border border-[#8A6A3E]/30 rounded-xl p-5 sm:p-8 space-y-6">
                  <div className="space-y-2">
                    <p className="text-[11px] sm:text-xs tracking-[0.26em] uppercase text-[#8A6A3E] font-medium">
                      Undangan Pernikahan
                    </p>
                    <h1
                      onClick={handleSecretCoupleTap}
                      className="font-serif text-4xl sm:text-5xl font-medium tracking-tight leading-[1.08] text-[#1C1917] text-balance select-none"
                    >
                      {settings.couple_title}
                    </h1>
                    <p className="text-xs sm:text-sm text-[#57534E] tracking-wide pt-1">
                      {settings.akad_date_label}
                      <span aria-hidden="true" className="mx-2">·</span>
                      {settings.resepsi_venue}
                    </p>
                  </div>

                  {/* Personalized Guest Frame */}
                  <div className="pt-5 border-t border-[#E6DFD3]">
                    <div className="flex items-center justify-center gap-3 mb-2.5">
                      <span className="h-px w-7 bg-[#8A6A3E]/50" aria-hidden="true" />
                      <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-[#8A6A3E] font-medium">
                        Undangan Khusus Untuk
                      </p>
                      <span className="h-px w-7 bg-[#8A6A3E]/50" aria-hidden="true" />
                    </div>

                    <p className="font-serif text-2xl sm:text-3xl font-semibold text-[#1C1917] break-words">
                      {displayGuestName || 'Tamu Undangan Terhormat'}
                    </p>

                    {initialGuest?.group_name && (
                      <p className="text-xs text-[#57534E] mt-1.5">
                        Tamu {initialGuest.group_name}
                        {initialGuest.rsvp_status === 'attending'
                          ? ` · Terkonfirmasi Hadir (${initialGuest.pax_count} orang)`
                          : initialGuest.rsvp_status === 'not_attending'
                          ? ' · Berhalangan Hadir'
                          : ''}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleOpenInvitation}
                    className="w-full min-h-[48px] px-6 py-3 bg-[#1F4E3D] hover:bg-[#163A2D] active:scale-[0.99] text-white text-sm font-medium rounded-xl transition-all cursor-pointer inline-flex items-center justify-center gap-2.5 shadow-sm"
                  >
                    <MailOpen className="w-4 h-4 shrink-0" />
                    <span>Buka Undangan</span>
                  </button>
                </div>
              </div>

              <div className="mt-5">
                <button
                  type="button"
                  onClick={onOpenAdmin}
                  className="inline-flex items-center gap-1.5 text-[11px] font-medium text-white/80 hover:text-white transition-colors cursor-pointer"
                >
                  <Lock className="w-3 h-3" />
                  <span>Portal Mempelai</span>
                </button>
              </div>
            </div>
          </motion.section>
        ) : (
          /* OPENED ZERO-SCROLL INTERACTIVE DECK WORKSPACE */
          <motion.div
            key="opened-workspace"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35 }}
            className="h-full w-full flex flex-col overflow-hidden"
          >
            {/* Compact Top Navigation Bar */}
            <header className="h-14 shrink-0 bg-[#FBF9F5]/95 backdrop-blur-md border-b border-[#E6DFD3] px-4 sm:px-6 flex items-center justify-between gap-4 z-30">
              <button
                type="button"
                onClick={() => setOpened(false)}
                className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-[#1C1917] hover:text-[#1F4E3D] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Kembali ke Sampul Undangan"
              >
                {settings.couple_title}
              </button>

              {/* Desktop Section Tabs (Zero Scrolling) */}
              <nav className="hidden md:flex items-center gap-1 bg-[#F3EFE7] p-1 rounded-xl border border-[#E6DFD3]">
                {sections.map((sec) => (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSection(sec.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                      activeSection === sec.id
                        ? 'bg-[#1F4E3D] text-white shadow-xs'
                        : 'text-[#57534E] hover:text-[#1C1917]'
                    }`}
                  >
                    {sec.shortLabel}
                  </button>
                ))}
              </nav>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleToggleMusic}
                  aria-label={isPlaying && !isMuted ? 'Matikan suara musik' : 'Nyalakan musik latar'}
                  title={settings.music_title}
                  className="inline-flex items-center gap-1.5 h-9 px-3 bg-[#1C1917] hover:bg-[#332E2A] text-white rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
                >
                  {isPlaying && !isMuted ? (
                    <Volume2 className="w-3.5 h-3.5 shrink-0" />
                  ) : isPlaying && isMuted ? (
                    <VolumeX className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <Music className="w-3.5 h-3.5 shrink-0" />
                  )}
                  <span className="hidden sm:inline max-w-[110px] truncate">
                    {isPlaying && !isMuted
                      ? settings.music_title || 'Musik Aktif'
                      : isPlaying && isMuted
                      ? 'Suara Mati'
                      : 'Putar Musik'}
                  </span>
                </button>
              </div>
            </header>

            {/* Active Section Viewport Stage */}
            <main className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-5 sm:py-8">
              <div className="max-w-5xl mx-auto h-full flex flex-col justify-between gap-6">
                <AnimatePresence mode="wait">
                  {/* SECTION 1: MEMPELAI & DOA PEMBUKA */}
                  {activeSection === 'mempelai' && (
                    <motion.section
                      key="sec-mempelai"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-6"
                    >
                      <div className="text-center max-w-2xl mx-auto">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                          Bismillahirrahmanirrahim
                        </p>
                        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-[#1C1917]">
                          Mempelai Berbahagia
                        </h2>
                        <p className="font-serif italic text-sm sm:text-base text-[#57534E] mt-2 leading-relaxed">
                          “{settings.opening_quote}” — <span className="not-italic font-sans text-xs">{settings.quote_source}</span>
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
                        <article className="flex flex-col sm:flex-row md:flex-col bg-[#F3EFE7]/75 border border-[#E6DFD3] rounded-t-[120px] sm:rounded-t-2xl md:rounded-t-[140px] rounded-b-xl overflow-hidden">
                          <div className="aspect-[4/3] sm:w-44 md:w-full md:aspect-[16/10] shrink-0 overflow-hidden bg-[#EFEAE0]">
                            <ResilientImage
                              src={settings.bride_photo}
                              alt={settings.bride_name}
                              className="w-full h-full object-cover object-top"
                            />
                          </div>
                          <div className="p-5 sm:p-6 text-center sm:text-left md:text-center flex-1 flex flex-col justify-center">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8A6A3E] mb-1">
                              Mempelai Wanita
                            </p>
                            <h3 className="font-serif text-xl sm:text-2xl font-semibold text-[#1C1917] mb-1.5">
                              {settings.bride_name}
                            </h3>
                            <p className="text-xs sm:text-sm text-[#57534E] leading-relaxed">
                              {settings.bride_parents}
                            </p>
                          </div>
                        </article>

                        <article className="flex flex-col sm:flex-row md:flex-col bg-[#F3EFE7]/75 border border-[#E6DFD3] rounded-t-[120px] sm:rounded-t-2xl md:rounded-t-[140px] rounded-b-xl overflow-hidden">
                          <div className="aspect-[4/3] sm:w-44 md:w-full md:aspect-[16/10] shrink-0 overflow-hidden bg-[#EFEAE0]">
                            <ResilientImage
                              src={settings.groom_photo}
                              alt={settings.groom_name}
                              className="w-full h-full object-cover object-top"
                            />
                          </div>
                          <div className="p-5 sm:p-6 text-center sm:text-left md:text-center flex-1 flex flex-col justify-center">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-[#8A6A3E] mb-1">
                              Mempelai Pria
                            </p>
                            <h3 className="font-serif text-xl sm:text-2xl font-semibold text-[#1C1917] mb-1.5">
                              {settings.groom_name}
                            </h3>
                            <p className="text-xs sm:text-sm text-[#57534E] leading-relaxed">
                              {settings.groom_parents}
                            </p>
                          </div>
                        </article>
                      </div>
                    </motion.section>
                  )}

                  {/* SECTION 2: COUNTDOWN & JADWAL ACARA */}
                  {activeSection === 'acara' && (
                    <motion.section
                      key="sec-acara"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-6"
                    >
                      <div className="text-center max-w-xl mx-auto">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                          Menuju Hari Bahagia
                        </p>
                        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-[#1C1917]">
                          Rangkaian Acara Pernikahan
                        </h2>
                      </div>

                      <div className="grid grid-cols-4 gap-2.5 sm:gap-5 max-w-xl mx-auto">
                        {[
                          { label: 'Hari', value: countdown.days },
                          { label: 'Jam', value: countdown.hours },
                          { label: 'Menit', value: countdown.mins },
                          { label: 'Detik', value: countdown.secs },
                        ].map((item) => (
                          <div
                            key={item.label}
                            className="bg-[#F3EFE7] border border-[#E6DFD3] rounded-xl py-3.5 px-2 text-center"
                          >
                            <div className="font-mono tabular-nums text-2xl sm:text-3xl font-semibold text-[#1F4E3D]">
                              {String(item.value).padStart(2, '0')}
                            </div>
                            <div className="text-[10px] sm:text-xs uppercase tracking-widest text-[#57534E] mt-1">
                              {item.label}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div className="bg-[#F3EFE7]/75 border border-[#E6DFD3] rounded-xl p-5 sm:p-6">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#8A6A3E] mb-1.5">
                            01 · Prosesi Sakral
                          </p>
                          <h3 className="font-serif text-2xl font-semibold text-[#1C1917] mb-3">
                            Akad Nikah
                          </h3>
                          <dl className="space-y-2.5 text-sm text-[#57534E] border-t border-[#E6DFD3] pt-3">
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Tanggal</dt>
                              <dd className="text-right">{settings.akad_date_label}</dd>
                            </div>
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Waktu</dt>
                              <dd className="text-right font-mono tabular-nums">{settings.akad_time}</dd>
                            </div>
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Tempat</dt>
                              <dd className="text-right">{settings.akad_venue}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="bg-[#F3EFE7]/75 border border-[#E6DFD3] rounded-xl p-5 sm:p-6">
                          <p className="text-xs uppercase tracking-[0.18em] text-[#8A6A3E] mb-1.5">
                            02 · Jamuan & Silaturahmi
                          </p>
                          <h3 className="font-serif text-2xl font-semibold text-[#1C1917] mb-3">
                            Resepsi Pernikahan
                          </h3>
                          <dl className="space-y-2.5 text-sm text-[#57534E] border-t border-[#E6DFD3] pt-3">
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Tanggal</dt>
                              <dd className="text-right">{settings.resepsi_date_label}</dd>
                            </div>
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Waktu</dt>
                              <dd className="text-right font-mono tabular-nums">{settings.resepsi_time}</dd>
                            </div>
                            <div className="flex justify-between gap-4">
                              <dt className="font-medium text-[#1C1917]">Tempat</dt>
                              <dd className="text-right">{settings.resepsi_venue}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>

                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => downloadCalendarIcs(settings)}
                          className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2 bg-[#F3EFE7] border border-[#1C1917]/20 hover:border-[#1F4E3D] text-xs sm:text-sm font-medium text-[#1C1917] rounded-lg transition-colors cursor-pointer"
                        >
                          <Calendar className="w-4 h-4 text-[#1F4E3D]" />
                          <span>Simpan Tanggal ke Kalender (.ics)</span>
                        </button>
                      </div>
                    </motion.section>
                  )}

                  {/* SECTION 3: PETA LOKASI */}
                  {activeSection === 'lokasi' && (
                    <motion.section
                      key="sec-lokasi"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center my-auto"
                    >
                      <div className="lg:col-span-5 space-y-4">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                            Peta Lokasi Acara
                          </p>
                          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#1C1917] text-balance">
                            {settings.resepsi_venue}
                          </h2>
                        </div>
                        <p className="text-sm sm:text-base text-[#57534E] leading-relaxed">
                          {settings.venue_address}
                        </p>
                        <div className="pt-1">
                          <a
                            href={safeDirectionsHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 min-h-[44px] px-5 py-2.5 bg-[#1F4E3D] hover:bg-[#163A2D] text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            <MapPin className="w-4 h-4" />
                            <span>Buka Petunjuk Arah</span>
                            <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                          </a>
                        </div>
                      </div>

                      <div className="lg:col-span-7">
                        <div className="w-full h-72 sm:h-88 lg:h-[380px] rounded-xl overflow-hidden border border-[#E6DFD3] bg-[#F3EFE7]">
                          <iframe
                            title={`Peta Lokasi ${settings.resepsi_venue}`}
                            src={safeMapSrc}
                            className="w-full h-full border-0"
                            loading="lazy"
                            referrerPolicy="no-referrer-when-downgrade"
                          />
                        </div>
                      </div>
                    </motion.section>
                  )}

                  {/* SECTION 4: GALERI FOTO */}
                  {activeSection === 'galeri' && (
                    <motion.section
                      key="sec-galeri"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-6"
                    >
                      <div className="text-center max-w-xl mx-auto">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                          Arsip Kenangan
                        </p>
                        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-[#1C1917]">
                          Galeri Momen Kebersamaan
                        </h2>
                      </div>

                      {gallery.length === 0 ? (
                        <p className="text-center text-sm text-[#57534E] py-12">
                          Galeri foto belum ditambahkan.
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                          {gallery.map((item, idx) => (
                            <figure key={item.id} className="group">
                              <button
                                type="button"
                                onClick={() => setLightboxItem(item)}
                                className="w-full aspect-[4/3] rounded-xl overflow-hidden border border-[#E6DFD3] bg-[#EFEAE0] block cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1F4E3D]"
                              >
                                <ResilientImage
                                  src={item.image_url}
                                  alt={item.title}
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                                />
                              </button>
                              <figcaption className="mt-2">
                                <p className="text-xs font-mono text-[#57534E]">
                                  Fig. {String(idx + 1).padStart(2, '0')} <span aria-hidden="true">·</span> {item.title}
                                </p>
                                {item.caption && (
                                  <p className="font-serif italic text-sm text-[#57534E] mt-0.5">
                                    {item.caption}
                                  </p>
                                )}
                              </figcaption>
                            </figure>
                          ))}
                        </div>
                      )}
                    </motion.section>
                  )}

                  {/* SECTION 5: KIRIM HADIAH */}
                  {activeSection === 'hadiah' && (
                    <motion.section
                      key="sec-hadiah"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-6"
                    >
                      <div className="text-center max-w-2xl mx-auto">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                          Tanda Kasih
                        </p>
                        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-[#1C1917]">
                          Kirim Hadiah Pernikahan
                        </h2>
                        <p className="text-xs sm:text-sm text-[#57534E] mt-2 leading-relaxed">
                          Doa restu Bapak/Ibu/Saudara/i merupakan karunia terindah bagi kami.
                          Apabila berkenan memberikan tanda kasih, dapat disalurkan melalui tujuan berikut.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {giftAccounts.map((acc) => (
                          <div
                            key={acc.id}
                            className="bg-[#F3EFE7]/80 border border-[#E6DFD3] rounded-xl p-5 flex flex-col justify-between gap-4"
                          >
                            <div className="space-y-2.5">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-[10px] uppercase tracking-[0.16em] text-[#8A6A3E] font-medium">
                                  {acc.type === 'bank'
                                    ? 'Transfer Bank'
                                    : acc.type === 'ewallet'
                                    ? 'Dompet Digital'
                                    : 'Kirim Kado Fisik'}
                                </span>
                                {acc.type === 'bank' ? (
                                  <CreditCard className="w-4 h-4 text-[#1F4E3D]" />
                                ) : acc.type === 'ewallet' ? (
                                  <Wallet className="w-4 h-4 text-[#1F4E3D]" />
                                ) : (
                                  <Package className="w-4 h-4 text-[#1F4E3D]" />
                                )}
                              </div>

                              <div>
                                <h3 className="font-serif text-xl font-semibold text-[#1C1917]">
                                  {acc.provider}
                                </h3>
                                {acc.notes && <p className="text-xs text-[#57534E]">{acc.notes}</p>}
                              </div>

                              <div className="pt-2 border-t border-[#E6DFD3]">
                                <p
                                  className={`${
                                    acc.type === 'address'
                                      ? 'text-xs leading-relaxed text-[#1C1917]'
                                      : 'font-mono text-base font-semibold tracking-wide text-[#1C1917]'
                                  } break-words`}
                                >
                                  {acc.account_number}
                                </p>
                                <p className="text-xs text-[#57534E] mt-1">
                                  a.n. <span className="font-medium text-[#1C1917]">{acc.account_holder}</span>
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleCopyGiftAccount(acc)}
                              className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-3 py-2 bg-[#FBF9F5] border border-[#1C1917]/15 hover:border-[#1F4E3D] text-xs font-medium text-[#1C1917] rounded-lg transition-colors cursor-pointer"
                            >
                              {copiedGiftId === acc.id ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-[#1F4E3D]" />
                                  <span className="text-[#1F4E3D] font-semibold">Berhasil Disalin</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5 text-[#57534E]" />
                                  <span>
                                    {acc.type === 'address' ? 'Salin Alamat' : 'Salin Nomor'}
                                  </span>
                                </>
                              )}
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="text-center">
                        <button
                          type="button"
                          onClick={() => setShowGiftForm((v) => !v)}
                          className="inline-flex items-center gap-2 min-h-[42px] px-5 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] text-white text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer"
                        >
                          <Gift className="w-4 h-4" />
                          <span>
                            {showGiftForm ? 'Tutup Form Konfirmasi' : 'Konfirmasi Pengiriman Hadiah'}
                          </span>
                        </button>
                      </div>

                      {showGiftForm && (
                        <form
                          onSubmit={handleSubmitGift}
                          className="max-w-xl mx-auto bg-[#F3EFE7]/70 border border-[#E6DFD3] rounded-xl p-5 space-y-3.5 text-left"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                Nama Pengirim
                              </label>
                              <input
                                type="text"
                                required
                                value={giftSenderName}
                                onChange={(e) => setGiftSenderName(e.target.value)}
                                placeholder="Nama lengkap Anda"
                                className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                Jenis Tanda Kasih
                              </label>
                              <select
                                value={giftType}
                                onChange={(e) => setGiftType(e.target.value as GiftType)}
                                className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              >
                                <option value="transfer">Transfer / Dompet Digital</option>
                                <option value="kado">Kado Fisik / Paket</option>
                              </select>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                Tujuan Rekening / Alamat
                              </label>
                              <select
                                value={giftTargetAccount}
                                onChange={(e) => setGiftTargetAccount(e.target.value)}
                                className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              >
                                {giftAccounts.map((acc) => {
                                  const label = `${acc.provider} — ${acc.account_holder}`;
                                  return (
                                    <option key={acc.id} value={label}>
                                      {label}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>
                            {giftType === 'transfer' && (
                              <div>
                                <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                  Nominal Transfer (Rp, Opsional)
                                </label>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={giftAmount}
                                  onChange={(e) => setGiftAmount(e.target.value)}
                                  placeholder="Contoh: 500000"
                                  className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm font-mono focus:outline-none focus:border-[#1F4E3D]"
                                />
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[#1C1917] mb-1">
                              {giftType === 'kado' ? 'Keterangan Kado / No. Resi' : 'Pesan Singkat (Opsional)'}
                            </label>
                            <input
                              type="text"
                              value={giftMessage}
                              onChange={(e) => setGiftMessage(e.target.value)}
                              placeholder={
                                giftType === 'kado'
                                  ? 'Contoh: Set peralatan kopi via JNE...'
                                  : 'Semoga menjadi keluarga sakinah mawaddah warahmah...'
                              }
                              className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                            />
                          </div>

                          {giftFeedback && (
                            <div
                              className={`p-3 rounded-lg text-xs font-medium flex items-start gap-2 ${
                                giftFeedback.type === 'ok'
                                  ? 'bg-[#1F4E3D]/10 text-[#1F4E3D]'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              <Check className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{giftFeedback.text}</span>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={submittingGift}
                            className="w-full min-h-[42px] px-5 py-2.5 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-60 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            {submittingGift ? 'Mengirim...' : 'Kirim Konfirmasi Hadiah'}
                          </button>
                        </form>
                      )}
                    </motion.section>
                  )}

                  {/* SECTION 6: RSVP & BUKU TAMU REAL-TIME */}
                  {activeSection === 'rsvp' && (
                    <motion.section
                      key="sec-rsvp"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-6"
                    >
                      <div className="text-center max-w-xl mx-auto">
                        <p className="text-[11px] uppercase tracking-[0.2em] text-[#8A6A3E] mb-1.5">
                          Konfirmasi & Doa Restu
                        </p>
                        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-[#1C1917]">
                          Kehadiran & Buku Tamu
                        </h2>
                        <p className="text-xs sm:text-sm text-[#57534E] mt-1">
                          {guestbook.length} doa restu telah dibagikan oleh tamu undangan.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                        {/* RSVP Form */}
                        <form
                          onSubmit={handleSubmitRsvp}
                          className="lg:col-span-5 bg-[#F3EFE7]/75 border border-[#E6DFD3] rounded-xl p-5 space-y-3.5"
                        >
                          <h3 className="font-serif text-xl font-semibold text-[#1C1917]">
                            Konfirmasi Kehadiran
                          </h3>

                          <div>
                            <label className="block text-xs font-medium text-[#1C1917] mb-1">
                              Nama Lengkap
                            </label>
                            <input
                              type="text"
                              required
                              value={guestName}
                              onChange={(e) => setGuestName(e.target.value)}
                              placeholder="Contoh: Bapak Ahmad Fauzi"
                              className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                No. WhatsApp
                              </label>
                              <input
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                placeholder="0812..."
                                className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              />
                            </div>
                            {rsvpStatus === 'attending' && (
                              <div>
                                <label className="block text-xs font-medium text-[#1C1917] mb-1">
                                  Jumlah Tamu
                                </label>
                                <select
                                  value={paxCount}
                                  onChange={(e) => setPaxCount(Number(e.target.value))}
                                  className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                                >
                                  {[1, 2, 3, 4, 5].map((n) => (
                                    <option key={n} value={n}>
                                      {n} Orang
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <div>
                            <span className="block text-xs font-medium text-[#1C1917] mb-1">
                              Status Kehadiran
                            </span>
                            <div className="grid grid-cols-2 gap-2 p-1 bg-[#E6DFD3]/60 rounded-lg">
                              <button
                                type="button"
                                onClick={() => setRsvpStatus('attending')}
                                className={`min-h-[38px] py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                                  rsvpStatus === 'attending'
                                    ? 'bg-[#1F4E3D] text-white'
                                    : 'text-[#57534E] hover:text-[#1C1917]'
                                }`}
                              >
                                Ya, Saya Hadir
                              </button>
                              <button
                                type="button"
                                onClick={() => setRsvpStatus('not_attending')}
                                className={`min-h-[38px] py-1.5 px-3 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                                  rsvpStatus === 'not_attending'
                                    ? 'bg-[#1C1917] text-white'
                                    : 'text-[#57534E] hover:text-[#1C1917]'
                                }`}
                              >
                                Berhalangan
                              </button>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[#1C1917] mb-1">
                              Ucapan & Doa Restu (Opsional)
                            </label>
                            <textarea
                              rows={2}
                              value={wishMessage}
                              onChange={(e) => setWishMessage(e.target.value)}
                              placeholder="Tuliskan doa restu untuk kedua mempelai..."
                              className="w-full px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-[#1C1917] mb-1">
                              Catatan Tambahan (Opsional)
                            </label>
                            <input
                              type="text"
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="Contoh: Hadir saat akad"
                              className="w-full min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                            />
                          </div>

                          {rsvpFeedback && (
                            <div
                              className={`p-3 rounded-lg text-xs font-medium flex items-start gap-2 ${
                                rsvpFeedback.type === 'ok'
                                  ? 'bg-[#1F4E3D]/10 text-[#1F4E3D]'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              <Check className="w-4 h-4 shrink-0 mt-0.5" />
                              <span>{rsvpFeedback.text}</span>
                            </div>
                          )}

                          <button
                            type="submit"
                            disabled={submittingRsvp}
                            className="w-full min-h-[42px] px-5 py-2.5 bg-[#1F4E3D] hover:bg-[#163A2D] disabled:opacity-60 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors cursor-pointer"
                          >
                            {submittingRsvp ? 'Menyimpan...' : 'Kirim Konfirmasi Kehadiran'}
                          </button>
                        </form>

                        {/* Real-Time Guestbook */}
                        <div className="lg:col-span-7 space-y-4">
                          <form
                            onSubmit={handleSubmitQuickWish}
                            className="bg-[#F3EFE7]/50 border border-[#E6DFD3] rounded-xl p-4 space-y-3"
                          >
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                              <input
                                type="text"
                                required
                                value={quickWishName}
                                onChange={(e) => setQuickWishName(e.target.value)}
                                placeholder="Nama Anda"
                                className="min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              />
                              <input
                                type="text"
                                required
                                value={quickWishMsg}
                                onChange={(e) => setQuickWishMsg(e.target.value)}
                                placeholder="Kirim doa restu langsung..."
                                className="sm:col-span-2 min-h-[40px] px-3 py-2 bg-[#FBF9F5] border border-[#E6DFD3] rounded-lg text-sm focus:outline-none focus:border-[#1F4E3D]"
                              />
                            </div>
                            {wishFeedback && (
                              <p
                                className={`text-xs font-medium px-3 py-2 rounded-lg ${
                                  wishFeedback.type === 'ok'
                                    ? 'bg-[#1F4E3D]/10 text-[#1F4E3D]'
                                    : 'bg-red-50 text-red-700'
                                }`}
                              >
                                {wishFeedback.text}
                              </p>
                            )}
                            <div className="flex justify-end">
                              <button
                                type="submit"
                                disabled={submittingWish}
                                className="inline-flex items-center gap-2 min-h-[38px] px-4 py-2 bg-[#1C1917] hover:bg-[#332E2A] disabled:opacity-60 text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>{submittingWish ? 'Mengirim...' : 'Kirim Doa'}</span>
                              </button>
                            </div>
                          </form>

                          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1">
                            {guestbook.length === 0 ? (
                              <div className="py-10 text-center border border-dashed border-[#E6DFD3] rounded-xl text-sm text-[#57534E]">
                                Jadilah yang pertama mengirimkan doa restu.
                              </div>
                            ) : (
                              guestbook.map((item) => (
                                <article
                                  key={item.id}
                                  className="pb-3 border-b border-[#E6DFD3] last:border-b-0"
                                >
                                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#57534E] mb-1">
                                    <span className="font-semibold text-sm text-[#1C1917]">
                                      {item.sender_name}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span>{formatStatusLabel(item.attendance_status)}</span>
                                    <span aria-hidden="true">·</span>
                                    <time className="font-mono tabular-nums">
                                      {formatSafeDate(item.created_at)}
                                    </time>
                                  </div>
                                  <p className="text-sm text-[#1C1917]/90 leading-relaxed">
                                    {item.message}
                                  </p>
                                </article>
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.section>
                  )}
                </AnimatePresence>

                {/* Bottom Stepper Strip inside Stage (Effortless Next / Prev without scrolling) */}
                <div className="pt-3 border-t border-[#E6DFD3] flex items-center justify-between gap-4 shrink-0">
                  {prevSection ? (
                    <button
                      type="button"
                      onClick={() => setActiveSection(prevSection.id)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#57534E] hover:text-[#1C1917] cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      <span>{prevSection.shortLabel}</span>
                    </button>
                  ) : (
                    <span
                      onClick={handleSecretCoupleTap}
                      className="inline-flex items-center gap-1.5 text-xs text-[#8A6A3E] font-serif italic select-none"
                    >
                      <Heart className="w-3.5 h-3.5" />
                      <span>{settings.couple_title}</span>
                    </span>
                  )}

                  {nextSection && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.96 }}
                      whileHover={{ scale: 1.02 }}
                      onClick={() => setActiveSection(nextSection.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#1F4E3D] hover:bg-[#163A2D] text-white text-xs font-semibold rounded-xl shadow-sm transition-colors cursor-pointer"
                    >
                      <span>Lanjut: {nextSection.shortLabel}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </motion.button>
                  )}
                </div>
              </div>
            </main>

            {/* Mobile Bottom Navigation Dock (Zero Scroll Navigation) */}
            <nav
              aria-label="Navigasi undangan"
              className="md:hidden shrink-0 h-16 bg-[#FBF9F5] border-t border-[#E6DFD3] px-1 flex items-center justify-around z-30"
            >
              {sections.map((sec) => {
                const active = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => setActiveSection(sec.id)}
                    className={`flex flex-col items-center justify-center gap-1 px-2 py-1.5 rounded-lg min-w-[52px] transition-colors cursor-pointer ${
                      active ? 'text-[#1F4E3D] font-semibold' : 'text-[#57534E]'
                    }`}
                  >
                    {sec.icon}
                    <span className="text-[10px] leading-none whitespace-nowrap">
                      {sec.shortLabel}
                    </span>
                  </button>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Gallery Lightbox Modal */}
      {lightboxItem && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setLightboxItem(null)}
        >
          <div
            className="relative max-w-4xl w-full bg-[#FBF9F5] rounded-xl overflow-hidden border border-[#E6DFD3]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setLightboxItem(null)}
              aria-label="Tutup galeri"
              className="absolute top-3 right-3 z-10 w-10 h-10 rounded-lg bg-black/70 text-white flex items-center justify-center hover:bg-black cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="max-h-[75vh] overflow-hidden bg-black flex items-center justify-center">
              <ResilientImage
                src={lightboxItem.image_url}
                alt={lightboxItem.title}
                className="max-h-[75vh] w-auto object-contain"
              />
            </div>
            <div className="p-4 sm:p-5">
              <h4 className="font-serif text-xl font-semibold text-[#1C1917]">
                {lightboxItem.title}
              </h4>
              {lightboxItem.caption && (
                <p className="text-sm text-[#57534E] mt-1">{lightboxItem.caption}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
