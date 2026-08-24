/* ============================================================
   KargoTakip — Neon Data API Ayarları
   ============================================================
   DATA_API_URL: Neon Console > Data API sayfasındaki "API URL"
   alanından kopyalayın.

   AUTH_URL: Neon'un Data API isteklerinde artık her zaman geçerli
   bir JWT şart koşması nedeniyle, anonim erişim için kullanılan
   Managed Better Auth adresidir. Aşağıda DATA_API_URL'den otomatik
   türetilir (".apirest." -> ".neonauth.", "/rest/v1" -> "/auth").
   Genelde bir şey değiştirmenize gerek yok; ancak Neon Console >
   Auth sayfasındaki "Auth URL" farklıysa AUTH_URL'i elle de
   girebilirsiniz.
   ============================================================ */
const CONFIG = {
  DATA_API_URL: "https://ep-withered-star-aybr2qce.apirest.c-5.us-east-2.aws.neon.tech/neondb/rest/v1",
  AUTH_URL: null, // null bırakılırsa DATA_API_URL'den otomatik türetilir
  
  // v5 Tema Renkleri
  THEME: {
    primary: "#6366F1",        // İndigo (Orijinal ve modern)
    primaryDark: "#4F46E5",
    secondary: "#EC4899",       // Pembe
    success: "#10B981",         // Yeşil
    warning: "#F59E0B",         // Turuncu
    danger: "#EF4444",          // Kırmızı
    info: "#06B6D4",            // Turkuaz
    dark: "#1F2937",            // Koyu gri
    light: "#F3F4F6"            // Açık gri
  },
  
  // QR Kod Ayarları
  QR_CODE: {
    size: 200,
    errorCorrection: "H"
  }
};

CONFIG.AUTH_URL =
  CONFIG.AUTH_URL ||
  CONFIG.DATA_API_URL.replace(".apirest.", ".neonauth.").replace(/\/rest\/v1\/?$/, "/auth");
