/* ============================================================
   KargoTakip — Uygulama kabuğu, yönlendirme ve ortak bileşenler
   v3: render-token korumalı geçişler (yarış durumu hatası düzeltmesi)
   ============================================================ */

const App = (() => {
  let navConfig = [];
  let onNavigateCb = null;
  let currentKey = null;
  let renderToken = 0;

  const FIRMA_META = {
    HepsiJET: { icon: "bx-package", color: "#8B5CF6" },
    ArasKargo: { icon: "bx-car", color: "#FF9F1C" },
    PTTKargo: { icon: "bx-envelope", color: "#F5384F" }
  };

  function boot() {
    const session = Auth.getSession();
    if (!session) {
      showLogin();
      return;
    }
    showApp();
    if (session.rol === "admin") Admin.mount(session);
    else Depo.mount(session);
  }

  function showLogin() {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-screen").classList.add("hidden");
  }

  function showApp() {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("app-screen").classList.remove("hidden");
  }

  /* ---------------- Shell (sidebar + topbar) ---------------- */

  function renderShell({ role, user, navItems, onNavigate }) {
    navConfig = navItems;
    onNavigateCb = onNavigate;

    document.getElementById("sidebar-role-badge").innerHTML = `
      <i class='bx ${role === "admin" ? "bx-shield-quarter" : "bx-box"}'></i>
      <span>${role === "admin" ? "Admin Paneli" : "Depo Paneli"}</span>
    `;

    document.getElementById("sidebar-nav").innerHTML = navItems
      .map(
        (item) => `
        <button class="nav-item" data-key="${item.key}">
          <span class="nav-item__icon"><i class='bx ${item.icon}'></i></span>
          <span>${item.label}</span>
        </button>`
      )
      .join("");

    document.getElementById("sidebar-user").innerHTML = `
      <div class="sidebar-user__avatar">${lowPolyAvatar(user.kullanici_adi || user.ad_soyad, 38, role === "admin")}</div>
      <div class="sidebar-user__info">
        <strong>${UI.escapeHtml(user.ad_soyad)}</strong>
        <span>@${UI.escapeHtml(user.kullanici_adi)}</span>
      </div>
    `;

    document.querySelectorAll(".nav-item").forEach((btn) =>
      btn.addEventListener("click", () => {
        onNavigateCb(btn.dataset.key);
        closeMobileSidebar();
      })
    );

    document.getElementById("logout-btn").onclick = () => Auth.logout();

    const mobileBrand = document.querySelector(".topbar-mobile__title");
    if (mobileBrand) mobileBrand.textContent = role === "admin" ? "Admin Paneli" : "Depo Paneli";

    if (typeof NotificationCenter !== "undefined") NotificationCenter.init(user, role);
  }

  function setActiveNav(key) {
    currentKey = key;
    document.querySelectorAll(".nav-item").forEach((btn) =>
      btn.classList.toggle("nav-item--active", btn.dataset.key === key)
    );
  }

  /** Sidebar'daki bir nav-item butonuna sayısal bildirim rozeti ekler/kaldırır. */
  function setNavBadge(key, count) {
    const btn = document.querySelector(`.nav-item[data-key="${key}"]`);
    if (!btn) return;
    let badge = btn.querySelector(".nav-item__badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "nav-item__badge";
        btn.appendChild(badge);
      }
      badge.textContent = count > 99 ? "99+" : String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  /**
   * Ana içerik alanını değiştirir ve yeni bir "render token" üretir.
   * Bir görünümden başka bir görünüme geçildikten SONRA tamamlanan
   * asenkron istekler (fetch) artık DOM'a yazmaya çalıştığında oluşan
   * "Cannot set properties of null" hatasını önlemek için, her görünüm
   * fonksiyonu bu token'ı saklamalı ve DOM güncellemeden önce
   * App.isCurrent(token) / App.paint(...) ile geçerliliğini kontrol
   * etmelidir.
   */
  function setContent(html) {
    renderToken += 1;
    const el = document.getElementById("view-container");
    el.innerHTML = html;
    el.classList.remove("view-fade");
    void el.offsetWidth;
    el.classList.add("view-fade");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return renderToken;
  }

  function currentToken() {
    return renderToken;
  }

  function isCurrent(token) {
    return token === renderToken;
  }

  /** id'si verilen elemente, hâlâ geçerli bir görünümdeysek innerHTML yazar. Güvenli. */
  function paint(token, id, html) {
    if (!isCurrent(token)) return false;
    const el = document.getElementById(id);
    if (!el) return false;
    el.innerHTML = html;
    return true;
  }

  function initials(name = "") {
    return name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() || "")
      .join("");
  }

  function toggleMobileSidebar() {
    document.getElementById("sidebar").classList.toggle("sidebar--open");
    document.getElementById("sidebar-backdrop").classList.toggle("is-visible");
  }

  function closeMobileSidebar() {
    document.getElementById("sidebar").classList.remove("sidebar--open");
    document.getElementById("sidebar-backdrop").classList.remove("is-visible");
  }

  /* ---------------- Ortak bileşenler ---------------- */

  function skeletonCards(n = 3) {
    return Array.from({ length: n })
      .map(() => `<div class="card kargo-card__ticket skeleton-card"></div>`)
      .join("");
  }

  function emptyState(icon, title, text) {
    return `
      <div class="empty-state">
        <i class='bx ${icon}'></i>
        <h3>${UI.escapeHtml(title)}</h3>
        <p>${UI.escapeHtml(text || "")}</p>
      </div>`;
  }

  function durumBadge(durum) {
    const isDelivered = durum === "Teslim Edildi";
    return `<span class="badge ${isDelivered ? "badge--success" : "badge--warning"}">
      <i class='bx ${isDelivered ? "bx-check-circle" : "bx-time-five"}'></i> ${durum}
    </span>`;
  }

  function refNo(id) {
    return `KRG-${String(id).padStart(6, "0")}`;
  }

  /* ---------------- Avatar üreteci (modern silüet) ---------------- */
  /* İnternet bağlantısı gerektirmeyen, isimden türetilmiş, her
     kullanıcı için farklı ama kalıcı (deterministic) modern insan
     silüeti üretir. Depo Görevlileri kartlarında, sidebar'da,
     liderlik tablosunda ve mesajlaşmada kullanılır. Admin için
     ayrı, daha "patron" hissi veren bir varyant üretilir. */

  const AVATAR_PALETTES = [
    ["#5B5FEF", "#8B8EF7"],
    ["#0EA5E9", "#7DD3FC"],
    ["#EC4899", "#F9A8D4"],
    ["#F59E0B", "#FCD34D"],
    ["#22C55E", "#86EFAC"],
    ["#8B5CF6", "#C4B5FD"],
    ["#EF4444", "#FCA5A5"],
    ["#14B8A6", "#5EEAD4"],
    ["#F43F5E", "#FDA4AF"],
    ["#0891B2", "#67E8F9"]
  ];

  const ADMIN_PALETTES = [
    ["#0F172A", "#3B4A75"],
    ["#111827", "#4B5563"],
    ["#1E1B4B", "#4C3F91"],
    ["#1C1917", "#57534E"]
  ];

  function hashStr(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h;
  }

  /**
   * seed'den türetilmiş sabit (deterministic) bir silüet avatarı üretir.
   * isAdmin=true ise: yaka/kravat detaylı ve altın rozetli, koyu/prestijli
   * renkli "patron" varyantı üretilir.
   * Not: Önceki sürümde `(h >> 3)` işareti (sign) taşıyan bir kaydırma
   * kullanıyordu; h, 2^31'i aştığında bu negatif bir sayıya dönüşüp
   * dizi dışı (undefined) bir elemana erişime (ve "Expected number,
   * undefined" konsol hatasına) yol açıyordu. Aşağıda işaretsiz `>>>`
   * kaydırması kullanılarak bu kalıcı olarak düzeltildi.
   */
  function lowPolyAvatar(seed, size = 56, isAdmin = false) {
    const s = String(seed || "kt-user");
    const h = hashStr(s);
    const uid = `av${h}${size}${isAdmin ? "a" : "u"}`;
    const palette = isAdmin
      ? ADMIN_PALETTES[h % ADMIN_PALETTES.length]
      : AVATAR_PALETTES[h % AVATAR_PALETTES.length];

    const headR = 10 + (h % 3); // 10..12
    const shoulderW = isAdmin ? 18 + ((h >>> 3) % 3) : 15 + ((h >>> 3) % 4); // taşma yok, hep tanımlı
    const rot = ((h >>> 6) % 7) - 3; // -3..3 derece
    const facetOpacity = [0.16, 0.09, 0.22, 0.06, 0.13][h % 5];
    const accent = isAdmin ? "#F5B93D" : palette[1];

    const baseY = 63;
    const shoulderTopY = 41;
    const neckY = 33;
    const headCy = 22;

    const shoulders = `
      M${32 - shoulderW},${baseY}
      L${32 - shoulderW},${shoulderTopY + 5}
      Q${32 - shoulderW},${shoulderTopY} ${32 - shoulderW + 7},${shoulderTopY - 3}
      Q32,${shoulderTopY - 7} ${32 + shoulderW - 7},${shoulderTopY - 3}
      Q${32 + shoulderW},${shoulderTopY} ${32 + shoulderW},${shoulderTopY + 5}
      L${32 + shoulderW},${baseY}
      Z`;

    const collar = isAdmin
      ? `<path d="M27,${neckY} L32,${neckY + 10} L37,${neckY} L32,${neckY + 3} Z" fill="rgba(15,15,30,0.32)" />
         <circle cx="32" cy="15" r="2.4" fill="${accent}" />`
      : "";

    return `
      <svg viewBox="0 0 64 64" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="avatar">
        <defs>
          <linearGradient id="grad-${uid}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="${palette[0]}" />
            <stop offset="1" stop-color="${palette[1]}" />
          </linearGradient>
          <clipPath id="clip-${uid}"><rect width="64" height="64" rx="16" /></clipPath>
        </defs>
        <g clip-path="url(#clip-${uid})">
          <rect width="64" height="64" fill="url(#grad-${uid})" />
          <polygon points="4,4 26,0 12,20" fill="rgba(255,255,255,${facetOpacity})" />
          <polygon points="64,64 40,50 68,40" fill="rgba(0,0,0,0.12)" />
          ${isAdmin ? `<circle cx="52" cy="12" r="4.2" fill="none" stroke="${accent}" stroke-width="1.4" opacity="0.55" />` : ""}
          <g transform="rotate(${rot} 32 34)">
            <path d="${shoulders}" fill="rgba(255,255,255,0.95)" />
            ${collar}
            <circle cx="32" cy="${headCy}" r="${headR}" fill="rgba(255,255,255,0.95)" />
          </g>
        </g>
      </svg>`;
  }

  function kargoCard(kargo, opts = {}) {
    const firma = FIRMA_META[kargo.kargo_firmasi] || { icon: "bx-package", color: "#64748B" };
    const urunler = kargo.kargo_urunleri || [];
    const fotolar = kargo.kargo_fotograflari || [];
    const ekleyenAdi = kargo.kullanicilar?.ad_soyad;

    return `
      <div class="kargo-card" data-kargo-id="${kargo.id}">
        <div class="kargo-card__ticket" style="--firma-color:${firma.color}">
          <div class="kargo-card__head">
            <div class="kargo-card__firma" style="--firma-color:${firma.color}">
              <i class='bx ${firma.icon}'></i>
              <span>${kargo.kargo_firmasi}</span>
            </div>
            ${durumBadge(kargo.durum)}
          </div>

          <div class="kargo-card__ref">
            <span>${refNo(kargo.id)}</span>
            <span title="${UI.formatDateTime(kargo.olusturma_tarihi)}">${UI.timeAgo(kargo.olusturma_tarihi)}</span>
          </div>
          <div class="kargo-card__barcode"></div>

          <div class="kargo-card__body">
            <div class="kargo-card__alici">
              <i class='bx bx-user'></i>
              <span>${UI.escapeHtml(kargo.alici_ad_soyad)}</span>
            </div>

            ${
              opts.showEkleyen && ekleyenAdi
                ? `<div class="kargo-card__ekleyen"><i class='bx bx-id-card'></i><span>${UI.escapeHtml(
                    ekleyenAdi
                  )}</span></div>`
                : ""
            }

            <div class="kargo-card__meta-row">
              <span class="kargo-card__meta-chip"><i class='bx bx-cube'></i>${urunler.length} ürün</span>
              ${
                fotolar.length
                  ? `<span class="kargo-card__meta-chip"><i class='bx bx-image'></i>${fotolar.length} fotoğraf</span>`
                  : ""
              }
            </div>

            <div class="kargo-card__urunler">
              ${urunler
                .map(
                  (u) => `
                <div class="urun-chip">
                  <span class="urun-chip__ad">${UI.escapeHtml(u.urun_adi)}</span>
                  <span class="urun-chip__sku">${UI.escapeHtml(u.sku)}</span>
                </div>`
                )
                .join("")}
            </div>

            ${
              fotolar.length
                ? `<div class="kargo-card__fotolar">
                    ${fotolar
                      .map(
                        (f) => `<img src="${f.foto_base64}" class="js-lightbox-img" alt="Kargo fotoğrafı" />`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>

          <div class="kargo-card__foot">
            <span class="kargo-card__tarih"><i class='bx bx-calendar'></i>${UI.formatDateTime(kargo.olusturma_tarihi)}</span>
            ${
              opts.showActions
                ? `<div class="kargo-card__actions">
                    ${
                      kargo.durum !== "Teslim Edildi"
                        ? `<button class="btn btn--sm btn--success js-deliver-btn" data-id="${kargo.id}"><i class='bx bx-check'></i> Teslim Edildi</button>`
                        : ""
                    }
                    <button class="btn btn--sm btn--danger-ghost js-delete-btn" data-id="${kargo.id}"><i class='bx bx-trash'></i> Sil</button>
                  </div>`
                : ""
            }
          </div>
        </div>
      </div>`;
  }

  function bindKargoCardEvents(container, handlers = {}) {
    container.querySelectorAll(".js-lightbox-img").forEach((img) =>
      img.addEventListener("click", () => openLightbox(img.src))
    );
    container.querySelectorAll(".js-deliver-btn").forEach((btn) =>
      btn.addEventListener("click", () => handlers.onDeliver && handlers.onDeliver(btn.dataset.id))
    );
    container.querySelectorAll(".js-delete-btn").forEach((btn) =>
      btn.addEventListener("click", () => handlers.onDelete && handlers.onDelete(btn.dataset.id))
    );
    // v5: Her karta QR göster butonu ekle + tıklamayı dinle (yerel, internetsiz QR)
    if (typeof QRCodeHandler !== "undefined") {
      container.querySelectorAll(".kargo-card").forEach((card) => {
        QRCodeHandler.embedKargoQR(card.dataset.kargoId);
      });
      QRCodeHandler.bindShowQrEvents(container);
    }
  }

  function openLightbox(src) {
    UI.openModal(`
      <button class="modal-close-x" data-close-modal><i class='bx bx-x'></i></button>
      <img src="${src}" class="lightbox-img" alt="Kargo fotoğrafı" />
    `, { size: "modal-box--image" });
  }

  return {
    boot,
    renderShell,
    setActiveNav,
    setNavBadge,
    setContent,
    currentToken,
    isCurrent,
    paint,
    skeletonCards,
    emptyState,
    durumBadge,
    kargoCard,
    lowPolyAvatar,
    bindKargoCardEvents,
    toggleMobileSidebar,
    closeMobileSidebar
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  Auth.initRoleSelector();
  document.getElementById("login-form").addEventListener("submit", Auth.handleLogin);
  document.getElementById("mobile-menu-btn").addEventListener("click", App.toggleMobileSidebar);
  document.getElementById("sidebar-backdrop").addEventListener("click", App.closeMobileSidebar);
  App.boot();
});
