import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Guest, GuestStats, WeddingSettings } from '../types';

function formatStatus(status: string): string {
  if (status === 'attending') return 'Hadir';
  if (status === 'not_attending') return 'Tidak Hadir';
  return 'Belum Konfirmasi';
}

export function exportGuestsToExcel(
  guests: Guest[],
  stats: GuestStats,
  coupleTitle: string,
  originUrl: string
) {
  const cleanOrigin = originUrl.replace(/\/+$/, '');
  const guestRows = guests.map((g, idx) => ({
    No: idx + 1,
    'Nama Tamu': g.name,
    'Kategori / Grup': g.group_name,
    'Telepon / WA': g.phone || '-',
    'Status Kehadiran': formatStatus(g.rsvp_status),
    'Jumlah Hadir (Pax)': g.rsvp_status === 'attending' ? g.pax_count : 0,
    Catatan: g.notes || '-',
    'Tautan Unik': `${cleanOrigin}/?tamu=${g.slug}`,
    'Waktu Konfirmasi': g.rsvp_updated_at
      ? new Date(g.rsvp_updated_at).toLocaleString('id-ID')
      : '-',
  }));

  const summaryRows = [
    { Metrik: 'Pasangan Mempelai', Nilai: coupleTitle },
    { Metrik: 'Total Undangan', Nilai: stats.total_invited },
    { Metrik: 'Konfirmasi Hadir (Undangan)', Nilai: stats.attending_count },
    { Metrik: 'Total Tamu Hadir (Pax)', Nilai: stats.total_pax_attending },
    { Metrik: 'Tidak Hadir', Nilai: stats.not_attending_count },
    { Metrik: 'Belum Konfirmasi', Nilai: stats.pending_count },
    { Metrik: 'Tanggal Ekspor', Nilai: new Date().toLocaleString('id-ID') },
  ];

  const wb = XLSX.utils.book_new();
  const wsGuests = XLSX.utils.json_to_sheet(guestRows);
  const wsSummary = XLSX.utils.json_to_sheet(summaryRows);

  wsGuests['!cols'] = [
    { wch: 5 },
    { wch: 28 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 26 },
    { wch: 44 },
    { wch: 22 },
  ];
  wsSummary['!cols'] = [{ wch: 30 }, { wch: 32 }];

  XLSX.utils.book_append_sheet(wb, wsGuests, 'Daftar Tamu');
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Ringkasan RSVP');

  const safeTitle = coupleTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  XLSX.writeFile(wb, `daftar-tamu-${safeTitle}.xlsx`);
}

export function exportGuestsToPDF(
  guests: Guest[],
  stats: GuestStats,
  coupleTitle: string
) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(28, 25, 23);
  doc.text(`Laporan Tamu & Konfirmasi Kehadiran — ${coupleTitle}`, 14, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(87, 83, 78);
  doc.text(
    `Diekspor pada ${new Date().toLocaleString('id-ID')}  |  Total Diundang: ${stats.total_invited}  |  Hadir: ${stats.attending_count} (${stats.total_pax_attending} pax)  |  Tidak Hadir: ${stats.not_attending_count}  |  Belum Konfirmasi: ${stats.pending_count}`,
    14,
    23
  );

  autoTable(doc, {
    startY: 29,
    head: [['No', 'Nama Tamu', 'Grup', 'No. HP/WA', 'Status', 'Pax', 'Catatan', 'Konfirmasi']],
    body: guests.map((g, idx) => [
      String(idx + 1),
      g.name,
      g.group_name,
      g.phone || '-',
      formatStatus(g.rsvp_status),
      String(g.rsvp_status === 'attending' ? g.pax_count : 0),
      g.notes || '-',
      g.rsvp_updated_at ? new Date(g.rsvp_updated_at).toLocaleDateString('id-ID') : '-',
    ]),
    styles: {
      fontSize: 8.5,
      cellPadding: 2.5,
      textColor: [28, 25, 23],
    },
    headStyles: {
      fillColor: [31, 78, 61],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [251, 249, 245],
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      5: { cellWidth: 14, halign: 'center' },
    },
  });

  const safeTitle = coupleTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  doc.save(`laporan-tamu-${safeTitle}.pdf`);
}

export function downloadCalendarIcs(settings: WeddingSettings) {
  const start = new Date(settings.event_date_iso);
  if (Number.isNaN(start.getTime())) return;
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Niskala Wedding//ID',
    'BEGIN:VEVENT',
    `UID:wedding-${Date.now()}@niskala`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(start)}`,
    `DTEND:${fmt(end)}`,
    `SUMMARY:Pernikahan ${settings.couple_title}`,
    `LOCATION:${settings.resepsi_venue} - ${settings.venue_address}`,
    `DESCRIPTION:Akad Nikah (${settings.akad_time}) & Resepsi (${settings.resepsi_time})`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pernikahan-${settings.couple_title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
