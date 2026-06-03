// ================================================================
// firebase-messaging-sw.js — Keuangan Pro Service Worker
// Versi: 3.0 (Rich Notification Engine)
// ================================================================

const SW_VERSION = '3.0.0';

// ── State internal SW ──
let state = {
  reminderEnabled:     false,
  reminderTime:        '20:00',
  morningEnabled:      false,
  morningTime:         '08:00',
  budgetAlertEnabled:  false,
  hasTransactionToday: false,
  username:            '',
  budgets:             [],
  transactions:        [],
  categories:          [],
  debts:               [],
  paylaters:           [],
  goals:               [],
};

// ── Timeout handles ──
let timeouts = {
  evening:     null,
  morning:     null,
  budgetCheck: null,
  dueCheck:    null,
};

// ── Cooldown: cegah notif spam ──
const notifCooldown = {};
const COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 jam

function canNotify(id) {
  const last = notifCooldown[id] || 0;
  if (Date.now() - last > COOLDOWN_MS) { notifCooldown[id] = Date.now(); return true; }
  return false;
}

// ================================================================
// KONTEN DINAMIS — kumpulan variasi pesan per jenis notif
// ================================================================

// Evening reminder — pilih acak tiap hari biar tidak bosen
const EVENING_MESSAGES = [
  {
    title: (name) => `📒 Eh ${name}, udah catat belum?`,
    body:  () => `Hari hampir selesai tapi catatanmu masih kosong nih. 30 detik aja, yuk!`,
  },
  {
    title: (name) => `💸 ${name}, pengeluaran hari ini kemana aja?`,
    body:  () => `Sebelum tidur, catat dulu biar besok nggak bingung saldo habis ke mana.`,
  },
  {
    title: (name) => `🌙 Recap dulu, ${name}!`,
    body:  () => `Orang kaya mencatat, orang miskin menebak. Jangan jadi yang kedua ya!`,
  },
  {
    title: (name) => `📊 ${name}, yuk tutup hari ini dengan rapi`,
    body:  () => `Belum ada transaksi tercatat hari ini. Cuma butuh semenit, kok!`,
  },
  {
    title: (name) => `💡 Pengingat malam, ${name}`,
    body:  () => `Catat pengeluaranmu sekarang sebelum lupa. Keuangan sehat dimulai dari kebiasaan kecil!`,
  },
  {
    title: (name) => `🔔 Jangan tidur dulu, ${name}!`,
    body:  () => `Transaksi hari ini belum dicatat. Rekam sekarang selagi masih ingat ya.`,
  },
];

// Morning mood berdasarkan kondisi keuangan
function getMorningMood(income, expense) {
  if (income === 0 && expense === 0) return { emoji: '📋', label: 'Mulai Catat' };
  const ratio = expense / (income || 1);
  if (ratio < 0.5)  return { emoji: '🟢', label: 'Sangat Sehat' };
  if (ratio < 0.75) return { emoji: '🟡', label: 'Cukup Baik' };
  if (ratio < 0.9)  return { emoji: '🟠', label: 'Perlu Hati-hati' };
  return { emoji: '🔴', label: 'Kritis!' };
}

// Tips keuangan acak untuk morning briefing
const MONEY_TIPS = [
  '💡 Tips: Sisihkan minimal 10% penghasilan di awal bulan sebelum dipakai.',
  '💡 Tips: Beli kebutuhan, bukan keinginan — tanya dulu "perlu atau mau?"',
  '💡 Tips: Catat sekecil apapun pengeluaranmu, biar nggak bocor halus.',
  '💡 Tips: Bandingkan harga sebelum beli, selisih kecil = hemat besar di akhir bulan.',
  '💡 Tips: Dana darurat idealnya 3–6x pengeluaran bulananmu.',
  '💡 Tips: Investasi terbaik adalah melunasi hutang berbunga tinggi dulu.',
  '💡 Tips: Buat budget per kategori agar pengeluaran lebih terkontrol.',
];

// Pesan motivasi goals berdasarkan milestone
function getGoalMotivation(pct) {
  if (pct >= 100) return [
    '🎊 Luar biasa! Kamu berhasil capai target ini. Tentukan target berikutnya!',
    '🏅 Target tercapai! Konsistensimu terbayar. Bangga sama diri sendiri ya!',
    '🥳 Selesai! Ini bukti kamu bisa kalau mau. Terus semangat!',
  ][Math.floor(Math.random() * 3)];

  if (pct >= 90) return 'Tinggal sedikit lagi! Jangan berhenti sekarang, finish line sudah kelihatan! 🏁';
  if (pct >= 80) return 'Udah 80%! Nggak jauh lagi. Tambah tabungan sedikit lagi dan kamu sampai! 💪';
  if (pct >= 50) return 'Sudah setengah jalan! Konsisten ya, kamu pasti bisa selesaikan ini. 🎯';
  return 'Progres bagus! Setiap rupiah yang ditabung membawa kamu selangkah lebih dekat. ✨';
}

