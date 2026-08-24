/* ============================================================
   KargoTakip — Genel arayüz yardımcıları (toast, modal, loading)
   ============================================================ */

const UI = (() => {
  const toastHost = () => document.getElementById("toast-host");
  const modalHost = () => document.getElementById("modal-host");

  function toast(message, type = "info", timeout = 3600) {
    const host = toastHost();
    const el = document.createElement("div");
    el.className = `toast toast--${type}`;
    const icons = {
      success: "bx-check-circle",
      error: "bx-error-circle",
      info: "bx-info-circle"
    };
    el.innerHTML = `<i class='bx ${icons[type] || icons.info}'></i><span>${message}</span>`;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("toast--in"));
    setTimeout(() => {
      el.classList.remove("toast--in");
      setTimeout(() => el.remove(), 250);
    }, timeout);
  }

  function openModal(innerHtml, { size = "" } = {}) {
    const host = modalHost();
    host.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-box ${size}" role="dialog" aria-modal="true">
          ${innerHtml}
        </div>
      </div>`;
    host.classList.add("is-open");
    document.body.classList.add("no-scroll");
    host.querySelector("#modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });
    host.querySelectorAll("[data-close-modal]").forEach((btn) =>
      btn.addEventListener("click", closeModal)
    );
  }

  function closeModal() {
    const host = modalHost();
    host.classList.remove("is-open");
    document.body.classList.remove("no-scroll");
    setTimeout(() => (host.innerHTML = ""), 200);
  }

  function confirmDialog(message, onConfirm, opts = {}) {
    const title = opts.title || "Emin misiniz?";
    const confirmLabel = opts.confirmLabel || "Evet, devam et";
    const danger = opts.danger ? "btn--danger" : "btn--primary";
    openModal(`
      <div class="modal-icon ${opts.danger ? "modal-icon--danger" : ""}">
        <i class='bx ${opts.danger ? "bx-trash" : "bx-help-circle"}'></i>
      </div>
      <h3 class="modal-title">${title}</h3>
      <p class="modal-text">${message}</p>
      <div class="modal-actions">
        <button class="btn btn--ghost" data-close-modal>Vazgeç</button>
        <button class="btn ${danger}" id="modal-confirm-btn">${confirmLabel}</button>
      </div>
    `);
    document.getElementById("modal-confirm-btn").addEventListener("click", () => {
      closeModal();
      onConfirm();
    });
  }

  function setLoading(isLoading) {
    let el = document.getElementById("global-loader");
    if (isLoading) {
      if (!el) {
        el = document.createElement("div");
        el.id = "global-loader";
        el.className = "global-loader";
        el.innerHTML = `<div class="global-loader__bar"></div>`;
        document.body.appendChild(el);
      }
    } else if (el) {
      el.remove();
    }
  }

  function escapeHtml(str = "") {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function formatDateTime(iso) {
    if (!iso) return "-";
    const d = new Date(iso);
    return d.toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function timeAgo(iso) {
    if (!iso) return "-";
    const diffMs = Date.now() - new Date(iso).getTime();
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return "az önce";
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    const day = Math.floor(hr / 24);
    if (day < 7) return `${day} gün önce`;
    return formatDateTime(iso);
  }

  return { toast, openModal, closeModal, confirmDialog, setLoading, escapeHtml, formatDateTime, timeAgo };
})();
