# CappySculptPaint3D (web)

Malowanie PBR i rzeźbienie mikropowierzchni na modelach 3D bez modyfikacji siatki bazowej —
przeglądarkowa implementacja specyfikacji *TexSculpt 3D*. Three.js + Vite, czysty JavaScript (ES modules), bez frameworka UI.

## Uruchomienie / Run

Wymagany Node.js 18+.

```bash
npm install
npm run dev            # serwer deweloperski z hot reload: http://localhost:5173
npm run build          # wersja produkcyjna w dist/ (serwować przez dowolny serwer HTTP)
npm run build:single   # cała aplikacja w jednym pliku: dist-single/index.html
```

Gotowy pojedynczy plik: `CappySculptPaint3D.html` — otwórz go w przeglądarce (bez serwera, bez internetu).

## Publikacja na GitHub Pages

Kod w `src/` musi zostać zbudowany przez Vite — przeglądarka nie załaduje go bezpośrednio
(`import 'three'`, import CSS z JS). Dlatego publikowanie surowego repozytorium daje stronę bez stylów.

Workflow `.github/workflows/deploy.yml` buduje aplikację i publikuje `dist/` przy każdym pushu do `main`.
Jednorazowo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Struktura projektu / Project structure

```
index.html                 Układ strony: górny pasek, panele, viewport, stopka, okna dialogowe
vite.config.js             Konfiguracja Vite (zwykły build)
vite.single.config.js      Konfiguracja buildu do jednego pliku HTML
src/
  main.js                  Punkt startowy: tworzy viewport, podłącza UI, ładuje model startowy
  config.js                Nazwa aplikacji, prefiks plików, klucze localStorage, ustawienia domyślne

  app/                     Logika aplikacji (bez rysowania UI)
    state.js               Wspólny stan `app` (model, warstwy, pędzel, historia)
    project.js             Ładowanie modeli wbudowanych, import plików 3D, otwieranie .txs
    actions.js             Komendy z menu i przycisków (data-action="…"), zmiana modelu/rozdzielczości
    history.js             Cofnij / ponów + stan przycisków
    renderLoop.js          Pętla klatek: kompozycja zmienionych kafelków, render, FPS

  engine/                  Silnik — czyste obliczenia, nie dotyka DOM
    meshPrep.js            Modele wbudowane, loadery OBJ/FBX/glTF, auto-unwrap UV, krzywizna
    texelSpace.js          Rasteryzacja map Position/Normal w UV, siatka przestrzenna 3D, padding szwów
    brush.js               Narzędzia, pociągnięcia, symetria, historia (tile-delta undo)
    layers.js              Stos warstw, tryby mieszania, inteligentne maski, Height → Normal
    noise.js               Szumy proceduralne i stemple Alpha
    baker.js               Wypalanie Curvature / AO / Thickness (BVH)
    io.js                  PNG 8/16-bit, EXR, ZIP, presety eksportu, format .txs

  viewport/                Widok 3D
    viewport.js            Scena three.js: kamera, światło, materiały, tryby podglądu, wyświetlacz pędzla
    paintInput.js          Mysz / piórko na viewporcie: pociągnięcia, kursor pędzla, obrót światła, drag & drop

  ui/                      Interfejs (każdy plik = jeden obszar ekranu)
    toolbar.js             Górny pasek: menu, wybór modelu/widoku, Prosty|Pro, PL|EN, jasny|ciemny
    brushPanel.js          Lewy panel: narzędzia, suwaki, kanały, biblioteka Alpha, tablet, symetria
    colorPicker.js         Koło kolorów, jasność, HEX, paleta
    layersPanel.js         Prawy panel: lista warstw i inspektor właściwości
    nodeGraph.js           Dolny panel: graf węzłów
    projectSettings.js     Materiał bazowy i ustawienia viewportu
    radialMenu.js          Menu kołowe (PPM / Spacja)
    dialogs.js             Okna eksportu i pomocy (tu jest lista skrótów)
    keyboard.js            Skróty klawiszowe
    statusBar.js           Stopka i licznik FPS
    widgets.js             Wspólne: suwaki z odczytem, listy <select>
    dom.js                 Wspólne: $, $$, toast, pasek postępu
    icons.js               Ikony SVG i kolory typów warstw

  i18n/                    Tłumaczenia
    index.js               t('klucz'), przełączanie języka, atrybuty data-i18n
    pl.js, en.js           Teksty interfejsu (te same klucze w obu plikach)

  styles/                  Style CSS (index.css importuje resztę)
    theme.css              Kolory motywów jasnego i ciemnego
    base.css, topbar.css, left-panel.css, viewport.css, layers.css, node-graph.css, footer.css, dialogs.css

  utils/color.js           Konwersje kolorów (HEX / RGB / HSV)
  assets/icon.svg          Ikona aplikacji (favicon + logo)
```

