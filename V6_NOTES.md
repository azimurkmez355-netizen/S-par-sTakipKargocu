# KargoTakip V6 — Değişiklik Notları

Bu sürüm, V5'te bildirilen hatalar ve tasarım isteklerini giderir.

## 1) Kapalı taleplerin bildirim olarak görünmesi (js/mesajlar.js)
Sidebar'daki "Mesajlar" bildirim rozeti artık SADECE açık (aktif) taleplere
ait okunmamış mesajları sayıyor. Sorgu, `mesaj_talepleri!inner(durum)` embed
filtresiyle `durum=eq.acik` şartına bağlandı. Kapalı bir talebe yeni mesaj
gelse bile artık ne rozette ne de "yeni mesaj" toast'unda görünmüyor.
(Not: "Kapalı Talepler" sekmesini açıp o talebe bakarken görünen okunmamış
sayaç kasıtlı olarak kaldı — o, geçmişe bakarken gösterilen bir sayaç,
"bildirim" değil.)

## 2) Kargo Çıkışı ikonu görünmüyordu (js/depo.js)
Sidebar nav ikonu `bx-truck` idi; bu ikon, projenin kullandığı Boxicons
2.1.4 sürümünde (outline/regular set) MEVCUT DEĞİL — sadece dolu (solid)
`bxs-truck` var. Bu yüzden ikon alanı boş görünüyordu. `bx-qr-scan` ile
değiştirildi (sayfanın QR okutma temasıyla da örtüşüyor).

## 3) Mesaj kutusunun 2-3 saniyede bir kendini boşaltması (js/mesajlar.js)
Kök neden: sohbet ekranı her 4 saniyede bir SIRA TÜM paneli (başlık +
mesaj listesi + yazma kutusu dahil) yeniden çiziyordu. Bu da, kullanıcı
tam yazarken input elemanının yok edilip yeniden oluşturulmasına, dolayısıyla
yazılanın silinmesine ve odağın kaybolmasına yol açıyordu.
Artık `loadThread()` iki moda ayrıldı:
  - İlk açılış / talep durumu değişince → tüm panel yeniden çizilir.
  - 4 saniyelik arkaplan yenilemesi (polling) → SADECE mesaj listesi
    güncellenir, yazma kutusuna hiç dokunulmaz.

## 4) Depo Görevlileri silüet hatası — "Toprak" örneği (js/main.js)
Kök neden bulundu: `lowPolyAvatar()` içinde `(h >> 3) % 4` kullanılıyordu.
`h` değeri 2^31'i aşabilen bir hash olduğundan, JavaScript'in İŞARETLİ (signed)
`>>` operatörü bu durumda negatif bir sayı üretiyor; negatif bir dizi
indeksi de JS'te `undefined` döndürüyor. Bu da SVG `<polygon>` elemanına
`points="...undefined..."` yazılmasına ve konsol hatasına yol açıyordu.
Kullanıcı adı "top123" tam olarak bu bozuk aralığa denk geliyordu — silüetin
neden özellikle Toprak'ta bozulduğunun açıklaması bu. İŞARETSİZ `>>>`
operatörüne geçilerek kalıcı olarak düzeltildi ve onlarca farklı seed ile
(otomatik script ile) doğrulandı.

## 5) Silüet / avatar tasarımı yenilendi (js/main.js, css/style.css)
- Eski köşeli "low-poly" şekiller yerine daha yuvarlak, modern, şık bir
  baş+omuz silüeti tasarımı (yumuşak eğrili path'ler).
- Her kullanıcı için (kullanıcı adına göre) farklı ama HER ZAMAN sabit
  (deterministic) renk paleti ve ölçü — 10 farklı canlı renk paleti.
- Harf/baş harf tabanlı ("TM", "OS" gibi) ikonlar tamamen kaldırıldı:
  - Sidebar'daki oturum açan kullanıcı rozeti (main.js renderShell)
  - Admin panelindeki "Görevli Performansı" liderlik tablosu avatarları
  Artık hepsi aynı silüet üretecini kullanıyor.
- Admin için ayrı, "patron" hissi veren bir varyant eklendi: koyu/lacivert
  ton paleti, yaka/kravat detayı, altın rozet ve ince halka aksesuarı.
  Bu varyant; sidebar'da admin oturumu açıkken, mesajlaşma balonlarında
  admin'in gönderdiği mesajlarda ve depo görevlisi tarafında sohbet
  başlığında admin avatarı olarak görünür.

## 6) Mesajlaşmada silüetler (js/mesajlar.js, css/style.css)
- Her mesaj balonunda (kendi mesajlarınız hariç, karşı taraf için) küçük
  bir silüet avatarı eklendi — admin/depo ayrımına göre doğru varyant.
- Sohbet başlığında (depo tarafında), talebi açan admin'in "patron"
  silüeti görünür hale geldi.

## 7) Kargo Çıkışı — mobil modernizasyon (js/depo.js, css/style-v5.css)
- Alt kısımdaki düz sayı kutuları (Toplam Okutuldu / Teslim Edildi /
  Beklemede), uygulamanın zaten kullandığı ikonlu-renkli "mini-stat"
  kart bileşenine dönüştürüldü (tutarlı görsel dil).
- 860px altı (uygulamanın genel mobil kırılma noktası) için: daha büyük
  dokunma alanlı input/buton, yuvarlatılmış köşeli "app-like" kartlar,
  3'lü ikonlu özet şeridi, daha okunabilir Çıkış Günlüğü kartları.

## 8) Bonus: QR okutarak teslim etme özelliği bozuktu (js/depo.js)
`handleQrScan()` içinde `Api.update(table, changes, query)` parametreleri
YANLIŞ SIRADA gönderiliyordu (doğrusu `Api.update(table, query, changes)`).
Bu, QR kod okutarak bir kargoyu "Teslim Edildi" olarak işaretleme
özelliğini sessizce kırıyordu. Parametre sırası düzeltildi.

---
Değişen dosyalar: js/main.js, js/admin.js, js/depo.js, js/mesajlar.js,
css/style.css, css/style-v5.css
