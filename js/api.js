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
      let errJson = null;
      try {
        errJson = await res.json();
      } catch (e) {
        /* JSON olmayan gövde — aşağıda statusText'e düşülecek */
      }
      const message = (errJson && errJson.message) || "";
      const details = (errJson && errJson.details) || "";

      // Bir INSERT/UPDATE, oturumdaki kullanıcının artık veritabanında
      // olmayan bir id'sini (ör. currentUser.id) bir FK kolonuna yazmaya
      // çalıştığında Postgres bu şekilde reddediyor — canlı veritabanı
      // NEON_TAM_KURULUM.sql ile tamamen sıfırlanıp yeniden kurulduğunda
      // (ya da kullanıcı silindiğinde) tarayıcıda önbelleğe alınmış eski
      // bir oturumla gerçekleşebilir. Ham/kriptik PostgREST hatası yerine
      // görevlinin kendi başına çözebileceği net bir mesaj gösteriyoruz.
      if (res.status === 409 && /is not present in table "kullanicilar"/i.test(details)) {
        throw new Error(
          "Oturum bilgin güncel değil görünüyor (kullanıcı hesabın veritabanında bulunamadı). Lütfen çıkış yapıp tekrar giriş yap."
        );
      }

      const hint = (errJson && errJson.hint) || "";
      const detail = message || hint || details || (errJson ? JSON.stringify(errJson) : res.statusText);
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
