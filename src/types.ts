export type RsvpStatus = 'pending' | 'attending' | 'not_attending';

export interface WeddingSettings {
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
  updated_at: string;
}

export interface Guest {
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

export interface GuestStats {
  total_invited: number;
  attending_count: number;
  not_attending_count: number;
  pending_count: number;
  total_pax_attending: number;
  unsynced_count: number;
}

export interface GalleryItem {
  id: number;
  title: string;
  caption: string;
  image_url: string;
  sort_order: number;
  created_at: string;
}

export interface GuestbookEntry {
  id: number;
  guest_slug: string;
  sender_name: string;
  attendance_status: RsvpStatus;
  message: string;
  created_at: string;
}

export type GiftAccountType = 'bank' | 'ewallet' | 'address';

export interface GiftAccount {
  id: number;
  type: GiftAccountType;
  provider: string;
  account_number: string;
  account_holder: string;
  notes: string;
  sort_order: number;
  created_at: string;
}

export type GiftType = 'transfer' | 'kado';

export interface GiftConfirmation {
  id: number;
  guest_slug: string;
  sender_name: string;
  gift_type: GiftType;
  target_account: string;
  amount: number;
  message: string;
  created_at: string;
}

export interface PublicBundle {
  settings: WeddingSettings;
  gallery: GalleryItem[];
  guestbook: GuestbookEntry[];
  giftAccounts: GiftAccount[];
  stats: GuestStats;
  guest: Guest | null;
}

export type WsEvent =
  | { type: 'guestbook:created'; payload: GuestbookEntry }
  | { type: 'guestbook:deleted'; payload: { id: number } }
  | { type: 'rsvp:updated'; payload: { guest: Guest; stats: GuestStats } }
  | { type: 'guest:created'; payload: { guest: Guest; stats: GuestStats } }
  | { type: 'guest:updated'; payload: { guest: Guest; stats: GuestStats } }
  | { type: 'guest:deleted'; payload: { id: number; stats: GuestStats } }
  | { type: 'gallery:updated'; payload: GalleryItem[] }
  | { type: 'gift_accounts:updated'; payload: GiftAccount[] }
  | { type: 'gift:created'; payload: GiftConfirmation }
  | { type: 'gift:deleted'; payload: { id: number } }
  | { type: 'settings:updated'; payload: WeddingSettings };
