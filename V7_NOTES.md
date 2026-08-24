# KargoTakip V7 — Değişiklik Notları

Bu sürüm SADECE tasarım (tema) ve yeni "Bildirim Merkezi" özelliğini
içerir. V6'daki hiçbir veri yazma/okuma akışı (kargo ekleme, mesajlaşma,
QR ile teslim, Neon Data API çağrıları vb.) değiştirilmedi.

## 1) Komple tema değişikliği (css/theme-v7.css — YENİ dosya)
Mevcut css/style.css ve css/style-v5.css dosyalarına DOKUNULMADI.
Bunun yerine, en sonda yüklenen yeni bir css/theme-v7.css dosyası
eklendi; bu dosya CSS değişkenlerini (renk paleti) ve birkaç
sabit (hardcoded) renk kullanan noktayı override ediyor. Böylece
görünüm komple yenilenirken hiçbir JS/HTML işlevi bozulmuyor.

- Yeni ana renk: elektrik mavi-mor (#4361EE) — eski indigo (#5B5FEF)
  yerine.
- Yeni vurgu renkleri: turuncu #FF9F1C, zümrüt yeşil #14B876,
  gül kırmızısı #F5384F, magenta #C026D3, turkuaz #00B8D9.
- Yeni "bildirim aksanı": taze turkuaz #14E0C2 (bell rozeti, aktif
  nav çizgisi, bildirim panelinde kargo ikonları).
- Sidebar: daha derin lacivert-siyah zemin + üstte ışıltılı çift
  gradyan (mavi + turkuaz), nav ikonlarına sırayla farklı canlı
  renkler, aktif menüde ince turkuaz gösterge çizgisi, hover'da
  hafif kayma animasyonu.
- Kutular (kargo kartları, form kartları, boş durum kutuları vb.):
  daha büyük border-radius (16-22px), daha yumuşak/derin gölgeler,
  hover'da hafif kalkma + ince renkli parlama halkası.
- Kargo firması rozet renkleri (js/main.js FIRMA_META, js/depo.js
  FIRMALAR) yeni paletle uyumlu hale getirildi.
- Login ekranı arka plan gradyanı ve blob renkleri yeni paletle
  eşleşecek şekilde güncellendi.
- Daha önce tanımsız olan `var(--warning)` / `var(--success)` CSS
  değişkenlerine (style-v5.css içinde kullanılıyordu ama root'ta
  tanımlı değildi) takma ad eklendi — sessizce bozuk duran birkaç
  ikon rengi de bu sayede düzelmiş oldu.

## 2) Bildirim Merkezi — çan ikonu + geçmiş (js/notifications.js — YENİ)
Sidebar'da (marka satırının sağında) ve mobil üst çubukta bir çan
ikonu eklendi. Tıklanınca sağdan açılan bir panelde şu üç tür
bildirim, en yeniden eskiye, tek listede toplanıyor:

  - **Mesaj**: Bir talebe yeni mesaj geldiğinde (mevcut "yeni mesaj"
    toast'ı ile birlikte, ona ek olarak).
  - **Kargo durumu**: Yeni bir kargo eklendiğinde (sadece admin'e —
    depo zaten kendi eklediğini biliyor) ve bir kargo "Teslim Edildi"
    olarak işaretlendiğinde (hem admin hem depo).
  - **Sistem uyarısı**: Acil bir talep yanıt beklerken (mevcut
    acil alarm/banner sistemiyle birlikte, ona ek olarak).

Çan ikonu üzerinde okunmamış sayısını gösteren kırmızı bir rozet var.
Panelde "Tümünü okundu işaretle" butonu ve her bildirime tıklayınca
ilgili ekrana (ör. Mesajlar) yönlendirme bulunuyor.

ÖNEMLİ (veri güvenliği): NotificationCenter modülü kargo durumu
tespiti için SADECE `kargolar` tablosunu periyodik olarak OKUYOR
(Api.select) ve önceki anlık görüntüyle karşılaştırıyor; hiçbir satırı
eklemiyor, güncellemiyor veya silmiyor. Yeni bir veritabanı tablosu/
migration GEREKMİYOR. Bildirim geçmişi ve okundu/okunmadı durumu
sadece tarayıcıda (localStorage, kullanıcıya özel anahtar) tutuluyor;
Neon veritabanı şemasına dokunulmadı.

## 3) main.js / mesajlar.js içindeki minimal ekler
- `App.renderShell()` içine tek satır: `NotificationCenter.init(user, role)`
  çağrısı eklendi (sidebar/topbar her çizildiğinde bildirim merkezini
  başlatır).
- `Mesajlar.pollGlobalState()` içindeki mevcut "yeni mesaj" toast
  mantığı AYNEN korunarak, yanına `NotificationCenter.push(...)`
  çağrısı eklendi.
- `Mesajlar.activateAlarm()` içinde, alarm İLK devreye girdiğinde
  (tekrarlarda değil) bir sistem bildirimi ekleniyor.

---
Değişen/eklenen dosyalar:
  YENİ  : css/theme-v7.css, js/notifications.js
  DÜZEN : index.html (CSS/script bağlantıları + çan butonları),
          js/main.js (FIRMA_META renkleri + NotificationCenter.init çağrısı),
          js/depo.js (FIRMALAR renkleri),
          js/mesajlar.js (bildirim push çağrıları),
          css/style-v5.css (--color-* değişkenleri yeni paletle güncellendi,
          diğer kurallar değişmedi)
DOKUNULMADI: css/style.css, js/admin.js, js/api.js, js/auth.js,
          js/authtoken.js, js/config.js, js/qrcode-handler.js,
          js/ui.js, js/vendor/qrcode.js — hiçbir veri yazma/okuma
          akışı değiştirilmedi.
