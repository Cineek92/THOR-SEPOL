#!/usr/bin/env node
/**
 * Konfiguruje projekt Android wygenerowany przez `npx cap add android`.
 * Uruchamiany w GitHub Actions po `cap add`, przed `cap sync`.
 * Skrypt jest idempotentny — można go uruchomić wielokrotnie.
 *
 *  - AndroidManifest.xml: uprawnienia, <uses-feature>, <queries>, largeHeap,
 *    requestLegacyExternalStorage, adjustResize.
 *  - app/build.gradle: versionCode/versionName z numeru przebiegu CI, lint bez blokowania release.
 *  - MainActivity.java: auto-grant RESOURCE_VIDEO_CAPTURE, prośba o CAMERA przy starcie,
 *    restart po awarii renderera WebView, potwierdzenie wyjścia przyciskiem Wstecz.
 *  - ThorPrintPlugin.java: window.print() → Android PrintManager (PDF / drukarka).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(process.cwd());
const ANDROID = join(ROOT, "android");
const APP = join(ANDROID, "app");
const MANIFEST = join(APP, "src", "main", "AndroidManifest.xml");
const APP_GRADLE = join(APP, "build.gradle");

function fail(msg) {
  console.error("::error::" + msg);
  process.exit(1);
}
function log(msg) {
  console.log("[configure-android] " + msg);
}

if (!existsSync(MANIFEST)) fail("Brak android/app/src/main/AndroidManifest.xml — najpierw uruchom `npx cap add android`.");

const capConfig = JSON.parse(readFileSync(join(ROOT, "capacitor.config.json"), "utf8"));
const APP_ID = capConfig.appId;
if (!/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(APP_ID)) fail("Nieprawidłowe appId: " + APP_ID);
const JAVA_DIR = join(APP, "src", "main", "java", ...APP_ID.split("."));

/* ------------------------------------------------------------------ */
/* 1. AndroidManifest.xml                                              */
/* ------------------------------------------------------------------ */
let manifest = readFileSync(MANIFEST, "utf8");

function addAttr(tagName, attr, value) {
  const re = new RegExp("<" + tagName + "(\\s[^>]*)?>", "m");
  const m = manifest.match(re);
  if (!m) fail("Nie znaleziono <" + tagName + "> w manifeście.");
  if (new RegExp("\\s" + attr.replace(":", "\\:") + "=").test(m[0])) return;
  const indent = tagName === "activity" ? "\n            " : "\n        ";
  const updated = m[0].replace("<" + tagName, "<" + tagName + indent + attr + '="' + value + '"');
  manifest = manifest.replace(m[0], updated);
  log("dodano " + attr + '="' + value + '" do <' + tagName + ">");
}

addAttr("application", "android:largeHeap", "true");
addAttr("application", "android:hardwareAccelerated", "true");
addAttr("application", "android:requestLegacyExternalStorage", "true");
addAttr("activity", "android:windowSoftInputMode", "adjustResize");

const permissions = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.FLASHLIGHT" />',
  '<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
  '<uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="32" />'
];
const features = [
  '<uses-feature android:name="android.hardware.camera" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />',
  '<uses-feature android:name="android.hardware.camera.flash" android:required="false" />'
];

const permBlock = [];
for (const p of permissions.concat(features)) {
  const name = p.match(/android:name="([^"]+)"/)[1];
  const tag = p.startsWith("<uses-feature") ? "uses-feature" : "uses-permission";
  const exists = new RegExp("<" + tag + "[^>]*android:name=\"" + name.replace(/\./g, "\\.") + "\"").test(manifest);
  if (!exists) permBlock.push("    " + p);
}

