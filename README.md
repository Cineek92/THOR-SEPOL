# THOR — MQC W/M · Android APK (Capacitor 8)

Natywna aplikacja Android zbudowana z jednoplikowej PWA `THOR (Web).html`, kompilowana w GitHub Actions.

## Struktura

```
thor-android/
├── .github/workflows/
│   ├── build-apk.yml            # budowanie APK (push na main + ręcznie)
│   └── generate-keystore.yml    # jednorazowo: stały klucz podpisu
├── native/
│   └── thor-native-patch.js     # mostek JS: download / shareBlob / print
├── scripts/
│   ├── prepare-www.mjs          # kopiuje HTML → www/index.html, wstrzykuje patch
│   └── configure-android.mjs    # manifest, gradle, MainActivity, ThorPrintPlugin
├── THOR (Web).html              # Twoja aplikacja (z już wklejonym patchem)
├── capacitor.config.json
├── package.json
├── .gitignore
└── README.md
```

Katalogi `android/`, `www/`, `node_modules/` powstają w CI — nie wrzucaj ich do repozytorium.

## Krok po kroku (tylko przeglądarka)

1. GitHub → **New repository** → nazwa np. `thor-android` → **Private** → **Create repository**.
2. **uploading an existing file** → przeciągnij: `THOR (Web).html`, `package.json`, `capacitor.config.json`,
   `.gitignore`, `README.md` oraz foldery `native/` i `scripts/` → **Commit changes**.
3. Workflowy (folder `.github` bywa ukryty w Finderze/Eksploratorze, więc najpewniej ręcznie):
   **Add file → Create new file**, nazwa `.github/workflows/build-apk.yml`, wklej treść → **Commit**.
   To samo dla `.github/workflows/generate-keystore.yml`.
4. Commit na `main` sam uruchamia budowanie. Zakładka **Actions → Build THOR APK** (ok. 6–10 min).
5. Po zielonym ✔ otwórz przebieg → sekcja **Artifacts** → `THOR-MQC-Inspection` (ZIP z dwoma APK).
6. Na telefonie: rozpakuj ZIP, otwórz `THOR-MQC-Inspection.apk`, zezwól na „instalację z nieznanych źródeł”.

## Stały klucz podpisu (zalecane przed pierwszym wdrożeniem)

Bez tego każdy build ma inny klucz → nowej wersji nie da się zainstalować na starą bez odinstalowania,
a **odinstalowanie usuwa bazę IndexedDB z inspekcjami**.

1. **Actions → Generate signing keystore → Run workflow**.
2. Pobierz artefakt `thor-signing-keystore`, otwórz `SEKRETY.txt`.
3. **Settings → Secrets and variables → Actions → New repository secret**: dodaj
   `THOR_KEYSTORE_BASE64`, `THOR_KEYSTORE_PASSWORD`, `THOR_KEY_ALIAS`.
4. Usuń artefakt, plik `.jks` zachowaj bezpiecznie (jego utrata = brak możliwości aktualizacji).
