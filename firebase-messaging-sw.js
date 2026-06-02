// ================================================================
// firebase-messaging-sw.js — Keuangan Pro Service Worker
// Versi: 2.0 (Smart Notification Engine)
// ================================================================

const SW_VERSION = '2.0.0';

// ── State internal SW ──
let state = {
  reminderEnabled:    false,
  reminderTime:       '20:00',
  morningEnabled:     false,
  morningTime:        '08:00',
  budgetAlertEnabled: false,
  hasTransactionToday: false,
  username:           '',
  budgets:            [],
  transactions:       [],
  categories:         [],
  debts:              [],
  paylaters:          [],
  goals:              [],
};

// ── Timeout handles ──
let timeouts = {
  evening:    null,
  morning:    null,
  budgetCheck: null,
  dueCheck:   null,
};

// ── Cooldown: cegah notif spam ──
// key = notif ID, value = last sent timestamp
const notifCooldown = {};
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 jam

function canNotify(id) {
  const last = notifCooldown[id] || 0;
  if (Date.now() - last > COOLDOWN_MS) { notifCooldown[id] = Date.now(); return true; }
  return false;
}

// ================================================================
// LIFECYCLE
// ================================================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// ================================================================
// MESSAGE HANDLER — menerima perintah dari halaman utama
// ================================================================
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {

    // Full state sync — dikirim setelah login / ubah settings
    case 'SYNC_STATE':
      Object.assign(state, payload);
      rescheduleAll();
      break;

    // Cek budget setelah tambah transaksi
    case 'CHECK_BUDGET':
      Object.assign(state, {
        budgets:      event.data.budgets      || state.budgets,
        transactions: event.data.transactions || state.transactions,
        categories:   event.data.categories   || state.categories,
      });
      if (state.budgetAlertEnabled) checkBudgets();
      break;

    // Cek jatuh tempo hutang / paylater
    case 'CHECK_DUE':
      Object.assign(state, {
        debts:     event.data.debts     || state.debts,
        paylaters: event.data.paylaters || state.paylaters,
      });
      checkDueDates();
      break;

    // Cek goals progress
    case 'CHECK_GOALS':
      state.goals = event.data.goals || state.goals;
      checkGoals();
      break;

    // Test notifikasi dari settings
    case 'TEST_NOTIFICATION':
      sendNotif('test', {
        title: '🔔 Keuangan Pro — Test Berhasil!',
        body:  'Notifikasi aktif dan berfungsi dengan baik ✅',
        icon:  './logo.jpg',
        badge: './logo.jpg',
        tag:   'test',
        data:  { url: './' },
      }, /* forceSkipCooldown= */ true);
      break;

    // Backward compat dengan versi lama
    case 'SCHEDULE_REMINDER':
      state.reminderEnabled        = true;
      state.reminderTime           = event.data.time || '20:00';
      state.hasTransactionToday    = event.data.hasTransactionToday || false;
      scheduleEvening();
      break;
  }
});

// Notifikasi diklik → buka/fokus ke app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus();
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// ================================================================
// RESCHEDULE ALL — dipanggil setiap kali state berubah
// ================================================================
function rescheduleAll() {
  scheduleEvening();
  scheduleMorning();
  scheduleBudgetCheck();
  scheduleDueCheck();
}

// ================================================================
// 1. EVENING REMINDER — ingatkan catat transaksi
// ================================================================
function scheduleEvening() {
  if (timeouts.evening) { clearTimeout(timeouts.evening); timeouts.evening = null; }
  if (!state.reminderEnabled) return;
  if (state.hasTransactionToday) return; // Sudah catat hari ini, skip

  const delay = msUntilTime(state.reminderTime || '20:00');
  timeouts.evening = setTimeout(() => {
    // Re-check apakah sudah ada transaksi saat notif tiba
    if (!state.hasTransactionToday) {
      const name = state.username ? `, ${state.username}` : '';
      sendNotif('evening', {
        title: `💰 Waktunya Catat Keuangan${name}!`,
        body:  'Kamu belum mencatat transaksi hari ini. Yuk catat pengeluaranmu sekarang!',
        icon:  './logo.jpg',
        badge: './logo.jpg',
        tag:   'daily-reminder',
        renotify: true,
        vibrate:  [200, 100, 200],
        actions:  [{ action: 'open', title: '📝 Catat Sekarang' }, { action: 'dismiss', title: 'Nanti Saja' }],
        data:     { url: './' },
      });
    }
    // Jadwalkan ulang untuk besok
    timeouts.evening = setTimeout(() => scheduleEvening(), 24 * 60 * 60 * 1000);
  }, delay);
}