const queriesBlock = `
    <!-- THOR_QUERIES: widoczność aplikacji (Android 11+) dla aparatu, selektora plików, poczty, SMS, WhatsApp i udostępniania -->
    <queries>
        <intent>
            <action android:name="android.media.action.IMAGE_CAPTURE" />
        </intent>
        <intent>
            <action android:name="android.media.action.VIDEO_CAPTURE" />
        </intent>
        <intent>
            <action android:name="android.intent.action.GET_CONTENT" />
            <data android:mimeType="*/*" />
        </intent>
        <intent>
            <action android:name="android.intent.action.OPEN_DOCUMENT" />
            <data android:mimeType="*/*" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SENDTO" />
            <data android:scheme="mailto" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="mailto" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SENDTO" />
            <data android:scheme="smsto" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="sms" />
        </intent>
        <intent>
            <action android:name="android.intent.action.VIEW" />
            <data android:scheme="https" />
        </intent>
        <intent>
            <action android:name="android.intent.action.SEND" />
            <data android:mimeType="*/*" />
        </intent>
        <package android:name="com.whatsapp" />
        <package android:name="com.whatsapp.w4b" />
    </queries>
`;

let insertion = "";
if (permBlock.length) insertion += "\n    <!-- THOR_PERMISSIONS -->\n" + permBlock.join("\n") + "\n";
if (!manifest.includes("THOR_QUERIES")) insertion += queriesBlock;
if (insertion) {
  const idx = manifest.lastIndexOf("</manifest>");
  if (idx < 0) fail("Nie znaleziono </manifest>.");
  manifest = manifest.slice(0, idx) + insertion + manifest.slice(idx);
  log("dodano uprawnienia/<uses-feature>/<queries>");
}
writeFileSync(MANIFEST, manifest, "utf8");

/* ------------------------------------------------------------------ */
/* 2. app/build.gradle                                                 */
/* ------------------------------------------------------------------ */
if (existsSync(APP_GRADLE)) {
  let gradle = readFileSync(APP_GRADLE, "utf8");
  const run = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10) || 1;
  gradle = gradle.replace(/versionCode\s+\d+/, "versionCode " + run);
  gradle = gradle.replace(/versionName\s+"[^"]*"/, 'versionName "1.0.' + run + '"');
  if (!gradle.includes("THOR_LINT")) {
    gradle = gradle.replace(
      /android\s*\{/,
      "android {\n    // THOR_LINT: lint nie blokuje budowania release w CI\n    lint {\n        checkReleaseBuilds = false\n        abortOnError = false\n    }"
    );
  }
  writeFileSync(APP_GRADLE, gradle, "utf8");
  log("build.gradle: versionCode " + run + ", versionName 1.0." + run);
} else {
  console.warn("::warning::Brak android/app/build.gradle — pomijam wersjonowanie.");
}

/* ------------------------------------------------------------------ */
/* 3. Kod Java                                                         */
/* ------------------------------------------------------------------ */
mkdirSync(JAVA_DIR, { recursive: true });

const mainActivity = `package ${APP_ID};

import android.Manifest;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AlertDialog;
import androidx.core.content.ContextCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.WebViewListener;
import java.util.Arrays;
import java.util.List;

/**
 * THOR — główna aktywność (wygenerowana przez scripts/configure-android.mjs).
 */
public class MainActivity extends BridgeActivity {

    /** Prośba o CAMERA przy starcie — dzięki temu getUserMedia działa od razu w skanerze. */
    private final ActivityResultLauncher<String> cameraPermissionLauncher =
        registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {});

    @Override
    @SuppressWarnings("deprecation")
    protected void onCreate(Bundle savedInstanceState) {
        // Wtyczki lokalne muszą być zarejestrowane PRZED super.onCreate().
        registerPlugin(ThorPrintPlugin.class);
        super.onCreate(savedInstanceState);

        final Bridge bridge = getBridge();
        final WebView webView = bridge.getWebView();

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportMultipleWindows(false); // target="_blank" → shouldOverrideUrlLoading → aplikacja zewnętrzna
        s.setJavaScriptCanOpenWindowsAutomatically(false);

        // Rozszerzony WebChromeClient Capacitora (zachowuje prompt/alert/confirm i obsługę <input type=file>).
        webView.setWebChromeClient(new ThorWebChromeClient(bridge));

        // Awaria renderera (np. brak pamięci przy dużym eksporcie) → restart zamiast zamknięcia aplikacji.
        bridge.addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                runOnUiThread(MainActivity.this::recreate);
                return true;
            }
        });

        // Wstecz: nawigacja w WebView albo potwierdzenie zamknięcia (ochrona niezapisanego formularza).
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView wv = getBridge().getWebView();
                if (wv != null && wv.canGoBack()) {
                    wv.goBack();
                    return;
                }
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Zamknąć THOR?")
                    .setMessage("Niezapisane dane bieżącego formularza zostaną utracone.")
                    .setNegativeButton("Anuluj", null)
                    .setPositiveButton("Zamknij", (d, w) -> finish())
                    .show();
            }
        });

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA);
        }
    }

    /**
     * Automatycznie przyznaje WebView dostęp do kamery (getUserMedia) dla lokalnej aplikacji,
     * gdy systemowe uprawnienie CAMERA jest już nadane. W pozostałych przypadkach deleguje do
     * Capacitora, który wyświetla systemowy prompt i dopiero potem wywołuje grant()/deny().
     */
    static class ThorWebChromeClient extends BridgeWebChromeClient {
        private final Bridge bridge;

        ThorWebChromeClient(Bridge bridge) {
            super(bridge);
            this.bridge = bridge;
        }

        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            Uri origin = request.getOrigin();
            String host = origin != null ? origin.getHost() : null;
            if (host == null || !"localhost".equals(host)) {
                bridge.getActivity().runOnUiThread(request::deny);
                return;
            }
            List<String> res = Arrays.asList(request.getResources());
            boolean wantsVideo = res.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
            boolean onlyVideo = wantsVideo && res.size() == 1;
            boolean cameraGranted =
                ContextCompat.checkSelfPermission(bridge.getContext(), Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;

            if (onlyVideo && cameraGranted) {
                bridge.getActivity().runOnUiThread(() -> request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE }));
                return;
            }
            super.onPermissionRequest(request);
        }
    }
}
`;

