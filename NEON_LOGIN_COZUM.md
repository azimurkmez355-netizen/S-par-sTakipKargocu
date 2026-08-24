╔════════════════════════════════════════════════════════════════════════════╗
║           KargoTakip v5 — NEON KURULUM VE OTURUM AÇMA SORUNU ÇÖZÜMÜ        ║
║                          ✅ ÇALIŞAN AYARLAR                               ║
╚════════════════════════════════════════════════════════════════════════════╝

## 🚨 SORUN: "Kullanıcı adı, şifre veya rol hatalı" hatası

### ✅ ADIM 1: SQL Tabloları & Kullanıcılar Oluştur

1. **Neon Console** aç
2. Sol tarafta **"SQL Editor"** tıkla
3. **NEON_TAM_KURULUM.sql** dosyasının tüm içeriğini kopyala
4. SQL Editor'a yapıştır
5. **RUN** tuşuna bas (üst sağda mavi button)
6. ✅ Sonuç olarak şu mesajı göreceksin:
   ```
   Tablolar oluşturuldu
   kullanici_sayisi: 4
   ```

---

### ✅ ADIM 2: Managed Better Auth Etkinleştir

⚠️ **ÇOOK ÖNEMLİ ADIM** (Bunları yapmazsan login çalışmaz!)

1. Neon Console'da sol menüden **"Data API"** seç
2. Sağ tarafta **"Settings"** tab'ını tıkla
3. **"Authentication"** bölümünü aç
4. **"Managed Better Auth"** yanında toggle'ı **ON** yap
5. Çıkan modal'da **"Enable"** tuşunu tıkla
6. Yeşil mesaj çıkar: "✓ Managed Better Auth successfully enabled"
7. Sayfayı yenile (F5)
8. En üstte "Refresh schema cache" tuşu bas (yeşil button)
9. ✅ Yeşil mesaj: "✓ Schema cache refreshed successfully"

---

### ✅ ADIM 3: API URL Kontrol Et

1. Neon Console > **"Data API"** > **"API"** tab
2. "API URL" bölümünde URL'i kopyala
   ```
   https://ep-morning-flower-ayb1rg5l.apirest.c-5.us-east-2.aws.neon.tech/neondb/rest/v1
   ```
3. KargoTakipV5_FIXED/js/config.js açıp 16. satırda paste et:
   ```javascript
   DATA_API_URL: "https://ep-morning-flower-ayb1rg5l.apirest.c-5.us-east-2.aws.neon.tech/neondb/rest/v1",
   ```

---

### ✅ ADIM 4: Web Sunucusunu Başlat

Terminal'de:
```bash
cd KargoTakipV5_FIXED
python3 -m http.server 8000
```

Çıktı:
```
Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...
```

---

### ✅ ADIM 5: Giriş Yap

Tarayıcı: http://localhost:8000

**Test Kullanıcıları:**

**Admin #1:**
```
Rol: Admin
Kullanıcı: admin
Şifre: admin123
```

**Admin #2:**
```
Rol: Admin
Kullanıcı: admin2
Şifre: 1234
```

**Depo Görevlisi #1:**
```
Rol: Depo Görevlisi
Kullanıcı: depo1
Şifre: depo123
```

**Depo Görevlisi #2:**
```
Rol: Depo Görevlisi
Kullanıcı: depo2
Şifre: depo456
```

---

## 🔍 HATA GİDERME

### ❌ Yine "Kullanıcı adı, şifre veya rol hatalı" çıkıyor

**Kontrol listesi:**

1. ✓ Neon'da SQL çalıştırdın mı?
   ```sql
   SELECT COUNT(*) FROM kullanicilar;
   ```
   Sonuç: 4 olmalı

2. ✓ Managed Better Auth açık mı?
   - Neon > Data API > Settings > Authentication
   - Toggle yeşil mi?

3. ✓ Schema cache refresh ettiniz mi?
   - Neon > Data API > API tab
   - "Refresh schema cache" tuşu

4. ✓ API URL doğru mu?
   - config.js'de paste ettiniz mi?
   - Aynı URL mi?

5. ✓ Browser cache temizle
   - Ctrl+Shift+Delete
   - "Cookies ve diğer site verilerini sil"
   - F5 ile yenile

6. ✓ İnternet bağlantısı var mı?

7. ✓ Console'da hata var mı?
   - F12 → Console tab
   - Kırmızı hata var mı? Oku.

### ❌ Network/CORS hatası

**Hata mesajı:**
```
Neon Auth adresine ulaşılamadı
```

**Çözüm:**
1. Dosya:// değil http://localhost:8000 ile aç
2. Managed Better Auth enabled mi?
3. Python sunucu çalışıyor mu?

### ❌ "Authentication credentials missing"

**Çözüm:**
- Refresh schema cache tıkla (Neon Console)
- Browser'ı yenile
- Managed Better Auth açık mı kontrol et

---

## ✅ BAŞARILI OTURUM AÇMANIN İŞARETLERİ

- ✅ Login sayfası açılıyor
- ✅ Admin/Depo Görevlisi kartları tıklanıyor
- ✅ Şifre göster/gizle ikonu çalışıyor (gözü tıkla)
- ✅ Giriş yapıyor
- ✅ Sidebar menüsü görünüyor
- ✅ İç sayfalar yükleniyor

---

## 📋 HIZLI KONTROL

Neon Console'dan çalıştır:

```sql
-- 1. Tablolar var mı?
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';

-- 2. Kullanıcılar oluşturuldu mu?
SELECT ad_soyad, kullanici_adi, rol FROM kullanicilar;

-- 3. Permissionlar var mı?
SELECT grantor, grantee, privilege_type 
FROM information_schema.role_table_grants 
WHERE table_name = 'kullanicilar';
```

Sonuç:
- Tablolar: ✓ kargolar, kullanicilar, mesaj_*, kargo_* vs
- Kullanıcılar: ✓ 4 tane
- Permissions: ✓ SELECT, INSERT, UPDATE, DELETE TO anonymous

---

## 🎯 ÖZET

1. ✅ SQL çalıştır (NEON_TAM_KURULUM.sql)
2. ✅ Managed Better Auth aç (Neon > Data API > Settings)
3. ✅ Schema cache refresh et
4. ✅ config.js'de API URL güncelle
5. ✅ python3 -m http.server 8000
6. ✅ http://localhost:8000 aç
7. ✅ Giriş yap

---

## 📞 DESTEK

Hala çalışmıyorsa:
1. F12 > Console'daki hatayı oku
2. Neon Console > Monitoring > Recent queries
3. SQL çıktısını kontrol et

**KargoTakip v5 — BAŞARILI KURULUM İÇİN!** 🚀
