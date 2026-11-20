# Coastline Atelier

[![make.fun bounty](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/argaromit-lab/gta6-cover-art-01/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/argaromit-lab/gta6-cover-art-01/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)

An offline, multi-panel photo cover editor with per-panel scene labels, 'Fill all panels', 'Clear lettering', a custom title plate, original poster lettering, and sunset or neon color grades. Photos stay entirely on your device.

## New Features & Capabilities

- **Fill all panels**: Apply the selected panel's photo and crop/label to every active panel as a single undoable action.
- **Per-panel Scene Labels**: Editable scene label field for the selected panel stored in state, surviving crop changes, following undo/redo, and rendering clipped to actual panel paths in PNG exports.
- **Show Scene Labels Toggle**: Privacy-first toggle (OFF by default) to display or hide scene labels. Local filenames never appear on exported art unless explicitly enabled.
- **Clear Lettering**: One-click action to clear title and subtitle as a single undoable action.
- **Robust Layout & Typography**: Compute clear title region separate from branding; long/multi-line title ink bounds, subtitle descenders, stroke, and rotation remain inside canvas at typeScale 115 for landscape, portrait, and square layouts.
- **Node Entrypoint (`main.ts`)**: Validates presence of exactly 3 or 4 screenshot files before packaging and dossier generation.

## Run

Serve `app/` with any static HTTP server, for example:

```sh
python -m http.server 8080 --directory app
```

Open `http://localhost:8080`, choose a panel, assign a photo, drag to crop, edit scene labels, and export a PNG.

## Files

- `app/` contains the static editor, fonts, and six bundled sample photos.
- `screenshots/` shows the exported covers and editor.
- `main.ts` builds `/output` and its dossier; set `MAKEFUN_OUTPUT_DIR` to choose another destination locally.

## License & Assets

- The repository is MIT licensed.
- Barlow Condensed, Public Sans and Yellowtail are bundled under their accompanying font licenses.
- The six sample images came from the official kit/our generated sample preparation and are free to use, not official GTA art.
- `vendor/makefun-app.ts` is unchanged official kit code.