const printPlugin = `package ${APP_ID};

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * window.print() jest ignorowane przez Android WebView. Ta wtyczka (JS: Capacitor.Plugins.ThorPrint.print)
 * przekazuje bieżącą stronę — z regułami @media print — do systemowego PrintManagera
 * (drukarka lub „Zapisz jako PDF”).
 */
@CapacitorPlugin(name = "ThorPrint")
public class ThorPrintPlugin extends Plugin {

    @PluginMethod
    public void print(final PluginCall call) {
        final String jobName = call.getString("jobName", "THOR_Inspekcja");
        getActivity().runOnUiThread(() -> {
            try {
                WebView webView = getBridge().getWebView();
                PrintManager printManager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    call.reject("PrintManager niedostępny na tym urządzeniu");
                    return;
                }
                PrintDocumentAdapter adapter = webView.createPrintDocumentAdapter(jobName);
                PrintAttributes attributes = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .build();
                printManager.print(jobName, adapter, attributes);
                call.resolve();
            } catch (Exception e) {
                call.reject("Błąd drukowania: " + e.getMessage(), e);
            }
        });
    }
}
`;

writeFileSync(join(JAVA_DIR, "MainActivity.java"), mainActivity, "utf8");
writeFileSync(join(JAVA_DIR, "ThorPrintPlugin.java"), printPlugin, "utf8");
log("zapisano MainActivity.java i ThorPrintPlugin.java w " + JAVA_DIR);

/* ------------------------------------------------------------------ */
/* 4. FileProvider: upewnij się, że katalog cache jest udostępniony    */
/* ------------------------------------------------------------------ */
const FILE_PATHS = join(APP, "src", "main", "res", "xml", "file_paths.xml");
if (existsSync(FILE_PATHS)) {
  let fp = readFileSync(FILE_PATHS, "utf8");
  if (!/<cache-path\b/.test(fp)) {
    fp = fp.replace("</paths>", '    <cache-path name="my_cache_images" path="." />\n</paths>');
    writeFileSync(FILE_PATHS, fp, "utf8");
    log("dodano <cache-path> do file_paths.xml");
  }
} else {
  mkdirSync(join(APP, "src", "main", "res", "xml"), { recursive: true });
  writeFileSync(
    FILE_PATHS,
    '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android">\n' +
      '    <external-path name="my_images" path="." />\n    <cache-path name="my_cache_images" path="." />\n</paths>\n',
    "utf8"
  );
  log("utworzono file_paths.xml");
}

log("gotowe.");
