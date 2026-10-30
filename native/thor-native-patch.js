/* THOR_NATIVE_PATCH v1
 * Mostek Capacitor (Android) dla: download(), shareBlob(), window.print().
 * Wklej ten blok w <script> tuż przed </body> pliku "THOR (Web).html"
 * (workflow GitHub Actions robi to automatycznie, jeśli znacznika brak).
 *
 * Działa przez nadpisanie globalnych funkcji z głównego skryptu aplikacji:
 * wszystkie wywołania download(...), shareBlob(...) i window.print()
 * trafiają do wersji poniżej. W zwykłej przeglądarce wywoływane są
 * oryginalne funkcje — zachowanie PWA pozostaje bez zmian.
 */
(function () {
  "use strict";

  var Cap = window.Capacitor;
  var isNative = !!(Cap && typeof Cap.isNativePlatform === "function" && Cap.isNativePlatform());

  var origDownload = typeof window.download === "function" ? window.download : null;
  var origShareBlob = typeof window.shareBlob === "function" ? window.shareBlob : null;
  var origPrint = typeof window.print === "function" ? window.print.bind(window) : null;

  if (!isNative) return; /* przeglądarka: nic nie zmieniamy */

  var Plugins = Cap.Plugins || {};
  var FS = Plugins.Filesystem;
  var Share = Plugins.Share;
  var ThorPrint = Plugins.ThorPrint;

  var CACHE_DIR = "thor-share";
  var DOCS_DIR = "THOR";
  var CHUNK = 3 * 1024 * 1024; /* wielokrotność 3 B → poprawne łączenie fragmentów Base64 */
  var busy = false;

  function say(msg) {
    try { if (typeof window.toast === "function") window.toast(msg); } catch (e) { /* brak toastu */ }
  }

  function errText(e) {
    return (e && (e.message || e.errorMessage)) ? (e.message || e.errorMessage) : String(e);
  }

  function safeName(name) {
    var n = String(name || "THOR_plik").trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
    return n || "THOR_plik";
  }

  function blobPartToBase64(part) {
    return new Promise(function (resolve, reject) {
      var rd = new FileReader();
      rd.onload = function () {
        var s = String(rd.result || "");
        var i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : "");
      };
      rd.onerror = function () { reject(rd.error || new Error("Błąd odczytu danych pliku")); };
      rd.readAsDataURL(part);
    });
  }

  /* Zapis Blob → Directory.Cache fragmentami (bez jednego gigantycznego stringa Base64). */
  async function writeBlobToCache(blob, name) {
    var path = CACHE_DIR + "/" + name;
    try { await FS.deleteFile({ path: path, directory: "CACHE" }); } catch (e) { /* plik nie istniał */ }

    var uri = null;
    if (!blob.size) {
      var r0 = await FS.writeFile({ path: path, data: "", directory: "CACHE", recursive: true });
      uri = r0 && r0.uri;
    } else {
      for (var off = 0; off < blob.size; off += CHUNK) {
        var b64 = await blobPartToBase64(blob.slice(off, Math.min(off + CHUNK, blob.size)));
        if (off === 0) {
          var r = await FS.writeFile({ path: path, data: b64, directory: "CACHE", recursive: true });
          uri = r && r.uri;
        } else {
          await FS.appendFile({ path: path, data: b64, directory: "CACHE" });
        }
      }
    }
    if (!uri) uri = (await FS.getUri({ path: path, directory: "CACHE" })).uri;
    return { path: path, uri: uri };
  }

  /* Kopia trwała w publicznym folderze Dokumenty/THOR (best-effort). */
  async function copyToDocuments(cachePath, name) {
    try {
      try { await FS.mkdir({ path: DOCS_DIR, directory: "DOCUMENTS", recursive: true }); } catch (e) { /* istnieje */ }
      var target = DOCS_DIR + "/" + name;
      try { await FS.deleteFile({ path: target, directory: "DOCUMENTS" }); } catch (e) { /* nie istniał */ }
      await FS.copy({ from: cachePath, directory: "CACHE", to: target, toDirectory: "DOCUMENTS" });
      return true;
    } catch (e) {
      console.warn("THOR: kopia do Dokumentów nieudana:", errText(e));
      return false;
    }
  }

  async function openShareSheet(uri, name) {
    try {
      await Share.share({ title: name, dialogTitle: "Wyślij lub zapisz: " + name, files: [uri] });
      return "shared";
    } catch (e) {
      if (/cancel/i.test(errText(e))) return "canceled";
      throw e;
    }
  }

  async function nativeSaveAndShare(blob, name, keepCopy) {
    if (busy) { say("Poczekaj — poprzedni plik jest jeszcze przygotowywany"); return; }
    if (!FS || !Share) {
      alert("Brak wtyczek Filesystem/Share w aplikacji. Zbuduj APK ponownie.");
      return;
    }
    busy = true;
    var fname = safeName(name);
    try {
      say("Przygotowywanie pliku " + fname + "…");
      var w = await writeBlobToCache(blob, fname);
      var copied = keepCopy ? await copyToDocuments(w.path, fname) : false;
      var res = await openShareSheet(w.uri, fname);
      if (copied) say("Kopia zapisana: Dokumenty/" + DOCS_DIR + "/" + fname);
      else if (res === "shared") say("Plik udostępniono");
    } catch (e) {
      alert("Nie udało się zapisać/udostępnić pliku: " + errText(e));
    } finally {
      busy = false;
    }
  }

  /* --- podmiana funkcji aplikacji --- */

  window.download = function (blob, name) {
    nativeSaveAndShare(blob, name, true);
  };

  window.shareBlob = async function (blob, fname) {
    await nativeSaveAndShare(blob, fname, false);
  };

  window.print = function () {
    if (!ThorPrint) {
      if (origPrint) origPrint();
      return;
    }
    var sub = document.querySelector("#printarea .sub");
    var job = "THOR_Inspekcja" + (sub ? "_" + sub.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : "");
    ThorPrint.print({ jobName: safeName(job) }).catch(function (e) {
      alert("Drukowanie/PDF niedostępne: " + errText(e));
    });
  };

  /* --- dopasowania interfejsu w APK --- */

  function nativeInit() {
    /* WhatsApp: bez target=_blank WebView przekazuje adres do systemu (otwiera aplikację). */
    var wa = document.getElementById("shareWa");
    if (wa) wa.removeAttribute("target");

    /* Niektóre menedżery plików oznaczają .json jako text/plain lub octet-stream. */
    ["importFile", "pjtImportFile"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.setAttribute("accept", "application/json,text/plain,application/octet-stream,.json");
    });

    /* Prośba o trwałe przechowywanie IndexedDB. */
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* brak API */ }

    /* Sprzątanie plików tymczasowych z poprzednich sesji. */
    if (FS) FS.rmdir({ path: CACHE_DIR, directory: "CACHE", recursive: true }).catch(function () {});

    document.documentElement.classList.add("thor-native");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", nativeInit);
  else nativeInit();

  /* Dostęp do oryginałów (diagnostyka). */
  window.__thorOriginal = { download: origDownload, shareBlob: origShareBlob, print: origPrint };
})();
