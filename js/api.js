/* ============================================================
   KargoTakip — Data API (PostgREST) yardımcı fonksiyonları
   Neon Data API, PostgreSQL üzerinde otomatik REST uç noktaları
   oluşturan PostgREST uyumlu bir katmandır. Kimlik doğrulaması
   yapılmadan (Authorization header olmadan) gönderilen istekler
   Neon tarafında "anonymous" veritabanı rolü ile çalışır. Bu
   yüzden tablo izinlerini bu role GRANT etmemiz gerekir
   (bkz. NEON_KURULUM.sql).
   ============================================================ */

const Api = (() => {
  const BASE = CONFIG.DATA_API_URL.replace(/\/+$/, "");

  async function doFetch(path, options, token) {
    const headers = Object.assign(
      {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      options.headers || {}
    );
    return fetch(`${BASE}${path}`, { ...options, headers });
  }

  async function request(path, options = {}, _retried = false) {
    let token;
    try {
      token = await AuthToken.getToken();
    } catch (err) {
      throw new Error(err.message || "Neon Auth oturumu alınamadı.");
    }

    let res;
    try {
      res = await doFetch(path, options, token);
    } catch (err) {
      throw new Error(
        "Neon Data API adresine ulaşılamadı. İnternet bağlantınızı ve js/config.js içindeki DATA_API_URL değerini kontrol edin."
      );
    }

    // JWT süresi dolmuş ya da geçersizse bir kez tazeleyip tekrar dene
    if ((res.status === 401 || res.status === 403) && !_retried) {
      try {
        const freshToken = await AuthToken.getToken(true);
        res = await doFetch(path, options, freshToken);
      } catch {
        /* aşağıdaki genel hata işleyiciye düşecek */
      }
    }

    if (!res.ok) {
      let detail = "";
      try {
        const errJson = await res.json();
        detail = errJson.message || errJson.hint || JSON.stringify(errJson);
      } catch (e) {
        detail = res.statusText;
      }
      throw new Error(`API hatası (${res.status}): ${detail}`);
    }

    if (res.status === 204) return null;

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    /** SELECT — PostgREST filtre string'i (örn: "id=eq.5&select=*") ile GET isteği */
    select(table, query = "") {
      const qs = query ? `?${query}` : "";
      return request(`/${table}${qs}`, { method: "GET" });
    },

    /** INSERT — tek satır ya da satır dizisi ekler, eklenen satırları döndürür */
    insert(table, rows) {
      return request(`/${table}`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(rows)
      });
    },

    /** UPDATE — filtreye uyan satırları günceller */
    update(table, query, changes) {
      return request(`/${table}?${query}`, {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(changes)
      });
    },

    /** DELETE — filtreye uyan satırları siler */
    remove(table, query) {
      return request(`/${table}?${query}`, {
        method: "DELETE",
        headers: { Prefer: "return=representation" }
      });
    }
  };
})();
