# QA Lite

Minimal web tabanlı test case ve bulgu yönetim aracı.

## Çalıştırma

```cmd
npm.cmd install
run-dev.cmd
```

Frontend: http://127.0.0.1:5173  
API: http://127.0.0.1:4000

## Varsayılan Admin

Email: `admin@local.test`  
Şifre: `admin123`

## Özellikler

- Cookie tabanlı login ve Admin/Tester rolleri
- Açılışta proje listesi
- Sadece Admin rolüyle proje oluşturma
- Proje içinde text tabanlı Documentation alanı
- Proje bazlı klasör hiyerarşisi
- Test case CRUD, kopyalama, silme ve klasöre drag & drop taşıma
- Test case detayından hızlı bulgu ekleme
- Session log hissinde bulgu ekranı
- Bulgu durumu, öncelik, test case bağlantısı
- Görsel yükleme, yorum ekleme
- XLSX ve PDF export
- Bulgular için XLSX ve PDF export

## Veri Saklama

- SQLite veritabanı: `server/data/qa-lite.sqlite`
- Yüklenen görseller: `server/uploads/`
- Veritabanında görsellerin sadece URL/path bilgisi tutulur.

## Yedekleme

MVP için manuel yedekleme yeterli:

```cmd
copy server\data\qa-lite.sqlite backups\qa-lite.sqlite
```

Uzun vadede zamanlanmış backup için bu dosya ve `server/uploads/` klasörü birlikte yedeklenmeli.

## Public Hazirlik

Tamamen ucretsiz baslangic hedefi:

- Frontend: Vercel Hobby
- Database: Supabase Free (PostgreSQL)
- Dosyalar/Gorseller: Supabase Storage

Hazir yardimcilar:

- Supabase semasi: `server/supabase/schema.sql`
- Mevcut SQLite verisini Supabase seed SQL'e dokme:

```cmd
npm run export:supabase --workspace server
```

Bu komut su dosyalari uretir:

- `server/supabase/out/seed.sql`
- `server/supabase/out/uploads-manifest.json`

`seed.sql` yeni Supabase veritabanina basilabilir. `uploads-manifest.json` ise gorsel tasima kontrolu icindir.
