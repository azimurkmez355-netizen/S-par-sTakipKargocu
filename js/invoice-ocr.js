/* ============================================================
   KargoTakip — Fatura OCR (v8.7)
   ------------------------------------------------------------
   Tesseract.js (js/vendor/tesseract.min.js) ile fatura fotoğrafından
   alıcı adı ve ürün satırlarını (kod/ad/adet) çıkarmaya çalışır.

   ÖNEMLİ: OCR, QR/barkod okumanın aksine hata düzeltmeli DEĞİLDİR —
   yanlış okuma sessizce olabilir (özellikle karışık harf/rakam içeren
   ürün kodlarında). Bu yüzden çıkarılan değerler HER ZAMAN normal
   form alanlarına yazılır; kaydetmeden önce görevli gözden geçirip
   düzeltmelidir. Bu bir garanti değil, zaman kazandıran bir tahmindir.

   Tesseract çekirdeği (WASM, ~3MB) ve dil verisi (tur, ~2MB) burada
   VENDOR EDİLMEDİ — repo boyutunu şişirmemek için, sadece bu özellik
   kullanılınca (Faturadan Otomatik Çek) Tesseract.js'in kendi
   varsayılan CDN'inden bir kerelik indiriliyor (tarayıcı sonraki
   kullanımlar için önbelleğe alır). QR/barkod okuma gibi çekirdek
   özellikler bundan etkilenmez, tamamen yerel/vendor kalmaya devam
   ediyor. Bu yüzden bu özellik ilk kullanımda internet gerektirir.
   ============================================================ */

const InvoiceOcr = (() => {
  let workerPromise = null;

  function ensureWorker(onProgress) {
    if (typeof Tesseract === "undefined") {
      return Promise.reject(new Error("OCR kütüphanesi yüklenemedi (js/vendor/tesseract.min.js)."));
    }
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("tur", 1, {
        logger: (m) => {
          if (onProgress && m.status === "recognizing text") onProgress(m.progress || 0);
        }
      }).catch((err) => {
        workerPromise = null; // başarısız kurulum tekrar denenebilsin
        throw err;
      });
    }
    return workerPromise;
  }

  function normalizeWord(t) {
    return (t || "").toUpperCase().replace(/[^A-ZÇĞİÖŞÜ]/g, "");
  }

  /** "SAYIN" kelimesinden sonraki ilk 2 kelimeyi alıcı adı olarak alır. */
  function extractAliciAdSoyad(words) {
    const idx = words.findIndex((w) => normalizeWord(w.text) === "SAYIN");
    if (idx === -1) return null;
    const parts = [];
    for (let i = idx + 1; i < words.length && parts.length < 2; i++) {
      const t = (words[i].text || "").trim();
      if (t) parts.push(t);
    }
    return parts.length ? parts.join(" ") : null;
  }

  /**
   * Tablo başlık satırını ("Mal Hizmet Kodu ... Miktar ..." içeren satır)
   * bulup Kodu/Miktar kelimelerinin x-konumlarından iki sütun sınırı
   * çıkarır. Tek nokta yerine ARALIK kullanılıyor — "Adı" sütunu geniş
   * olduğundan (uzun ürün adları), tek referans noktasına en yakın
   * kelimeyi seçmek sütun sınırındaki kelimeleri yanlış sütuna
   * düşürüyordu (test sırasında bulundu ve bu yaklaşımla düzeltildi).
   */
  function findColumnBoundaries(lines) {
    for (const line of lines) {
      const words = line.words || [];
      const kodu = words.find((w) => normalizeWord(w.text).includes("KODU"));
      const miktar = words.find((w) => normalizeWord(w.text).includes("MIKTAR"));
      if (kodu && miktar && kodu.bbox.x1 < miktar.bbox.x0) {
        return { koduEnd: kodu.bbox.x1, miktarStart: miktar.bbox.x0 };
      }
    }
    return null;
  }

  function classifyColumn(x0, b) {
    if (x0 < b.koduEnd) return "kodu";
    if (x0 < b.miktarStart) return "adi";
    return "miktar";
  }

  /**
   * Başlıktan sonraki satırları, "Sıra No" sütununda küçük bir tam
   * sayıyla başlayan satırlar olduğu sürece ürün satırı sayar; bu
   * örüntü kesilince (ör. "Mal Hizmet Toplam Tutarı" özet satırı)
   * taramayı durdurur.
   */
  function extractUrunler(lines, boundaries) {
    const urunler = [];
    let started = false;
    for (const line of lines) {
      const words = (line.words || []).filter((w) => (w.text || "").trim());
      if (!words.length) continue;
      const isRowStart = /^\d{1,3}$/.test(words[0].text.trim());
      if (!isRowStart) {
        if (started) break;
        continue;
      }
      started = true;
      const buckets = { kodu: [], adi: [], miktar: [] };
      for (let i = 1; i < words.length; i++) {
        buckets[classifyColumn(words[i].bbox.x0, boundaries)].push(words[i].text);
      }
      const sku = buckets.kodu.join(" ").trim();
      const urun_adi = buckets.adi.join(" ").trim();
      const miktarMatch = buckets.miktar.join(" ").match(/\d+/);
      const adet = miktarMatch ? parseInt(miktarMatch[0], 10) : 1;
      if (sku || urun_adi) urunler.push({ sku, urun_adi, adet: adet > 0 ? adet : 1 });
    }
    return urunler;
  }

  /**
   * Fatura fotoğrafından alıcı adı + ürün satırlarını çıkarmaya çalışır.
   * @param {File} file
   * @param {(progress:number)=>void} [onProgress] 0-1 arası ilerleme
   * @returns {Promise<{aliciAdSoyad:string|null, urunler:Array, headerFound:boolean}>}
   */
  async function extractFromImageFile(file, onProgress) {
    const worker = await ensureWorker(onProgress);
    const { data } = await worker.recognize(file);
    const lines = data.lines || [];
    const words = data.words || [];
    const aliciAdSoyad = extractAliciAdSoyad(words);
    const boundaries = findColumnBoundaries(lines);
    const urunler = boundaries ? extractUrunler(lines, boundaries) : [];
    return { aliciAdSoyad, urunler, headerFound: !!boundaries };
  }

  return { extractFromImageFile };
})();