// ================================================================
// 2. MORNING BRIEFING — ringkasan keuangan bulan berjalan
// ================================================================
function scheduleMorning() {
  if (timeouts.morning) { clearTimeout(timeouts.morning); timeouts.morning = null; }
  if (!state.morningEnabled) return;

  const delay = msUntilTime(state.morningTime || '08:00');
  timeouts.morning = setTimeout(() => {
    const now      = new Date();
    const monthStr = now.toISOString().substring(0, 7);
    const txMonth  = state.transactions.filter(t => (t.tanggal || '').startsWith(monthStr));
    const income   = txMonth.reduce((s, t) => s + (t.pemasukan || 0), 0);
    const expense  = txMonth.reduce((s, t) => s + (t.pengeluaran || 0), 0);
    const balance  = income - expense;
    const sign     = balance >= 0 ? '+' : '';
    const name     = state.username ? `Selamat pagi, ${state.username}! ` : 'Selamat pagi! ';

    sendNotif('morning', {
      title: '☀️ Ringkasan Keuangan Pagi Ini',
      body:  `${name}Bulan ini: Pemasukan ${fmtIDR(income)} · Pengeluaran ${fmtIDR(expense)} · Saldo ${sign}${fmtIDR(balance)}`,
      icon:  './logo.jpg',
      badge: './logo.jpg',
      tag:   'morning-briefing',
      renotify: true,
      data:  { url: './' },
    });

    // Jadwalkan ulang besok
    timeouts.morning = setTimeout(() => scheduleMorning(), 24 * 60 * 60 * 1000);
  }, delay);
}

// ================================================================
// 3. BUDGET ALERT — warning saat pengeluaran mendekati / melewati limit
// ================================================================
function scheduleBudgetCheck() {
  if (timeouts.budgetCheck) { clearTimeout(timeouts.budgetCheck); timeouts.budgetCheck = null; }
  if (!state.budgetAlertEnabled) return;

  // Cek setiap 2 jam
  checkBudgets();
  timeouts.budgetCheck = setInterval(() => checkBudgets(), 2 * 60 * 60 * 1000);
}

function checkBudgets() {
  if (!state.budgets.length) return;
  const monthStr = new Date().toISOString().substring(0, 7);

  state.budgets.forEach(b => {
    const spent = state.transactions
      .filter(t => (t.tanggal || '').startsWith(monthStr) && t.kategori === b.category)
      .reduce((s, t) => s + (t.pengeluaran || 0), 0);

    const pct = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    const catName = (state.categories.find(c => c.id === b.category) || { name: b.category }).name;

    if (pct >= 100 && canNotify(`budget-over-${b.category}`)) {
      sendNotif(`budget-over-${b.category}`, {
        title: '🚨 Budget Terlampaui!',
        body:  `Pengeluaran "${catName}" sudah ${fmtIDR(spent)} — melewati limit ${fmtIDR(b.amount)}.`,
        icon:  './logo.jpg', badge: './logo.jpg',
        tag:   `budget-${b.category}`, renotify: true,
        data:  { url: './' },
      });
    } else if (pct >= 80 && pct < 100 && canNotify(`budget-warn-${b.category}`)) {
      sendNotif(`budget-warn-${b.category}`, {
        title: '⚠️ Budget Hampir Habis',
        body:  `"${catName}" sudah ${Math.round(pct)}% dari limit. Sisa ${fmtIDR(b.amount - spent)}.`,
        icon:  './logo.jpg', badge: './logo.jpg',
        tag:   `budget-${b.category}`, renotify: true,
        data:  { url: './' },
      });
    }
  });
}

// ================================================================
// 4. DUE DATE REMINDER — hutang / paylater jatuh tempo
// ================================================================
function scheduleDueCheck() {
  if (timeouts.dueCheck) { clearTimeout(timeouts.dueCheck); timeouts.dueCheck = null; }
  // Cek setiap 6 jam
  checkDueDates();
  timeouts.dueCheck = setInterval(() => checkDueDates(), 6 * 60 * 60 * 1000);
}