### Jak coś zmienić / How to

| Chcę… | Plik |
|---|---|
| zmienić nazwę aplikacji lub prefiks eksportowanych plików | `src/config.js` (+ `<title>` i logo w `index.html`) |
| dodać / poprawić tłumaczenie | `src/i18n/pl.js` i `src/i18n/en.js` (ten sam klucz w obu) |
| zmienić kolory motywu | `src/styles/theme.css` |
| dodać przycisk w menu | `index.html` (`data-action="nazwa"`) + funkcja w `src/app/actions.js` |
| dodać skrót klawiszowy | `src/ui/keyboard.js` + opis w `SHORTCUTS` w `src/ui/dialogs.js` |
| dodać narzędzie pędzla | `TOOLS` i `dabInstance` w `src/engine/brush.js`, ikona w `src/ui/icons.js`, teksty `tool_*` / `tip_*` |
| dodać generator proceduralny | `GENERATORS` / `evalGenerator` w `src/engine/noise.js` + tekst `gen_*` |
| dodać maskę | `MASK_TYPES` / `maskValue` w `src/engine/layers.js` + tekst `mask_*` |
| dodać właściwość warstwy w inspektorze | `inspectorRows` w `src/ui/layersPanel.js` |
| dodać preset eksportu | `EXPORT_PRESETS` / `exportPreset` w `src/engine/io.js` + teksty `preset_*` |
| dodać model wbudowany | `BUILTIN_MODELS` / `createBuiltin` w `src/engine/meshPrep.js` + tekst `model_*` |

Zasada: `engine/` nie wie nic o DOM; `ui/` tylko wyświetla i wywołuje `app/` lub `engine/`. Stan jest w jednym obiekcie
`app` (`src/app/state.js`) — w konsoli przeglądarki dostępny jako `window.CappySculptPaint3D`.

## Co jest zaimplementowane / What's implemented

| Spec | Implementacja |
|---|---|
| Zero modyfikacji geometrii | Siatka tylko do odczytu; detal w mapie Height (Float32) → Normal Map w czasie rzeczywistym |
| Multi-Channel Brush | Kolor, Height, Roughness, Metallic w jednym pociągnięciu |
| 3D World-Space Brush | Mapy Position/Normal w przestrzeni UV + siatka przestrzenna 3D; brak szwów UV, culling kątowy |
| Projekcja | Tangent Wrap, Planar (z ekranu), Tri-planar (generatory proceduralne) |
| Seam padding | Edge dilation 12 px po każdym pociągnięciu |
| Tile-Delta Undo/Redo | Kafelki 64×64, zapisywane tylko zmienione kafelki |
| Warstwy | Paint, Fill, Procedural (Perlin, Simplex, Voronoi, Ridged, Brushed, Weave, Gabor), Adjustment (HSL) + tryby mieszania |
| Smart Masks / Anchor Points | Edge Wear, Cavity, AO, Top, Bottom, Thickness, Anchor (wysokość innej warstwy) |
| Mesh Baker | Curvature, AO i Thickness (ray tracing na BVH — three-mesh-bvh) |
| Pędzle | Paint, Sculpt, Smooth, Erase, Fill, Smudge, stemple Alpha, Height-aware, symetria X/Y/Z, symetria radialna (do 32), Lazy Mouse, nacisk pióra |
| Viewport | PBR GGX + IBL, True Displacement, tryby Solo (C), obrót światła (Shift+PPM) |
| UI | Tryb Prosty (Sculptris-like) / Pro (Tab), menu kołowe (PPM/Spacja), graf węzłów, PL/EN, motyw jasny/ciemny |
| Import / Auto-UV | OBJ, FBX, glTF/GLB; automatyczne rozkładanie UV przy braku / nakładaniu się UV |
| Eksport | Presety UE5 (ORM), Unity (MaskMap), Blender (16-bit PNG + 32-bit EXR) w ZIP |
| Format .txs | Archiwum: manifest.json, geometria, rzadkie (niepuste) kafelki skompresowane gzip |

Różnice względem specyfikacji desktopowej (C++/Vulkan): obliczenia pędzla działają na CPU zamiast w compute shaderach,
brak UDIM (jeden kafelek 0–1, UV spoza zakresu są rozkładane ponownie), maks. rozdzielczość 2K, kompresja gzip zamiast Zstd/LZ4.

© 2026 CappySoft.pl
