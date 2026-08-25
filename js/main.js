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
    HepsiJET: { icon: "bx-package", color: "#8B5CF6", logo: "assets/kargo-logos/hepsijet.png" },
    ArasKargo: { icon: "bx-car", color: "#003399", logo: "assets/kargo-logos/aras-kargo.png" },
    PTTKargo: { icon: "bx-envelope", color: "#F5384F", logo: "assets/kargo-logos/ptt-kargo.png" }
  };

  function firmaLogoHtml(kargoFirmasi) {
    const firma = FIRMA_META[kargoFirmasi] || { icon: "bx-package", color: "#64748B" };
    return `
      <span class="firma-chip" style="--firma-color:${firma.color}" title="${UI.escapeHtml(kargoFirmasi || "")}">
        ${
          firma.logo
            ? `<img src="${firma.logo}" alt="${UI.escapeHtml(kargoFirmasi || "")}" onerror="this.parentElement.classList.add('firma-chip--fallback');this.remove();" />`
            : ""
        }
        <i class='bx ${firma.icon}'></i>
      </span>`;
  }

  // v8.4: kargolar.etiket_foto_base64 artık her satırda dolu ve büyük
  // (etiket fotoğrafı) — liste sorgularında select=* kullanmak, kargo
  // sayısı arttıkça Neon Data API'nin 10MB yanıt sınırını aşıp "response
  // is too large" hatasına yol açıyordu. Liste ekranları (Kargolarım,
  // Tüm Kargolar, Genel Bakış) artık SADECE bu sütunları çekiyor; görsel
  // alanları (etiket_foto_base64, kargo_fotograflari.foto_base64) hariç
  // tutulup, kartlarda tıklanınca tek bir kargo için ayrıca (bindKargoCardEvents
  // içindeki js-view-etiket / js-view-fotolar) yükleniyor.
  const KARGO_LIST_SELECT =
    "id,alici_ad_soyad,kargo_firmasi,durum,olusturma_tarihi,cikis_tarihi,qr_kod,teslim_eden_adi,ekleyen_kullanici_id,etiket_no,etiket_sayisi,kargo_urunleri(*),kargo_fotograflari(id)";

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
            ${kargo.etiket_sayisi > 1 ? `<span class="kargo-card__etiket-no">Etiket ${kargo.etiket_no}/${kargo.etiket_sayisi}</span>` : ""}
            <span title="${UI.formatDateTime(kargo.olusturma_tarihi)}">${UI.timeAgo(kargo.olusturma_tarihi)}</span>
          </div>
          <div class="kargo-card__barcode${kargo.etiket_foto_base64 || kargo.qr_kod ? " kargo-card__barcode--interactive" : ""}">
            ${
              kargo.etiket_foto_base64
                ? `<img src="${kargo.etiket_foto_base64}" class="js-lightbox-img" alt="Kargo etiketi (QR)" />`
                : kargo.qr_kod
                ? `<button type="button" class="kargo-card__view-btn js-view-etiket" data-kargo-id="${kargo.id}"><i class='bx bx-qr-scan'></i> Etiketi Gör</button>`
                : ""
            }
          </div>

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
                  <span class="urun-chip__ad">${u.adet && u.adet !== 1 ? `<strong>${u.adet}x</strong> ` : ""}${UI.escapeHtml(u.urun_adi)}</span>
                  ${u.sku ? `<span class="urun-chip__sku">${UI.escapeHtml(u.sku)}</span>` : ""}
                </div>`
                )
                .join("")}
            </div>

            ${
              fotolar.length && fotolar[0].foto_base64
                ? `<div class="kargo-card__fotolar">
                    ${fotolar
                      .map(
                        (f) => `<img src="${f.foto_base64}" class="js-lightbox-img" alt="Kargo fotoğrafı" />`
                      )
                      .join("")}
                  </div>`
                : fotolar.length
                ? `<button type="button" class="kargo-card__view-btn js-view-fotolar" data-kargo-id="${kargo.id}"><i class='bx bx-images'></i> ${fotolar.length} fotoğrafı gör</button>`
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
          ${
            kargo.durum === "Teslim Edildi" && kargo.teslim_eden_adi
              ? `<div class="kargo-card__teslim-eden">
                  <i class='bx bx-check-shield'></i>
                  <span><strong>${UI.escapeHtml(kargo.teslim_eden_adi)}</strong> tarafından teslim edildi — ${UI.formatDateTime(kargo.cikis_tarihi)}</span>
                </div>`
              : ""
          }
        </div>
      </div>`;
  }

  function bindKargoCardEvents(container, handlers = {}) {
    container.querySelectorAll(".js-lightbox-img").forEach((img) =>
      img.addEventListener("click", () => {
        const group = img.closest(".kargo-card__fotolar");
        if (group) {
          const imgs = Array.from(group.querySelectorAll(".js-lightbox-img"));
          openLightbox(imgs.map((el) => el.src), imgs.indexOf(img));
        } else {
          openLightbox(img.src);
        }
      })
    );
    container.querySelectorAll(".js-deliver-btn").forEach((btn) =>
      btn.addEventListener("click", () => handlers.onDeliver && handlers.onDeliver(btn.dataset.id))
    );
    container.querySelectorAll(".js-delete-btn").forEach((btn) =>
      btn.addEventListener("click", () => handlers.onDelete && handlers.onDelete(btn.dataset.id))
    );
    container.querySelectorAll(".js-view-etiket").forEach((btn) =>
      btn.addEventListener("click", () => viewKargoEtiket(btn))
    );
    container.querySelectorAll(".js-view-fotolar").forEach((btn) =>
      btn.addEventListener("click", () => viewKargoFotolar(btn))
    );
  }

  /* ---------------- Tüm Kargolar — tablo (masaüstü) + kart (mobil) (v8.17) ----
     v8.16'daki tek-satır+modal tasarımı kullanıcının "tablo gibi olsun,
     başlıklar olsun, tıklayınca modal değil satır aşağı doğru uzasın"
     geri bildirimiyle bu sürüme dönüştü. Aynı veri iki paralel şablonla
     basılıyor (.kargo-table masaüstünde, .kargo-mcards mobilde) — hangisi
     görüneceğine CSS media query karar veriyor, JS'in ekran boyutuna göre
     yeniden render etmesine gerek yok. Detay ("Ürünler" listesi, etiket/
     kargo fotoğrafları, teslim bilgisi) her ikisinde de satırın/kartın
     HEMEN ALTINDA, tıklanınca açılan gizli bir bölüm — modal yok. */

  function kargoDetailContent(kargo, opts) {
    const urunler = kargo.kargo_urunleri || [];
    const fotolar = kargo.kargo_fotograflari || [];
    return `
      <div class="kargo-detail">
        <div class="kargo-detail__col">
          <h4>Ürünler</h4>
          <div class="kargo-card__urunler">
            ${
              urunler.length
                ? urunler
                    .map(
                      (u) => `
              <div class="urun-chip">
                <span class="urun-chip__ad">${u.adet && u.adet !== 1 ? `<strong>${u.adet}x</strong> ` : ""}${UI.escapeHtml(u.urun_adi)}</span>
              </div>`
                    )
                    .join("")
                : `<p class="muted-text">Ürün bilgisi yok.</p>`
            }
          </div>
        </div>
        <div class="kargo-detail__col">
          <h4>Etiket ve Fotoğraflar</h4>
          <div class="kargo-detail__media">
            ${
              kargo.etiket_foto_base64
                ? `<img src="${kargo.etiket_foto_base64}" class="js-lightbox-img kargo-detail__thumb" alt="Kargo etiketi" />`
                : kargo.qr_kod
                ? `<button type="button" class="kargo-card__view-btn js-view-etiket" data-kargo-id="${kargo.id}"><i class='bx bx-qr-scan'></i> Etiketi Gör</button>`
                : `<p class="muted-text">Etiket yok.</p>`
            }
            ${
              fotolar.length && fotolar[0].foto_base64
                ? `<div class="kargo-card__fotolar">${fotolar
                    .map((f) => `<img src="${f.foto_base64}" class="js-lightbox-img" alt="Kargo fotoğrafı" />`)
                    .join("")}</div>`
                : fotolar.length
                ? `<button type="button" class="kargo-card__view-btn js-view-fotolar" data-kargo-id="${kargo.id}"><i class='bx bx-images'></i> ${fotolar.length} fotoğrafı gör</button>`
                : ""
            }
          </div>
        </div>
        ${
          kargo.durum === "Teslim Edildi" && kargo.teslim_eden_adi
            ? `<div class="kargo-detail__teslim"><i class='bx bx-check-shield'></i> <strong>${UI.escapeHtml(
                kargo.teslim_eden_adi
              )}</strong> tarafından teslim edildi — ${UI.formatDateTime(kargo.cikis_tarihi)}</div>`
            : ""
        }
      </div>`;
  }

  function kargoUrunOzet(kargo) {
    const urunler = kargo.kargo_urunleri || [];
    if (!urunler.length) return { adText: "-", adet: 0 };
    const adText = urunler.length === 1 ? urunler[0].urun_adi : `${urunler[0].urun_adi} +${urunler.length - 1} ürün daha`;
    const adet = urunler.reduce((sum, u) => sum + (u.adet || 1), 0);
    return { adText, adet };
  }

  function tableColCount(opts) {
    let n = 8; // firma, alıcı, ürün adı, adet, durum, paketlenme, teslim, genişlet
    if (opts.selectMode) n += 1;
    if (opts.showEkleyen) n += 1;
    if (opts.showActions) n += 1;
    return n;
  }

  /** variant "row" (masaüstü tablo hücresi): Teslim Edildi butonu her
   *  zaman DOM'da ama uygulanamıyorsa (zaten teslim edilmişse)
   *  visibility:hidden ile gizleniyor — yoksa yanındaki çöp kutusu
   *  butonu satıra göre sağa/sola kayıyordu (kullanıcının bildirdiği
   *  hizalama hatası). variant "mcard" (mobil kart): kart içinde
   *  komşu satırlarla hizalanma kaygısı yok, o yüzden orada eskisi
   *  gibi uygulanamayan buton hiç render edilmiyor. */
  function kargoActionsHtml(kargo, variant) {
    const showDeliver = kargo.durum !== "Teslim Edildi";
    if (variant === "row") {
      return `
        <button type="button" class="kargo-row__action-btn js-deliver-btn" data-id="${kargo.id}" title="Teslim edildi işaretle"${
        showDeliver ? "" : ' style="visibility:hidden" tabindex="-1" aria-hidden="true"'
      }><i class='bx bx-check'></i></button>
        <button type="button" class="kargo-row__action-btn kargo-row__action-btn--danger js-delete-btn" data-id="${kargo.id}" title="Sil"><i class='bx bx-trash'></i></button>`;
    }
    return `
      ${
        showDeliver
          ? `<button type="button" class="btn btn--sm btn--ghost js-deliver-btn" data-id="${kargo.id}" title="Teslim edildi işaretle"><i class='bx bx-check'></i><span>Teslim Edildi</span></button>`
          : ""
      }
      <button type="button" class="btn btn--sm btn--danger-ghost js-delete-btn" data-id="${kargo.id}" title="Sil"><i class='bx bx-trash'></i><span>Sil</span></button>`;
  }

  function kargoTableRowPairHtml(kargo, opts) {
    const { adText, adet } = kargoUrunOzet(kargo);
    const etiketNote = kargo.etiket_sayisi > 1 ? ` <span class="kargo-row__etiket-no">Etiket ${kargo.etiket_no}/${kargo.etiket_sayisi}</span>` : "";
    const detailId = `kargo-detail-${kargo.id}`;
    const delivered = kargo.durum === "Teslim Edildi";
    return `
      <tr class="kargo-table__row${delivered ? " kargo-table__row--delivered" : ""}" data-kargo-id="${kargo.id}">
        ${opts.selectMode ? `<td class="kargo-table__select-td"><input type="checkbox" class="kargo-row-check" data-id="${kargo.id}" /></td>` : ""}
        <td>${firmaLogoHtml(kargo.kargo_firmasi)}</td>
        <td class="kargo-table__alici"><i class='bx bx-user'></i>${UI.escapeHtml(kargo.alici_ad_soyad)}${etiketNote}</td>
        <td class="kargo-table__urun-adi"><i class='bx bx-cube'></i>${UI.escapeHtml(adText)}</td>
        <td class="kargo-table__adet">${adet}</td>
        ${opts.showEkleyen ? `<td class="kargo-table__kargocu"><i class='bx bx-id-card'></i>${UI.escapeHtml(kargo.kullanicilar?.ad_soyad || "-")}</td>` : ""}
        <td>${durumBadge(kargo.durum)}</td>
        <td class="kargo-table__tarih">${UI.formatDateTime(kargo.olusturma_tarihi)}</td>
        <td class="kargo-table__tarih">${kargo.cikis_tarihi ? UI.formatDateTime(kargo.cikis_tarihi) : "—"}</td>
        ${opts.showActions ? `<td class="kargo-table__actions">${kargoActionsHtml(kargo, "row")}</td>` : ""}
        <td class="kargo-table__expand-td">
          <button type="button" class="kargo-table__expand-btn js-row-expand" data-target="${detailId}" aria-label="Detay"><i class='bx bx-chevron-down'></i></button>
        </td>
      </tr>
      <tr class="kargo-table__detail-row" id="${detailId}" hidden>
        <td colspan="${tableColCount(opts)}">${kargoDetailContent(kargo, opts)}</td>
      </tr>`;
  }

  function kargoMobileCardHtml(kargo, opts) {
    const { adText, adet } = kargoUrunOzet(kargo);
    const etiketNote = kargo.etiket_sayisi > 1 ? `Etiket ${kargo.etiket_no}/${kargo.etiket_sayisi}` : "";
    const detailId = `kargo-mdetail-${kargo.id}`;
    const delivered = kargo.durum === "Teslim Edildi";
    return `
      <div class="kargo-mcard${delivered ? " kargo-mcard--delivered" : ""}" data-kargo-id="${kargo.id}">
        <div class="kargo-mcard__head">
          ${opts.selectMode ? `<input type="checkbox" class="kargo-row-check" data-id="${kargo.id}" />` : ""}
          ${firmaLogoHtml(kargo.kargo_firmasi)}
          <span class="kargo-mcard__alici"><i class='bx bx-user'></i>${UI.escapeHtml(kargo.alici_ad_soyad)}</span>
          ${durumBadge(kargo.durum)}
        </div>
        ${etiketNote ? `<div class="kargo-mcard__etiket-no">${etiketNote}</div>` : ""}
        <div class="kargo-mcard__grid">
          <div><span><i class='bx bx-cube'></i> Ürün</span><strong>${UI.escapeHtml(adText)}</strong></div>
          <div><span>Adet</span><strong>${adet}</strong></div>
          ${opts.showEkleyen ? `<div><span><i class='bx bx-id-card'></i> Kargocu</span><strong>${UI.escapeHtml(kargo.kullanicilar?.ad_soyad || "-")}</strong></div>` : ""}
          <div><span>Paketlenme</span><strong>${UI.formatDateTime(kargo.olusturma_tarihi)}</strong></div>
          <div><span>Teslim</span><strong>${kargo.cikis_tarihi ? UI.formatDateTime(kargo.cikis_tarihi) : "—"}</strong></div>
        </div>
        ${opts.showActions ? `<div class="kargo-mcard__actions">${kargoActionsHtml(kargo, "mcard")}</div>` : ""}
        <button type="button" class="kargo-mcard__expand-btn js-row-expand" data-target="${detailId}">
          <span>Detayları Gör</span><i class='bx bx-chevron-down'></i>
        </button>
        <div class="kargo-mcard__detail" id="${detailId}" hidden>${kargoDetailContent(kargo, opts)}</div>
      </div>`;
  }

  /** Tüm Kargolar için tablo (masaüstü) + kart listesi (mobil) — ikisi de
   *  aynı çağrıda üretiliyor, hangisinin görüneceğine CSS karar veriyor. */
  function kargoTableHtml(list, opts = {}) {
    return `
      <div class="kargo-table-wrap">
        <table class="kargo-table">
          <thead>
            <tr>
              ${opts.selectMode ? `<th class="kargo-table__select-th"></th>` : ""}
              <th>Kargo Şirketi</th>
              <th>Alıcı Adı</th>
              <th>Ürün Adı</th>
              <th>Adet</th>
              ${opts.showEkleyen ? "<th>Kargocu</th>" : ""}
              <th>Durum</th>
              <th>Paketlenme Tarihi</th>
              <th>Teslim Tarihi</th>
              ${opts.showActions ? "<th></th>" : ""}
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${list.map((k) => kargoTableRowPairHtml(k, opts)).join("")}
          </tbody>
        </table>
      </div>
      <div class="kargo-mcards">
        ${list.map((k) => kargoMobileCardHtml(k, opts)).join("")}
      </div>`;
  }

  /** list: tablonun/kartların oluşturulduğu TAM kargo dizisi. opts hem
   *  görünüm bayraklarını (showEkleyen/showActions/selectMode) hem
   *  handler'ları (onDeliver/onDelete/onSelectionChange) aynı düz
   *  nesnede taşıyor. */
  function bindKargoTableEvents(container, list, opts = {}) {
    container.querySelectorAll(".js-row-expand").forEach((btn) =>
      btn.addEventListener("click", () => {
        const target = document.getElementById(btn.dataset.target);
        if (!target) return;
        const opening = target.hasAttribute("hidden");
        if (opening) {
          target.removeAttribute("hidden");
          btn.classList.add("is-open");
          bindKargoCardEvents(target, opts); // detay içindeki lightbox/etiket/fotoğraf butonları
        } else {
          target.setAttribute("hidden", "");
          btn.classList.remove("is-open");
        }
      })
    );
    container.querySelectorAll(".js-deliver-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onDeliver && opts.onDeliver(btn.dataset.id);
      })
    );
    container.querySelectorAll(".js-delete-btn").forEach((btn) =>
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        opts.onDelete && opts.onDelete(btn.dataset.id);
      })
    );
    if (opts.selectMode && opts.onSelectionChange) {
      container.querySelectorAll(".kargo-row-check").forEach((chk) =>
        chk.addEventListener("change", () => {
          const ids = [...new Set(Array.from(container.querySelectorAll(".kargo-row-check:checked")).map((c) => c.dataset.id))];
          opts.onSelectionChange(ids);
        })
      );
    }
  }

  /* Liste sorguları artık görselleri getirmiyor (bkz. KARGO_LIST_SELECT) —
     kart üzerindeki "Etiketi Gör" / "X fotoğrafı gör" butonlarına
     tıklanınca SADECE o kargonun görsellerini isteğe bağlı çekiyoruz. */

  async function viewKargoEtiket(btn) {
    const id = btn.dataset.kargoId;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Yükleniyor...`;
    try {
      const rows = await Api.select("kargolar", `id=eq.${id}&select=etiket_foto_base64`);
      const src = rows && rows[0] && rows[0].etiket_foto_base64;
      if (src) openLightbox(src);
      else UI.toast("Etiket görseli bulunamadı.", "info");
    } catch (err) {
      UI.toast(err.message || "Görsel yüklenemedi.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  async function viewKargoFotolar(btn) {
    const id = btn.dataset.kargoId;
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Yükleniyor...`;
    try {
      const rows = await Api.select("kargolar", `id=eq.${id}&select=kargo_fotograflari(foto_base64)`);
      const fotolar = (rows && rows[0] && rows[0].kargo_fotograflari) || [];
      if (fotolar.length) openLightbox(fotolar.map((f) => f.foto_base64));
      else UI.toast("Fotoğraf bulunamadı.", "info");
    } catch (err) {
      UI.toast(err.message || "Görsel yüklenemedi.", "error");
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }

  /* ---------------- Kargo filtre çubuğu (Tüm Kargolar — admin + depo ortak) ---------------- */

  function filterKargolar(list, filters = {}) {
    let out = list;
    if (filters.durum && filters.durum !== "hepsi") out = out.filter((k) => k.durum === filters.durum);
    if (filters.firma && filters.firma !== "hepsi") out = out.filter((k) => k.kargo_firmasi === filters.firma);
    if (filters.q) {
      const q = filters.q;
      out = out.filter(
        (k) =>
          k.alici_ad_soyad.toLowerCase().includes(q) ||
          (k.kullanicilar?.ad_soyad || "").toLowerCase().includes(q)
      );
    }
    // Tarih filtresi paketlenme tarihine (olusturma_tarihi) göre; "bitis"
    // günün SONUNU kapsasın diye bir sonraki güne kadar dahil ediliyor
    // (yoksa o günün saatli kayıtları filtre dışı kalıyordu).
    if (filters.basTarih) {
      const start = new Date(filters.basTarih + "T00:00:00");
      out = out.filter((k) => new Date(k.olusturma_tarihi) >= start);
    }
    if (filters.bitTarih) {
      const end = new Date(filters.bitTarih + "T23:59:59.999");
      out = out.filter((k) => new Date(k.olusturma_tarihi) <= end);
    }
    return out;
  }

  function renderKargoFilterBar() {
    return `
      <div class="filter-bar card">
        <div class="filter-search">
          <i class='bx bx-search'></i>
          <input id="filter-q" type="text" placeholder="Alıcı veya görevli adına göre ara..." />
        </div>
        <select id="filter-durum" class="input input--select">
          <option value="hepsi">Tüm Durumlar</option>
          <option value="Paketlendi">Paketlendi</option>
          <option value="Teslim Edildi">Teslim Edildi</option>
        </select>
        <select id="filter-firma" class="input input--select">
          <option value="hepsi">Tüm Firmalar</option>
          <option value="HepsiJET">HepsiJET</option>
          <option value="ArasKargo">Aras Kargo</option>
          <option value="PTTKargo">PTT Kargo</option>
        </select>
        <div class="filter-date-range">
          <input id="filter-bas-tarih" class="input" type="date" title="Başlangıç tarihi" />
          <span>—</span>
          <input id="filter-bit-tarih" class="input" type="date" title="Bitiş tarihi" />
        </div>
      </div>`;
  }

  /** Filtre çubuğu input/select event'lerini bağlar; her değişimde
   *  onChange({q|durum|firma|basTarih|bitTarih}) çağrılır. */
  function bindKargoFilterBar(onChange) {
    document.getElementById("filter-q").addEventListener("input", (e) => {
      onChange({ q: e.target.value.toLowerCase() });
    });
    document.getElementById("filter-durum").addEventListener("change", (e) => {
      onChange({ durum: e.target.value });
    });
    document.getElementById("filter-firma").addEventListener("change", (e) => {
      onChange({ firma: e.target.value });
    });
    document.getElementById("filter-bas-tarih").addEventListener("change", (e) => {
      onChange({ basTarih: e.target.value || null });
    });
    document.getElementById("filter-bit-tarih").addEventListener("change", (e) => {
      onChange({ bitTarih: e.target.value || null });
    });
  }

  /** Tek görsel (etiket) ya da birden fazla görsel (kargo/ürün fotoğrafları)
   *  için galeri modu — ok tuşlarıyla/oklarla gezinme. Önceden sadece tek
   *  görsel destekleniyordu; "kaç fotoğraf eklersem ekleyeyim sadece 1
   *  tanesini görebiliyorum" geri bildirimi üzerine düzeltildi. */
  function openLightbox(srcOrList, startIndex) {
    const list = Array.isArray(srcOrList) ? srcOrList : [srcOrList];
    let idx = Math.max(0, Math.min(startIndex || 0, list.length - 1));

    function render() {
      UI.openModal(
        `
        <button class="modal-close-x" data-close-modal><i class='bx bx-x'></i></button>
        ${list.length > 1 ? `<div class="lightbox-counter">${idx + 1} / ${list.length}</div>` : ""}
        <img src="${list[idx]}" class="lightbox-img" alt="Kargo fotoğrafı" />
        ${
          list.length > 1
            ? `<button type="button" class="lightbox-nav lightbox-nav--prev" id="lightbox-prev" aria-label="Önceki"><i class='bx bx-chevron-left'></i></button>
               <button type="button" class="lightbox-nav lightbox-nav--next" id="lightbox-next" aria-label="Sonraki"><i class='bx bx-chevron-right'></i></button>`
            : ""
        }
      `,
        { size: "modal-box--image" }
      );
      if (list.length > 1) {
        document.getElementById("lightbox-prev").addEventListener("click", () => {
          idx = (idx - 1 + list.length) % list.length;
          render();
        });
        document.getElementById("lightbox-next").addEventListener("click", () => {
          idx = (idx + 1) % list.length;
          render();
        });
      }
    }
    render();
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
    kargoTableHtml,
    bindKargoTableEvents,
    lowPolyAvatar,
    bindKargoCardEvents,
    filterKargolar,
    renderKargoFilterBar,
    bindKargoFilterBar,
    KARGO_LIST_SELECT,
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