function checkDueDates() {
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const in3days  = new Date(today); in3days.setDate(today.getDate() + 3);
  const in7days  = new Date(today); in7days.setDate(today.getDate() + 7);

  // Cek paylater (tidak ada due date, jadi tidak relevan — skip)
  // Cek debts yang punya tanggal
  (state.debts || []).forEach(d => {
    if (!d.tanggal || !d.sisa) return;
    const due = new Date(d.tanggal + 'T00:00:00');
    const daysLeft = Math.round((due - today) / 86400000);

    if (daysLeft < 0 && canNotify(`debt-overdue-${d.id}`)) {
      sendNotif(`debt-overdue-${d.id}`, {
        title: '🔴 Hutang Jatuh Tempo!',
        body:  `Hutang ke "${d.nama}" sebesar ${fmtIDR(d.sisa)} sudah melewati tanggal jatuh tempo.`,
        icon:  './logo.jpg', badge: './logo.jpg', tag: `debt-${d.id}`, renotify: true,
        data:  { url: './' },
      });
    } else if (daysLeft === 0 && canNotify(`debt-today-${d.id}`)) {
      sendNotif(`debt-today-${d.id}`, {
        title: '⏰ Hutang Jatuh Tempo Hari Ini!',
        body:  `Hutang ke "${d.nama}" sebesar ${fmtIDR(d.sisa)} jatuh tempo hari ini.`,
        icon:  './logo.jpg', badge: './logo.jpg', tag: `debt-${d.id}`, renotify: true,
        data:  { url: './' },
      });
    } else if (daysLeft <= 3 && daysLeft > 0 && canNotify(`debt-soon-${d.id}`)) {
      sendNotif(`debt-soon-${d.id}`, {
        title: '📅 Pengingat Hutang',
        body:  `Hutang ke "${d.nama}" sebesar ${fmtIDR(d.sisa)} jatuh tempo ${daysLeft} hari lagi.`,
        icon:  './logo.jpg', badge: './logo.jpg', tag: `debt-${d.id}`, renotify: true,
        data:  { url: './' },
      });
    }
  });
}

// ================================================================
// 5. GOALS CELEBRATION — ketika target hampir / sudah tercapai
// ================================================================
function checkGoals() {
  (state.goals || []).forEach(g => {
    if (!g.target || !g.current) return;
    const pct = (g.current / g.target) * 100;

    if (pct >= 100 && canNotify(`goal-done-${g.id}`)) {
      sendNotif(`goal-done-${g.id}`, {
        title: '🏆 Target Impian Tercapai!',
        body:  `Selamat! Target "${g.name}" sebesar ${fmtIDR(g.target)} sudah terpenuhi!`,
        icon:  './logo.jpg', badge: './logo.jpg', tag: `goal-${g.id}`, renotify: true,
        data:  { url: './' },
      });
    } else if (pct >= 80 && pct < 100 && canNotify(`goal-near-${g.id}`)) {
      sendNotif(`goal-near-${g.id}`, {
        title: '🎯 Hampir Sampai!',
        body:  `Target "${g.name}" sudah ${Math.round(pct)}% terpenuhi. Yuk tambah tabungan!`,
        icon:  './logo.jpg', badge: './logo.jpg', tag: `goal-${g.id}`, renotify: true,
        data:  { url: './' },
      });
    }
  });
}

// ================================================================
// HELPER: kirim notifikasi via SW registration
// ================================================================
function sendNotif(id, options, forceSkipCooldown = false) {
  if (!forceSkipCooldown && !canNotify(id)) return;
  self.registration.showNotification(options.title, {
    body:             options.body || '',
    icon:             options.icon || './logo.jpg',
    badge:            options.badge || './logo.jpg',
    tag:              options.tag || id,
    renotify:         options.renotify || false,
    requireInteraction: false,
    vibrate:          options.vibrate || [150, 75, 150],
    actions:          options.actions || [],
    data:             options.data || { url: './' },
  }).catch(() => {}); // Abaikan jika permission hilang
}

// ================================================================
// HELPER: hitung ms hingga waktu HH:MM berikutnya
// ================================================================
function msUntilTime(timeStr) {
  const [h, m]   = (timeStr || '20:00').split(':').map(Number);
  const now      = new Date();
  const target   = new Date();
  target.setHours(h, m, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1); // Jadwalkan besok jika sudah lewat
  return target.getTime() - now.getTime();
}

// ================================================================
// HELPER: format IDR singkat (tanpa desimal)
// ================================================================
function fmtIDR(num) {
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(1)}jt`;
  if (num >= 1_000)     return `Rp ${(num / 1_000).toFixed(0)}rb`;
  return `Rp ${num}`;
}
