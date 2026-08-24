/* ============================================================
   KargoTakip — Bildirim Merkezi (v7)
   Çan ikonu + tüm bildirimleri (mesaj, kargo durumu, sistem
   uyarıları) tek panelde toplayan geçmiş listesi.

   ÖNEMLİ: Bu modül sadece OKUMA (Api.select) yapar; hiçbir
   yazma/güncelleme akışına müdahale etmez. Var olan mesajlaşma
   ve kargo işlemleri davranışları aynen çalışmaya devam eder.
   Okundu/okunmadı durumu ve geçmiş, tarayıcıda (localStorage)
   kullanıcı bazlı saklanır.
   ============================================================ */

const NotificationCenter = (() => {
  const STORAGE_PREFIX = "kt_notifs_v7_";
  const MAX_ITEMS = 100;
  const KARGO_POLL_MS = 9000;

  let currentUser = null;
  let currentRole = null;
  let notifications = [];
  let panelOpen = false;
  let kargoPollInterval = null;
  let kargoSnapshot = null; // Map<id, durum>
  let kargoSeeded = false;

  /* ---------------- Depolama ---------------- */

  function storageKey() {
    return STORAGE_PREFIX + (currentUser ? currentUser.id : "anon");
  }

  function load() {
    try {
      const raw = localStorage.getItem(storageKey());
      notifications = raw ? JSON.parse(raw) : [];
    } catch {
      notifications = [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(notifications.slice(0, MAX_ITEMS)));
    } catch {
      /* localStorage yoksa (gizli sekme vb.) sessizce geç */
    }
  }

  /* ---------------- Başlatma ---------------- */

  function init(user, role) {
    // Kullanıcı değiştiyse (yeniden giriş vb.) durumu sıfırla
    if (currentUser && currentUser.id !== user.id) {
      kargoSnapshot = null;
      kargoSeeded = false;
    }
    currentUser = user;
    currentRole = role;
    load();
    ensureHosts();
    bindBellButtons();
    renderBellBadges();

    if (kargoPollInterval) clearInterval(kargoPollInterval);
    pollKargoChanges();
    kargoPollInterval = setInterval(pollKargoChanges, KARGO_POLL_MS);
  }

  function ensureHosts() {
    if (!document.getElementById("notif-panel-host")) {
      const host = document.createElement("div");
      host.id = "notif-panel-host";
      document.body.appendChild(host);
    }
  }

  function bindBellButtons() {
    document.querySelectorAll(".notif-bell-btn").forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", togglePanel);
    });
  }

  /* ---------------- Bildirim ekleme ---------------- */

  /**
   * type: 'mesaj' | 'kargo' | 'sistem'
   * meta.dedupeKey verilirse aynı anahtarla ikinci kez eklenmez
   * (örn. aynı mesaj / aynı kargo olayı iki kez listelenmesin diye).
   */
  function push(type, title, body, meta = {}) {
    const id = meta.dedupeKey || `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (notifications.some((n) => n.id === id)) return;
    notifications.unshift({
      id,
      type,
      title,
      body: body || "",
      time: new Date().toISOString(),
      read: false,
      nav: meta.nav || null
    });
    notifications = notifications.slice(0, MAX_ITEMS);
    persist();
    renderBellBadges(true);
    if (panelOpen) renderList();
  }

  function unreadCount() {
    return notifications.filter((n) => !n.read).length;
  }

  /* ---------------- Kargo durumu izleyici ---------------- */
  /* Sadece "kargolar" tablosunu okuyup önceki anlık görüntüyle
     karşılaştırır; hiçbir satırı değiştirmez. */

  async function pollKargoChanges() {
    if (!currentUser || typeof Api === "undefined") return;
    try {
      const rows = await Api.select(
        "kargolar",
        "select=id,durum,alici_ad_soyad,kargo_firmasi,ekleyen_kullanici_id&order=id.desc&limit=60"
      );
      const nextSnapshot = new Map(rows.map((r) => [r.id, r.durum]));

      if (!kargoSeeded) {
        // İlk çalıştırma: sadece anlık görüntüyü al, geçmişe dönük bildirim üretme
        kargoSnapshot = nextSnapshot;
        kargoSeeded = true;
        return;
      }

      rows.forEach((r) => {
        const prevDurum = kargoSnapshot ? kargoSnapshot.get(r.id) : undefined;
        const alici = r.alici_ad_soyad || "Bir alıcı";

        if (prevDurum === undefined) {
          // Yeni eklenmiş kargo — sadece admin'e bildirim (depo zaten kendi ekliyor)
          if (currentRole === "admin") {
            push(
              "kargo",
              "Yeni kargo eklendi",
              `${alici} — ${r.kargo_firmasi || "Kargo"} (${r.durum || "Paketlendi"})`,
              { dedupeKey: `kargo-new-${r.id}`, nav: "kargolar" }
            );
          }
        } else if (prevDurum !== "Teslim Edildi" && r.durum === "Teslim Edildi") {
          push(
            "kargo",
            "Kargo teslim edildi",
            `${alici} adlı alıcının kargosu teslim edildi olarak işaretlendi.`,
            { dedupeKey: `kargo-delivered-${r.id}`, nav: "kargolar" }
          );
        }
      });

      kargoSnapshot = nextSnapshot;
    } catch {
      /* bağlantı sorunu kullanıcıyı rahatsız etmesin, sessiz geç */
    }
  }

  /* ---------------- Çan rozeti ---------------- */

  function renderBellBadges(animate) {
    const count = unreadCount();
    document.querySelectorAll(".notif-bell-btn").forEach((btn) => {
      let badge = btn.querySelector(".notif-bell-badge");
      if (count > 0) {
        if (!badge) {
          badge = document.createElement("span");
          badge.className = "notif-bell-badge";
          btn.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
        if (animate) {
          btn.classList.remove("notif-bell-btn--ring");
          void btn.offsetWidth;
          btn.classList.add("notif-bell-btn--ring");
        }
      } else if (badge) {
        badge.remove();
      }
    });
  }

  /* ---------------- Panel (drawer) ---------------- */

  function iconFor(type) {
    if (type === "mesaj") return "bx-message-rounded-dots";
    if (type === "kargo") return "bx-package";
    return "bx-error-circle";
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function openPanel() {
    panelOpen = true;
    const host = document.getElementById("notif-panel-host");
    if (!host) return;
    host.innerHTML = `
      <div class="notif-backdrop" id="notif-backdrop"></div>
      <div class="notif-drawer" id="notif-drawer" role="dialog" aria-label="Bildirimler">
        <div class="notif-drawer__head">
          <div class="notif-drawer__title"><i class='bx bx-bell'></i> Bildirimler</div>
          <div class="notif-drawer__actions">
            <button type="button" class="notif-mark-all" id="notif-mark-all">Tümünü okundu işaretle</button>
            <button type="button" class="notif-close-btn" id="notif-close-btn" aria-label="Kapat"><i class='bx bx-x'></i></button>
          </div>
        </div>
        <div class="notif-drawer__list" id="notif-drawer-list"></div>
      </div>`;
    renderList();

    requestAnimationFrame(() => {
      document.getElementById("notif-drawer")?.classList.add("notif-drawer--open");
      document.getElementById("notif-backdrop")?.classList.add("notif-backdrop--visible");
    });

    document.getElementById("notif-backdrop")?.addEventListener("click", closePanel);
    document.getElementById("notif-close-btn")?.addEventListener("click", closePanel);
    document.getElementById("notif-mark-all")?.addEventListener("click", markAllRead);
  }

  function closePanel() {
    panelOpen = false;
    const drawer = document.getElementById("notif-drawer");
    const backdrop = document.getElementById("notif-backdrop");
    if (drawer) drawer.classList.remove("notif-drawer--open");
    if (backdrop) backdrop.classList.remove("notif-backdrop--visible");
    setTimeout(() => {
      if (!panelOpen) {
        const host = document.getElementById("notif-panel-host");
        if (host) host.innerHTML = "";
      }
    }, 260);
  }

  function renderList() {
    const listEl = document.getElementById("notif-drawer-list");
    if (!listEl) return;
    if (!notifications.length) {
      listEl.innerHTML = `
        <div class="notif-empty">
          <i class='bx bx-bell-off'></i>
          <p>Henüz bildirim yok.</p>
        </div>`;
      return;
    }
    listEl.innerHTML = notifications
      .map(
        (n) => `
        <div class="notif-item ${n.read ? "" : "notif-item--unread"}" data-id="${n.id}">
          <div class="notif-item__icon notif-item__icon--${n.type}"><i class='bx ${iconFor(n.type)}'></i></div>
          <div class="notif-item__body">
            <div class="notif-item__title">${UI.escapeHtml(n.title)}</div>
            ${n.body ? `<div class="notif-item__text">${UI.escapeHtml(n.body)}</div>` : ""}
            <div class="notif-item__time">${UI.timeAgo(n.time)}</div>
          </div>
          ${!n.read ? `<span class="notif-item__dot"></span>` : ""}
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".notif-item").forEach((el) =>
      el.addEventListener("click", () => onItemClick(el.dataset.id))
    );
  }

  function onItemClick(id) {
    const n = notifications.find((x) => x.id === id);
    if (!n) return;
    if (!n.read) {
      n.read = true;
      persist();
      renderBellBadges();
      renderList();
    }
    if (n.nav) {
      closePanel();
      const navBtn = document.querySelector(`.nav-item[data-key="${n.nav}"]`);
      if (navBtn) navBtn.click();
    }
  }

  function markAllRead() {
    if (!notifications.length) return;
    notifications.forEach((n) => (n.read = true));
    persist();
    renderBellBadges();
    renderList();
  }

  return { init, push };
})();