// ================================================================
// LIFECYCLE
// ================================================================
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

// ================================================================
// MESSAGE HANDLER
// ================================================================
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'SYNC_STATE':
      Object.assign(state, payload);
      rescheduleAll();
      break;

    case 'CHECK_BUDGET':
      Object.assign(state, {
        budgets:      event.data.budgets      || state.budgets,
        transactions: event.data.transactions || state.transactions,
        categories:   event.data.categories   || state.categories,
      });
      if (state.budgetAlertEnabled) checkBudgets();
      break;

    case 'CHECK_DUE':
      Object.assign(state, {
        debts:     event.data.debts     || state.debts,
        paylaters: event.data.paylaters || state.paylaters,
      });
      checkDueDates();
      break;

    case 'CHECK_GOALS':
      state.goals = event.data.goals || state.goals;
      checkGoals();
      break;

    case 'TEST_NOTIFICATION':
      sendNotif('test', {
        title:   '🔔 Keuangan Pro — Notifikasi Aktif!',
        body:    'Mantap! Notifikasimu sudah aktif dan siap mengingatkanmu. ✅',
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     'test',
        vibrate: [100, 50, 100, 50, 200],
        actions: [{ action: 'open', title: '🚀 Buka App' }],
        data:    { url: './' },
      }, true);
      break;

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
// RESCHEDULE ALL
// ================================================================
function rescheduleAll() {
  scheduleEvening();
  scheduleMorning();
  scheduleBudgetCheck();
  scheduleDueCheck();
}

// ================================================================
// 1. EVENING REMINDER — pesan acak + info transaksi hari ini
// ================================================================
function scheduleEvening() {
  if (timeouts.evening) { clearTimeout(timeouts.evening); timeouts.evening = null; }
  if (!state.reminderEnabled) return;
  if (state.hasTransactionToday) return;

  const delay = msUntilTime(state.reminderTime || '20:00');
  timeouts.evening = setTimeout(() => {
    if (!state.hasTransactionToday) {
      const name = state.username || 'Kamu';

      // Hitung total pengeluaran hari ini (kalau ada yang tercatat sebagian)
      const today = new Date().toISOString().split('T')[0];
      const todayExpense = state.transactions
        .filter(t => (t.tanggal || '') === today)
        .reduce((s, t) => s + (t.pengeluaran || 0), 0);

      // Pilih pesan acak berdasarkan hari (biar konsisten dalam satu hari)
      const dayOfYear = Math.floor(Date.now() / 86400000);
      const msg = EVENING_MESSAGES[dayOfYear % EVENING_MESSAGES.length];

      const extraInfo = todayExpense > 0
        ? ` Tercatat ${fmtIDR(todayExpense)} pengeluaran hari ini, tapi sepertinya belum lengkap.`
        : '';

      sendNotif('evening', {
        title:   msg.title(name),
        body:    msg.body() + extraInfo,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     'daily-reminder',
        renotify: true,
        vibrate:  [200, 100, 200, 100, 200],
        actions:  [
          { action: 'open',    title: '📝 Catat Sekarang' },
          { action: 'dismiss', title: 'Nanti Saja'        },
        ],
        data: { url: './' },
      });
    }
    timeouts.evening = setTimeout(() => scheduleEvening(), 24 * 60 * 60 * 1000);
  }, delay);
}

