import React, { useCallback, useEffect, useState } from 'react';
import {
  GalleryItem,
  GiftAccount,
  Guest,
  GuestbookEntry,
  GuestStats,
  PublicBundle,
  WeddingSettings,
  WsEvent,
} from './types';
import { useWeddingWebSocket } from './hooks/useWebSocket';
import { InvitationPage } from './components/InvitationPage';
import { AdminDashboard } from './components/AdminDashboard';

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message || 'Terjadi kesalahan pada tampilan.' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FBF9F5] flex items-center justify-center p-6 text-center">
          <div className="max-w-md bg-white border border-stone-200 rounded-xl p-6 space-y-4">
            <h1 className="font-serif text-2xl font-semibold text-stone-900">
              Terjadi Gangguan Tampilan
            </h1>
            <p className="text-sm text-stone-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 bg-[#1F4E3D] text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [mode, setMode] = useState<'invitation' | 'admin'>(() => {
    const path = window.location.pathname.toLowerCase().replace(/\/+$/, '');
    const params = new URLSearchParams(window.location.search);
    const m = params.get('mode');
    if (
      path === '/mempelai' ||
      path === '/admin' ||
      m === 'admin' ||
      m === 'mempelai' ||
      window.location.hash === '#admin' ||
      window.location.hash === '#mempelai-portal'
    ) {
      return 'admin';
    }
    return 'invitation';
  });

  const [bundle, setBundle] = useState<PublicBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [liveEventSignal, setLiveEventSignal] = useState(0);

  const searchParams = new URLSearchParams(window.location.search);
  const tamuSlug = searchParams.get('tamu') || '';
  const adHocGuestName = searchParams.get('to') || '';

  const loadInvitation = useCallback(async () => {
    try {
      const sp = new URLSearchParams(window.location.search);
      let slug = sp.get('tamu') || '';
      if (!slug && window.location.hash.includes('tamu=')) {
        const hashMatch = window.location.hash.match(/tamu=([^&]+)/);
        if (hashMatch && hashMatch[1]) {
          slug = decodeURIComponent(hashMatch[1]);
        }
      }
      const qs = slug ? `?tamu=${encodeURIComponent(slug)}` : '';
      const res = await fetch(`/api/public/invitation${qs}`);
      if (!res.ok) throw new Error('Gagal memuat undangan dari server lokal.');
      const data = (await res.json()) as PublicBundle;
      setBundle(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvitation();
  }, [loadInvitation]);

  const handleWsEvent = useCallback((event: WsEvent) => {
    setLiveEventSignal((n) => n + 1);
    setBundle((prev) => {
      if (!prev) return prev;
      switch (event.type) {
        case 'guestbook:created': {
          const exists = prev.guestbook.some((g) => g.id === event.payload.id);
          if (exists) return prev;
          return {
            ...prev,
            guestbook: [event.payload, ...prev.guestbook],
          };
        }
        case 'guestbook:deleted': {
          return {
            ...prev,
            guestbook: prev.guestbook.filter((g) => g.id !== event.payload.id),
          };
        }
        case 'rsvp:updated':
        case 'guest:created':
        case 'guest:updated': {
          const updatedGuest =
            prev.guest && prev.guest.id === event.payload.guest.id
              ? event.payload.guest
              : prev.guest;
          return {
            ...prev,
            guest: updatedGuest,
            stats: event.payload.stats,
          };
        }
        case 'guest:deleted': {
          return {
            ...prev,
            stats: event.payload.stats,
          };
        }
        case 'gallery:updated': {
          return {
            ...prev,
            gallery: event.payload,
          };
        }
        case 'gift_accounts:updated': {
          return {
            ...prev,
            giftAccounts: event.payload,
          };
        }
        case 'settings:updated': {
          return {
            ...prev,
            settings: event.payload,
          };
        }
        default:
          return prev;
      }
    });
  }, []);

  useWeddingWebSocket(handleWsEvent);

  const handleSwitchMode = useCallback((nextMode: 'invitation' | 'admin') => {
    setMode(nextMode);
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    url.hash = '';
    if (nextMode === 'admin') {
      url.pathname = '/mempelai';
    } else {
      url.pathname = '/';
      void loadInvitation();
    }
    window.history.replaceState({}, '', url.toString());
    window.scrollTo({ top: 0 });
  }, [loadInvitation]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.altKey && e.key.toLowerCase() === 'm') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm')) {
        e.preventDefault();
        handleSwitchMode('admin');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSwitchMode]);

  if (mode === 'admin') {
    return (
      <AdminDashboard
        onBackToInvitation={() => handleSwitchMode('invitation')}
        liveEventSignal={liveEventSignal}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FBF9F5] flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="font-serif text-2xl text-[#1C1917]">Memuat Undangan...</p>
          <p className="text-xs text-[#57534E]">Menyiapkan data dari database SQL lokal</p>
        </div>
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="min-h-screen bg-[#FBF9F5] flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-4">
          <p className="font-serif text-2xl text-[#1C1917]">Undangan Tidak Tersedia</p>
          <p className="text-sm text-[#57534E]">{error || 'Gagal terhubung ke server.'}</p>
          <button
            type="button"
            onClick={() => void loadInvitation()}
            className="px-5 py-2.5 bg-[#1F4E3D] text-white text-xs font-medium rounded-lg cursor-pointer"
          >
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }

  return (
    <InvitationPage
      settings={bundle.settings as WeddingSettings}
      gallery={bundle.gallery as GalleryItem[]}
      guestbook={bundle.guestbook as GuestbookEntry[]}
      giftAccounts={(bundle.giftAccounts || []) as GiftAccount[]}
      stats={bundle.stats as GuestStats}
      initialGuest={bundle.guest as Guest | null}
      adHocGuestName={adHocGuestName}
      onRsvpSuccess={(guest, stats) =>
        setBundle((prev) => (prev ? { ...prev, guest, stats } : prev))
      }
      onWishCreated={(entry) =>
        setBundle((prev) => {
          if (!prev) return prev;
          if (prev.guestbook.some((g) => g.id === entry.id)) return prev;
          return { ...prev, guestbook: [entry, ...prev.guestbook] };
        })
      }
      onOpenAdmin={() => handleSwitchMode('admin')}
    />
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppContent />
    </AppErrorBoundary>
  );
}
