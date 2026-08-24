/* ============================================================
   KargoTakip — QR Kod İşleyici (v5)
   Her kargoya ve ürüne otomatik QR kod üretimi
   Okutma ve teslimat onayı fonksiyonları
   ============================================================ */

const QRCodeHandler = (() => {
  // js/vendor/qrcode.js (davidshimjs/kazuhikoarase qrcode-generator) tamamen
  // yerel (internetsiz) çalışır. index.html bu script'i qrcode-handler.js'den
  // önce yüklemelidir.

  function generateProductQR(kargoId, urunId) {
    // Format: kargo:{kargoId}:urun:{urunId}
    return `kargo:${kargoId}:urun:${urunId}`;
  }

  function generateKargoQR(kargoId) {
    // Format: kargo:{kargoId}  (Kargo Çıkışı sayfasındaki regex ile eşleşir)
    return `kargo:${kargoId}`;
  }

  function encodeToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function decodeFromBase64(encoded) {
    return decodeURIComponent(escape(atob(encoded)));
  }

  // Yerel QR üretimi: metni SVG olarak döndürür (harici istek yok)
  function createQRSVG(text, cellSize = 5, margin = 2) {
    if (typeof qrcode !== "function") {
      return `<div class="qr-fallback">QR kütüphanesi yüklenemedi</div>`;
    }
    const qr = qrcode(0, "M"); // 0 = otomatik boyut algılama
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(cellSize, margin);
  }

  // Kart üzerine artık QR basmıyoruz; sadece "QR'ı Göster" butonu koyuyoruz.
  // Gerçek QR, karta/butona tıklanınca modal içinde büyük gösterilir.
  function embedKargoQR(kargoId) {
    const container = document.querySelector(`[data-kargo-id="${kargoId}"] .kargo-card__barcode`);
    if (!container) return;

    container.classList.add("kargo-card__barcode--interactive");
    container.innerHTML = `
      <button type="button" class="qr-show-btn js-show-qr" data-kargo-id="${kargoId}">
        <i class='bx bx-qr-scan'></i> QR Kodu Göster
      </button>
    `;
  }

  // Ürüne QR kodu embed et (yerel SVG, ikon olarak)
  function embedProductQR(kargoId, urunId) {
    const qrText = generateProductQR(kargoId, urunId);
    const container = document.querySelector(`[data-urun-id="${urunId}"]`);
    if (!container) return;

    if (!container.querySelector(".urun-qr-icon")) {
      const wrapper = document.createElement("span");
      wrapper.className = "urun-qr-icon";
      wrapper.title = `Ürün: ${urunId}`;
      wrapper.innerHTML = createQRSVG(qrText, 2, 1);
      container.appendChild(wrapper);
    }
  }

  // Tüm kargolara QR butonu ekle
  function embedAllKargoQRs(kargoList) {
    for (const kargo of kargoList) {
      embedKargoQR(kargo.id);
    }
  }

  // Kargo QR'ını modal içinde büyük göster (karta/butona tıklanınca çağrılır)
  function showKargoQRModal(kargoId) {
    const qrText = generateKargoQR(kargoId);
    const svg = createQRSVG(qrText, 6, 2);
    const refNo = `KRG-${String(kargoId).padStart(6, "0")}`;

    UI.openModal(`
      <button class="modal-close-x" data-close-modal><i class='bx bx-x'></i></button>
      <div class="qr-modal">
        <h3>${refNo}</h3>
        <div class="qr-modal__code">${svg}</div>
        <p class="qr-modal__hint">Kargo Çıkışı ekranında bu kodu okutarak teslimatı eşleştirin.</p>
      </div>
    `, { size: "modal-box--qr" });
  }

  // Kart konteynerindeki "QR Göster" butonlarını dinle
  function bindShowQrEvents(container) {
    container.querySelectorAll(".js-show-qr").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        showKargoQRModal(btn.dataset.kargoId);
      });
    });
  }

  return {
    generateKargoQR,
    generateProductQR,
    encodeToBase64,
    decodeFromBase64,
    createQRSVG,
    embedKargoQR,
    embedProductQR,
    embedAllKargoQRs,
    showKargoQRModal,
    bindShowQrEvents
  };
})();