// ================================================================
// 2. MORNING BRIEFING — ringkasan + mood + tips acak
// ================================================================
function scheduleMorning() {
  if (timeouts.morning) { clearTimeout(timeouts.morning); timeouts.morning = null; }
  if (!state.morningEnabled) return;

  const delay = msUntilTime(state.morningTime || '08:00');
  timeouts.morning = setTimeout(() => {
    const now      = new Date();
    const monthStr = now.toISOString().substring(0, 7);
    const txMonth  = state.transactions.filter(t => (t.tanggal || '').startsWith(monthStr));
    const income   = txMonth.reduce((s, t) => s + (t.pemasukan    || 0), 0);
    const expense  = txMonth.reduce((s, t) => s + (t.pengeluaran  || 0), 0);
    const balance  = income - expense;
    const sign     = balance >= 0 ? '+' : '';
    const name     = state.username ? `${state.username}` : 'Sobat';
    const mood     = getMorningMood(income, expense);
    const tip      = MONEY_TIPS[now.getDate() % MONEY_TIPS.length];

    // Hitung hari tersisa di bulan ini
    const lastDay    = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft   = lastDay - now.getDate();
    const dailyLeft  = daysLeft > 0 && balance > 0 ? ` · Sisa ${fmtIDR(Math.floor(balance / daysLeft))}/hari` : '';

    sendNotif('morning', {
      title:   `${mood.emoji} Selamat Pagi, ${name}! [${mood.label}]`,
      body:    `Bulan ini → Masuk: ${fmtIDR(income)} · Keluar: ${fmtIDR(expense)} · Saldo: ${sign}${fmtIDR(balance)}${dailyLeft}\n${tip}`,
      icon:    './logo.jpg',
      badge:   './logo.jpg',
      tag:     'morning-briefing',
      renotify: true,
      vibrate:  [100, 50, 100],
      actions:  [
        { action: 'open', title: '📊 Lihat Detail' },
      ],
      data: { url: './' },
    });

    timeouts.morning = setTimeout(() => scheduleMorning(), 24 * 60 * 60 * 1000);
  }, delay);
}

// ================================================================
// 3. BUDGET ALERT — detail persen + saran spesifik
// ================================================================
function scheduleBudgetCheck() {
  if (timeouts.budgetCheck) { clearTimeout(timeouts.budgetCheck); timeouts.budgetCheck = null; }
  if (!state.budgetAlertEnabled) return;

  checkBudgets();
  timeouts.budgetCheck = setInterval(() => checkBudgets(), 2 * 60 * 60 * 1000);
}

function checkBudgets() {
  if (!state.budgets.length) return;
  const now      = new Date();
  const monthStr = now.toISOString().substring(0, 7);

  // Hitung sisa hari di bulan ini untuk saran harian
  const lastDay  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(lastDay - now.getDate(), 1);

  state.budgets.forEach(b => {
    const spent = state.transactions
      .filter(t => (t.tanggal || '').startsWith(monthStr) && t.kategori === b.category)
      .reduce((s, t) => s + (t.pengeluaran || 0), 0);

    const pct     = b.amount > 0 ? (spent / b.amount) * 100 : 0;
    const catName = (state.categories.find(c => c.id === b.category) || { name: b.category }).name;
    const sisa    = b.amount - spent;

    if (pct >= 100 && canNotify(`budget-over-${b.category}`)) {
      const lebih = spent - b.amount;
      sendNotif(`budget-over-${b.category}`, {
        title:   `🚨 Budget "${catName}" Jebol!`,
        body:    `Pengeluaran ${fmtIDR(spent)} sudah melewati limit ${fmtIDR(b.amount)} sebesar ${fmtIDR(lebih)}. Tahan pengeluaran kategori ini sampai akhir bulan ya!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `budget-${b.category}`,
        renotify: true,
        vibrate:  [300, 100, 300, 100, 300],
        actions:  [
          { action: 'open',    title: '📊 Cek Budget' },
          { action: 'dismiss', title: 'Oke, Mengerti' },
        ],
        data: { url: './' },
      });

    } else if (pct >= 90 && pct < 100 && canNotify(`budget-critical-${b.category}`)) {
      const dailyMax = Math.floor(sisa / daysLeft);
      sendNotif(`budget-critical-${b.category}`, {
        title:   `🔴 "${catName}" Hampir Habis — ${Math.round(pct)}%`,
        body:    `Sisa budget tinggal ${fmtIDR(sisa)} untuk ${daysLeft} hari ke depan. Maksimal ${fmtIDR(dailyMax)}/hari agar tidak jebol!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `budget-${b.category}`,
        renotify: true,
        vibrate:  [200, 100, 200],
        actions:  [{ action: 'open', title: '📊 Lihat Budget' }],
        data:     { url: './' },
      });

    } else if (pct >= 75 && pct < 90 && canNotify(`budget-warn-${b.category}`)) {
      const dailyMax = Math.floor(sisa / daysLeft);
      sendNotif(`budget-warn-${b.category}`, {
        title:   `⚠️ Budget "${catName}" ${Math.round(pct)}% Terpakai`,
        body:    `Sudah ${fmtIDR(spent)} dari ${fmtIDR(b.amount)}. Sisa ${fmtIDR(sisa)} untuk ${daysLeft} hari — sekitar ${fmtIDR(dailyMax)}/hari.`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `budget-${b.category}`,
        renotify: true,
        vibrate:  [150, 75, 150],
        actions:  [{ action: 'open', title: '📊 Lihat Budget' }],
        data:     { url: './' },
      });
    }
  });
}

