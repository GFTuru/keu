{
  "name": "Keuangan Pro",
  "short_name": "Keuangan",
  "description": "Smart Finance Tracker — Catat, pantau, dan rencanakan keuanganmu",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0f172a",
  "theme_color": "#4f46e5",
  "lang": "id",
  "categories": ["finance", "productivity"],
  "icons": [
    { "src": "logo.jpg", "sizes": "192x192", "type": "image/jpeg", "purpose": "any" },
    { "src": "logo.jpg", "sizes": "512x512", "type": "image/jpeg", "purpose": "any" },
    { "src": "logo.jpg", "sizes": "192x192", "type": "image/jpeg", "purpose": "maskable" },
    { "src": "logo.jpg", "sizes": "512x512", "type": "image/jpeg", "purpose": "maskable" }
  ],
  "screenshots": [
    {
      "src": "logo.jpg",
      "sizes": "540x720",
      "type": "image/jpeg",
      "form_factor": "narrow",
      "label": "Halaman utama Keuangan Pro"
    }
  ],
  "shortcuts": [
    {
      "name": "Catat Transaksi",
      "short_name": "Catat",
      "description": "Langsung buka form catat transaksi",
      "url": "./?action=add",
      "icons": [{ "src": "logo.jpg", "sizes": "192x192" }]
    },
    {
      "name": "Lihat History",
      "short_name": "History",
      "description": "Buka riwayat transaksi",
      "url": "./?action=history",
      "icons": [{ "src": "logo.jpg", "sizes": "192x192" }]
    }
  ],
  "related_applications": [],
  "prefer_related_applications": false
}
