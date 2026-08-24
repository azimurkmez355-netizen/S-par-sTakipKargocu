/* ============================================================
   KargoTakip — QR Tarayıcı (v8)
   ------------------------------------------------------------
   Eski qrcode-handler.js (kendi ürettiğimiz sahte QR) tamamen
   kaldırıldı. Bunun yerine gerçek kargo etiketindeki QR'ı okuyoruz:
     1) decodeFromImageFile — etiket fotoğrafından tek seferlik okuma
        (Yeni Kargo Ekle formunda kullanılır).
     2) startLive/stopLive/resumeLive — canlı kamera taraması
        (Kargo Çıkışı ekranında kullanılır).
   js/vendor/jsqr.js (cozmo/jsQR) tamamen yerel/internetsiz çalışır;
   index.html bu script'i qr-scanner.js'den önce yüklemelidir.
   ============================================================ */

const QrScanner = (() => {
  const LIVE_MAX_DIM = 900;
  const LIVE_MIN_INTERVAL_MS = 90; // attemptBoth daha pahalı — saniyede ~11 deneme yeterli
  const FULL_DECODE_MAX_DIM = 1800; // gerçek telefon fotoğrafları (12-48MP) için üst sınır
  const PREVIEW_MAX_DIM = 1200;

  function ensureLib() {
    if (typeof jsQR !== "function") {
      throw new Error("QR kütüphanesi yüklenemedi (js/vendor/jsqr.js).");
    }
  }

  function fileToImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Görsel açılamadı."));
      };
      img.src = url;
    });
  }

  function drawToCanvas(img, maxDim) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, w, h);
    return canvas;
  }

  function decodeCanvas(canvas, inversionAttempts) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts });
    return result ? result.data : null;
  }

  /**
   * Etiket fotoğrafından QR okur. Doğruluk için tam çözünürlükte ve hem
   * normal hem ters kontrastı dener. Başarılıysa DB'ye kaydedilecek
   * küçültülmüş bir önizleme (JPEG) de üretir; başarısızsa previewDataUrl
   * null döner ve çağıran taraf kullanıcıya tekrar denemesini söyler.
   */
  async function decodeFromImageFile(file) {
    ensureLib();
    const img = await fileToImage(file);
    // Gerçek telefon fotoğrafları (12-48MP) hem yavaş hem de bazı
    // tarayıcılarda canvas piksel sınırını aşabiliyor; ayrıca aşırı
    // çözünürlük termal yazıcı QR'larında JPEG/moiré gürültüsünü
    // artırıp okumayı zorlaştırabiliyor. Üst sınır koyuyoruz.
    const fullCanvas = drawToCanvas(img, FULL_DECODE_MAX_DIM);
    const text = decodeCanvas(fullCanvas, "attemptBoth");
    if (!text) return { text: null, previewDataUrl: null };

    const previewCanvas = drawToCanvas(img, PREVIEW_MAX_DIM);
    const previewDataUrl = previewCanvas.toDataURL("image/jpeg", 0.75);
    return { text, previewDataUrl };
  }

  /* ---------------- Canlı kamera taraması ---------------- */

  let stream = null;
  let rafId = null;
  let scanCanvas = null;
  let scanCtx = null;
  let videoEl = null;
  let detecting = true;
  let onDetectCb = null;
  let lastAttemptTs = 0;

  /** Kamerayı ve tarama döngüsünü durdurur. İdempotent — güvenle tekrar çağrılabilir. */
  function stopLive() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
    videoEl = null;
    onDetectCb = null;
  }

  function tick(now) {
    if (!videoEl || !stream) return;
    const ready = videoEl.readyState >= 2 /* HAVE_CURRENT_DATA */ && videoEl.videoWidth;
    if (detecting && ready && now - lastAttemptTs >= LIVE_MIN_INTERVAL_MS) {
      lastAttemptTs = now;
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      // .scanner-video, object-fit:cover ile KARE bir kutuda gösteriliyor —
      // yani kullanıcı ekranda sadece orta kareyi görüyor. Tüm (geniş) kareyi
      // küçültüp taramak yerine, görünen kareyle AYNI orta-kare bölgeyi kırpıp
      // tarıyoruz; aksi halde QR, kullanıcının gördüğünden çok daha küçük ve
      // az pikselli bir alana sıkışıp (özellikle termal yazıcı QR'larında)
      // okunamaz hale geliyordu.
      const side = Math.min(vw, vh);
      const sx = (vw - side) / 2;
      const sy = (vh - side) / 2;
      const outSide = Math.min(side, LIVE_MAX_DIM);
      if (!scanCanvas) {
        scanCanvas = document.createElement("canvas");
        scanCtx = scanCanvas.getContext("2d", { willReadFrequently: true });
      }
      if (scanCanvas.width !== outSide) scanCanvas.width = outSide;
      if (scanCanvas.height !== outSide) scanCanvas.height = outSide;
      scanCtx.drawImage(videoEl, sx, sy, side, side, 0, 0, outSide, outSide);
      try {
        const imageData = scanCtx.getImageData(0, 0, outSide, outSide);
        const result = jsQR(imageData.data, outSide, outSide, { inversionAttempts: "attemptBoth" });
        if (result && result.data) {
          detecting = false;
          if (onDetectCb) onDetectCb(result.data);
        }
      } catch (err) {
        // Sessizce yutmuyoruz — beklenmedik bir hata varsa (ör. tarayıcıya
        // özgü bir canvas kısıtı) konsolda görünür olsun ki teşhis edilebilsin.
        console.error("QrScanner canlı tarama hatası:", err);
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  /**
   * Arka kamerayı açar ve video elementine bağlar, sürekli QR arar.
   * Bir kod bulunca onDetect(text) BİR KEZ çağrılır ve tarama duraklar;
   * çağıran taraf işini bitirince resumeLive() ile devam ettirmelidir
   * (aynı QR'ın "zaten teslim edildi" gibi bilinçli tekrar okutulabilmesi
   * için zaman bazlı debounce yerine bu yöntem tercih edildi).
   */
  async function startLive(video, onDetect) {
    ensureLib();
    stopLive();
    videoEl = video;
    onDetectCb = onDetect;
    detecting = true;
    lastAttemptTs = 0;

    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.muted = true;

    // width/height "ideal" verilmezse birçok telefon tarayıcısı düşük
    // varsayılan bir çözünürlük seçiyor (ör. 640x480) — bu da termal
    // yazıcıyla basılan yoğun/noktalı QR modüllerini okumaya yetmiyor.
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1920 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    rafId = requestAnimationFrame(tick);
  }

  /** Bir onDetect tetiklenmesinden sonra taramaya kaldığı yerden devam eder. */
  function resumeLive() {
    lastAttemptTs = 0;
    detecting = true;
  }

  // Sekme arka plana alınınca kamerayı bırak (açık kalıp pil/gizlilik
  // sorunu yaratmasın diye ek güvenlik ağı — asıl kapatma sorumluluğu
  // Depo.render()'da nav değişiminde çağrılır).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLive();
  });

  return { decodeFromImageFile, startLive, stopLive, resumeLive };
})();