// ================================================================
// 4. DUE DATE REMINDER — lebih dramatis & informatif
// ================================================================
function scheduleDueCheck() {
  if (timeouts.dueCheck) { clearTimeout(timeouts.dueCheck); timeouts.dueCheck = null; }
  checkDueDates();
  timeouts.dueCheck = setInterval(() => checkDueDates(), 6 * 60 * 60 * 1000);
}

function checkDueDates() {
  const today = new Date(); today.setHours(0, 0, 0, 0);

  (state.debts || []).forEach(d => {
    if (!d.tanggal || !d.sisa) return;
    const due      = new Date(d.tanggal + 'T00:00:00');
    const daysLeft = Math.round((due - today) / 86400000);
    const tipeLabel = d.tipe === 'utang' ? 'Hutang' : 'Piutang';
    const tipeEmoji = d.tipe === 'utang' ? '🔴' : '🟢';

    if (daysLeft < 0 && canNotify(`debt-overdue-${d.id}`)) {
      const hariLewat = Math.abs(daysLeft);
      sendNotif(`debt-overdue-${d.id}`, {
        title:   `${tipeEmoji} ${tipeLabel} ke "${d.nama}" TELAT ${hariLewat} Hari!`,
        body:    `${fmtIDR(d.sisa)} sudah melewati jatuh tempo sejak ${hariLewat} hari lalu. Segera selesaikan sebelum makin lama!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `debt-${d.id}`,
        renotify: true,
        vibrate:  [400, 200, 400, 200, 400],
        actions:  [
          { action: 'open',    title: '💸 Bayar Sekarang' },
          { action: 'dismiss', title: 'Nanti'             },
        ],
        data: { url: './' },
      });

    } else if (daysLeft === 0 && canNotify(`debt-today-${d.id}`)) {
      sendNotif(`debt-today-${d.id}`, {
        title:   `⏰ ${tipeLabel} "${d.nama}" — HARI INI!`,
        body:    `${fmtIDR(d.sisa)} jatuh tempo hari ini. Jangan sampai telat ya, segera lunasi sekarang!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `debt-${d.id}`,
        renotify: true,
        vibrate:  [300, 100, 300],
        actions:  [
          { action: 'open',    title: '💸 Bayar Sekarang' },
          { action: 'dismiss', title: 'Nanti'             },
        ],
        data: { url: './' },
      });

    } else if (daysLeft === 1 && canNotify(`debt-tomorrow-${d.id}`)) {
      sendNotif(`debt-tomorrow-${d.id}`, {
        title:   `📅 ${tipeLabel} "${d.nama}" — Besok Jatuh Tempo!`,
        body:    `${fmtIDR(d.sisa)} harus dibayar besok. Siapkan dananya dari sekarang biar nggak panik!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `debt-${d.id}`,
        renotify: true,
        vibrate:  [200, 100, 200],
        actions:  [{ action: 'open', title: '📋 Lihat Detail' }],
        data:     { url: './' },
      });

    } else if (daysLeft <= 3 && daysLeft > 1 && canNotify(`debt-soon-${d.id}`)) {
      sendNotif(`debt-soon-${d.id}`, {
        title:   `📅 ${tipeLabel} "${d.nama}" — ${daysLeft} Hari Lagi`,
        body:    `${fmtIDR(d.sisa)} jatuh tempo ${daysLeft} hari lagi. Pastikan saldo kamu cukup ya!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `debt-${d.id}`,
        renotify: true,
        vibrate:  [150, 75, 150],
        actions:  [{ action: 'open', title: '📋 Lihat Detail' }],
        data:     { url: './' },
      });

    } else if (daysLeft <= 7 && daysLeft > 3 && canNotify(`debt-week-${d.id}`)) {
      sendNotif(`debt-week-${d.id}`, {
        title:   `🗓️ Pengingat: ${tipeLabel} "${d.nama}"`,
        body:    `${fmtIDR(d.sisa)} jatuh tempo ${daysLeft} hari lagi (${formatTanggal(d.tanggal)}). Mulai siapkan dari sekarang!`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `debt-${d.id}`,
        renotify: true,
        vibrate:  [100, 50, 100],
        actions:  [{ action: 'open', title: '📋 Lihat Detail' }],
        data:     { url: './' },
      });
    }
  });
}

// ================================================================
// 5. GOALS — motivasi berbeda tiap milestone
// ================================================================
function checkGoals() {
  (state.goals || []).forEach(g => {
    if (!g.target || g.current == null) return;
    const pct = (g.current / g.target) * 100;

    if (pct >= 100 && canNotify(`goal-done-${g.id}`)) {
      sendNotif(`goal-done-${g.id}`, {
        title:   `🏆 TARGET TERCAPAI — ${g.icon || '🎯'} ${g.name}!`,
        body:    getGoalMotivation(100),
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `goal-${g.id}`,
        renotify: true,
        vibrate:  [100, 50, 100, 50, 100, 50, 300],
        actions:  [
          { action: 'open', title: '🎉 Lihat Pencapaian' },
        ],
        data: { url: './' },
      });

    } else if (pct >= 90 && pct < 100 && canNotify(`goal-90-${g.id}`)) {
      sendNotif(`goal-90-${g.id}`, {
        title:   `🏁 ${Math.round(pct)}% — Hampir Finish! ${g.icon || '🎯'} ${g.name}`,
        body:    `Kurang ${fmtIDR(g.target - g.current)} lagi! ${getGoalMotivation(pct)}`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `goal-${g.id}`,
        renotify: true,
        vibrate:  [200, 100, 200, 100, 200],
        actions:  [{ action: 'open', title: '💰 Tambah Tabungan' }],
        data:     { url: './' },
      });

    } else if (pct >= 75 && pct < 90 && canNotify(`goal-75-${g.id}`)) {
      sendNotif(`goal-75-${g.id}`, {
        title:   `🎯 ${Math.round(pct)}% Terkumpul — ${g.icon || '🎯'} ${g.name}`,
        body:    `Sudah ${fmtIDR(g.current)} dari ${fmtIDR(g.target)}. ${getGoalMotivation(pct)}`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `goal-${g.id}`,
        renotify: true,
        vibrate:  [150, 75, 150],
        actions:  [{ action: 'open', title: '💰 Tambah Tabungan' }],
        data:     { url: './' },
      });

    } else if (pct >= 50 && pct < 75 && canNotify(`goal-50-${g.id}`)) {
      sendNotif(`goal-50-${g.id}`, {
        title:   `⚡ Setengah Jalan! ${g.icon || '🎯'} ${g.name}`,
        body:    `${fmtIDR(g.current)} terkumpul dari ${fmtIDR(g.target)}. ${getGoalMotivation(pct)}`,
        icon:    './logo.jpg',
        badge:   './logo.jpg',
        tag:     `goal-${g.id}`,
        renotify: true,
        vibrate:  [100, 50, 100],
        actions:  [{ action: 'open', title: '💰 Tambah Tabungan' }],
        data:     { url: './' },
      });
    }
  });
}

// ================================================================
// HELPER: kirim notifikasi
// ================================================================
function sendNotif(id, options, forceSkipCooldown = false) {
  if (!forceSkipCooldown && !canNotify(id)) return;
  self.registration.showNotification(options.title, {
    body:               options.body    || '',
    icon:               options.icon    || './logo.jpg',
    badge:              options.badge   || './logo.jpg',
    tag:                options.tag     || id,
    renotify:           options.renotify || false,
    requireInteraction: false,
    silent:             false,
    vibrate:            options.vibrate || [150, 75, 150],
    actions:            options.actions || [],
    data:               options.data    || { url: './' },
  }).catch(() => {});
}

// ================================================================
// HELPER: hitung ms hingga waktu HH:MM berikutnya
// ================================================================
function msUntilTime(timeStr) {
  const [h, m] = (timeStr || '20:00').split(':').map(Number);
  const now    = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (now >= target) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

// ================================================================
// HELPER: format IDR singkat
// ================================================================
function fmtIDR(num) {
  if (num >= 1_000_000) return `Rp ${(num / 1_000_000).toFixed(1)}jt`;
  if (num >= 1_000)     return `Rp ${(num / 1_000).toFixed(0)}rb`;
  return `Rp ${Math.round(num)}`;
}

// ================================================================
// HELPER: format tanggal YYYY-MM-DD → "12 Jan 2025"
// ================================================================
function formatTanggal(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
