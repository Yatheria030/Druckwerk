<div align="center">

# 🖨️ Druckwerk

**English** · [Deutsch](README.de.md)

**A filament library that keeps itself up to date, plus your 3D models, printer and print history, right on your home network.**

Self-hosted · one container · SQLite · no cloud, no account

[![License: MIT](https://img.shields.io/badge/License-MIT-c4521d.svg)](LICENSE)
[![Node 24](https://img.shields.io/badge/Node-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![three.js](https://img.shields.io/badge/three.js-3D_preview-000000?logo=threedotjs&logoColor=white)](https://threejs.org)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](compose.yaml)
[![UI: German](https://img.shields.io/badge/UI-German-555)](#)

[Quick start](#-quick-start) · [Features](#-features) · [Printers](#-printers-and-integrations) ·
[Configuration](#%EF%B8%8F-configuration)

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/regal-animation-dunkel.gif"><img src="docs/images/regal-animation-hell.gif" alt="Filament shelf: spools roll onto the shelf and lift when you hover over them" width="900"></picture>

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/dashboard-dunkel.jpg"><img src="docs/images/dashboard-hell.jpg" alt="Printer dashboard with live camera, progress, temperatures and two AMS 2 Pro" width="900"></picture>

</div>

Every spool you own stands on a shelf, with the AMS right above it. Bambu spools sign themselves in by RFID, every print
books its grams off the spool that was really in the slot, and loading a spool is a drag onto the slot. You always know
what is left, what it cost and what to reorder, without a spreadsheet and without the cloud.

Around it, Druckwerk is the rest of your print setup: a library for your models with a 3D preview, print start straight on
the printer, live status with camera and a history with a photo of every plate. Bambu Studio stays for slicing. Nothing
leaves your network.

> The user interface is in German. This README is available in English; German terms from the app are given in quotes
> where they help you find your way.

## Contents

- [Highlights](#-highlights)
- [Features](#-features)
- [Printers and integrations](#-printers-and-integrations)
- [Under the hood](#-under-the-hood)
- [Quick start](#-quick-start)
- [Configuration](#%EF%B8%8F-configuration)
- [Backup](#-backup)
- [Development](#-development)
- [Privacy](#-privacy)
- [License](#-license)

## ✨ Highlights

- 🧵 **A filament shelf that keeps itself up to date**: every spool on wooden boards, with fill level, price and stock value
- 🏷️ **Bambu spools sign themselves in**: RFID read in the AMS, spool created with the official colour name. Spools from an
  order wait in their vacuum bag until their chip shows up
- ⚖️ **Every gram booked**: usage per print from the slice, off the spool that was in the slot, even for prints started from
  Bambu Studio
- 🖱️ **Drag a spool onto an AMS slot**: profile, colour and nozzle temperatures go to the printer
- 🎨 **Colour catalogue** with every Bambu Lab and Sunlu colour, and link import from any shop page
- 📡 **Your printer, live**: status, temperatures, camera, pause, stop, light and speed, straight over the LAN
- 📚 **A library for every model**: STL, 3MF, OBJ, STEP and sliced `.gcode.3mf` with a 3D preview
- ▶️ **Print in one click**: pick a plate, map filaments to AMS slots, start
- 📸 **A history that writes itself**: every print with a photo of the plate, filament used, stars and notes
- 🛟 **Every error code explained**: about 1,900 HMS messages and 480 print errors, in German, offline
- 🌗 **Light and dark**, from iPhone to 16" MacBook
- 🔒 **Everything stays with you**: one container, one SQLite file, one data folder

## 🧩 Features

### Filament shelf
The heart of the app. Spools roll onto the shelf, lift and turn when you hover over them, and the spool printing right now
spins in its AMS slot while the filament runs to the printer.

- All spools on wooden shelves, grouped by material, brand or location, with fill level, price and stock value
- The AMS slots sit on top: **drag a spool onto a slot** to load it, the profile, colour and nozzle temperatures go to the
  printer. Dropping onto a taken slot swaps. On touch screens a long press starts the drag
- **Bambu spools with RFID** are added automatically when loaded, with the official colour name. Spools you add ahead of time
  from an order wait in their vacuum bag ("Wartet auf Chip") and take over the chip the first time it is read
- **Fill level**: RFID spools follow the AMS, every print books its filament from the grams per filament in the slice,
  cancelled prints by progress. This also works for prints started from Bambu Studio
- **Third-party spools** get a starting value (grams or full, ¾, ½, ¼) and can be weighed on a kitchen scale
- **Print profiles** are picked to match material and type (Matte, Silk, CF …), also for third-party filament

| Light | Dark |
|---|---|
| <img src="docs/images/regal-hell.jpg" alt="Filament shelf with AMS and spools" width="440"> | <img src="docs/images/regal-dunkel.jpg" alt="Filament shelf, dark" width="440"> |

### Spools
- Brand, type, colour from the catalogue, weights, prices with discount, print profile with temperatures and drying
- **Link import**: paste a product link, the Anthropic API reads the shop page and fills in everything (optional, own API key)
- The spool list ("Spulen") shows every spool as a table: hex, profile, nozzle, location, RFID state, price per kilo, last
  used and remaining, sortable, with fewer columns on narrow screens

| Spool dialog | Spool list |
|---|---|
| <img src="docs/images/spule-hell.jpg" alt="Spool dialog with colour catalogue, weights, prices and profile" width="440"> | <img src="docs/images/spulen-dunkel.jpg" alt="Spool list as a table, dark" width="440"> |

### Colour catalogue
- Every type and colour from **Bambu Lab** (from Bambu Studio, with German names and chip codes) and **Sunlu**
- Search across all colours, hex codes and manufacturer codes
- Add and edit your own brands, types and colours. Unknown hex values stay unknown instead of being guessed

| Light | Dark |
|---|---|
| <img src="docs/images/katalog-hell.jpg" alt="Bambu Lab colour catalogue by material" width="440"> | <img src="docs/images/katalog-dunkel.jpg" alt="Colour catalogue, dark" width="440"> |

### Printer dashboard
- Status, progress, layer, time left and finishing time, nozzle, bed and chamber temperatures
- **Live camera** (A1, P1 over TLS, X1, H2 and P2S over RTSPS)
- **Pause, resume, stop**, switch the light, pick the speed ("leise", "normal", "Sport", "rasend")
- Printer problems (HMS) appear in German with a link to the Bambu wiki
- **AMS units as they stand in the printer**: humidity and temperature per unit, drying in progress, every slot with colour,
  name and remaining filament. The active spool turns and the filament runs to the printer

### Model library
- Models with any number of files: STL, 3MF, OBJ, STEP, sliced `.gcode.3mf`, images and more
- **Drop files onto the page**, every ZIP becomes its own model
- Thumbnails are rendered by the browser itself, sliced files bring their plate images
- Tags, favourites, search and a "ready to print" ("druckbereit") filter
- Model page with a **rotatable 3D preview** and dimensions, all files, description, source, licence and every print of this model
- Sliced files show print time, weight and filaments per plate. "In Bambu Studio öffnen" hands a file over for slicing

| Library | Model |
|---|---|
| <img src="docs/images/bibliothek-hell.jpg" alt="Library with thumbnails and tags" width="440"> | <img src="docs/images/modell-dunkel.jpg" alt="Model page with 3D preview, dark" width="440"> |

### Printing
- Sliced `.gcode.3mf` files start right from the app
- Pick a plate, **map filaments to AMS slots** (pre-filled by material and colour), bed levelling, flow calibration, timelapse
- The file goes to the printer's SD card over FTPS

| Light | Dark |
|---|---|
| <img src="docs/images/druckdialog-hell.jpg" alt="Print dialog with filament mapping" width="440"> | <img src="docs/images/druckdialog-dunkel.jpg" alt="Print dialog, dark" width="440"> |

### History
- Every print is recorded automatically, also from Bambu Studio or the printer itself, and matched to its model
- A **photo of the plate** at the end of every print
- Stars and a note per print, errors with code and plain text
- Count, print time and success rate at the top

| Light | Dark |
|---|---|
| <img src="docs/images/verlauf-hell.jpg" alt="History with photos, ratings and notes" width="440"> | <img src="docs/images/verlauf-dunkel.jpg" alt="History, dark" width="440"> |

### Error codes
- About 1,900 HMS messages and 480 print errors for all Bambu printers, in German
- Searchable, filtered by area, every code with a link to the Bambu wiki
- The list ships with the app, it never asks Bambu

<img src="docs/images/fehlercodes-hell.jpg" alt="Error codes with search and filter" width="900">

### Around the app
- **First steps** ("Erste Schritte"): a guided setup on first launch for printer, filament and link import, every step can be
  skipped
- **Settings** with an explanation, default and where to find it for every field
- Built for the phone: tab bar at the bottom, tabs instead of the sidebar, spools dragged into slots with a long press
- **Dark mode** follows the system

| First steps | Settings |
|---|---|
| <img src="docs/images/start-hell.jpg" alt="First steps setup" width="440"> | <img src="docs/images/einstellungen-dunkel.jpg" alt="Settings, dark" width="440"> |

<p align="center">
  <img src="docs/images/handy-filament-hell.jpg" alt="Filament on a phone" width="240">
  <img src="docs/images/handy-modell-dunkel.jpg" alt="Model page on a phone, dark" width="240">
  <img src="docs/images/handy-verlauf-hell.jpg" alt="History on a phone" width="240">
</p>

## 🔌 Printers and integrations

| What | What it brings | How |
|---|---|---|
| **Bambu Lab A1, A1 mini, P1P, P1S** | Status, commands, print start, camera over TLS | LAN mode on the printer, address, serial number, access code |
| **Bambu Lab P2S, X1 Carbon, X1E, H2D, H2S** | Status, commands, print start, camera over RTSPS | As above, plus LAN liveview on the printer and ffmpeg in the image |
| **AMS, AMS 2 Pro, AMS HT** | Slots, RFID spools, humidity, temperature, drying | Automatic with the printer |
| **Bambu Studio** | Prints started there show up in history and book their filament | Automatic, the app fetches the file from the printer |
| **Anthropic API** | Link import: fill in a spool from a shop page | API key in the settings, model selectable |

Printing from the app needs **developer mode** on the printer (firmware with authorization control only accepts commands
from other apps in LAN mode with developer mode) and an SD card. Without developer mode, status, camera and history still work.

## 🔬 Under the hood

What happens in the background so the front feels simple.

### Printer connection
- **MQTT over TLS** (8883) for status and commands. Reports are deltas: merged deeply, arrays replaced, replies to
  commands kept apart from status reports
- **FTPS** (implicit, 990) for uploading and for reading back files of prints started elsewhere
- **Camera**: A1 and P1 send JPEG frames over TLS on 6000, X1, H2 and P2S stream RTSPS on 322 through ffmpeg. Output as MJPEG,
  one connection per printer, closed 5 s after the last viewer
- The history is built from changes of the print state; cancelled and failed prints are told apart by their error code

### Filament tracking
- After every report with changed slots, the app syncs the AMS: a new chip first takes over a spool you prepared
  (same profile, similar colour, oldest first), otherwise a new Bambu spool is created
- **Usage per print** from `slice_info.config` of the plate: grams per filament × progress, booked once per print to the
  spool that was in the slot at start. Without slice info, the drop in the RFID fill level × spool weight
- Once a spool is weighed or corrected by hand, only print bookings count from then on

### Models and files
- Uploads are streamed to disk with a sha256 on the way, ZIPs are unpacked
- **3MF parsing**: plates, filaments, print time and printer from the slice info, plate images straight from the file
- **Thumbnails** for STL, OBJ and 3MF are rendered in the browser with three.js (Z-up turned to Y-up, set onto the bed)
  and uploaded to the server

### Data
- **SQLite via `node:sqlite`**, no native dependency. Migrations tracked in `user_version`
- **Settings** with a clear order: value in the app, else environment, else built-in default. Read on every access, so changes
  apply at once
- The printer's access code and the API key never leave the server; the UI only shows a hint such as `…abcd`

## 🚀 Quick start

### Docker

```bash
git clone https://github.com/Yatheria030/druckwerk.git
cd druckwerk
mkdir -p data
docker compose up -d --build
```

Then open http://localhost:8795. `compose.yaml` stores the database, model files, thumbnails and photos in `./data`
and builds the image with ffmpeg for the camera of X1, H2 and P2S.

### Node

Requires Node 24.

```bash
npm ci
npm run build
npm start
```

On first launch, **first steps** ("Erste Schritte") opens. Nothing is required: library and filament work without a printer.
Before connecting a printer, switch on **LAN mode** on the printer, and **developer mode** to print from the app.

## ⚙️ Configuration

All values live in the app's settings and are stored in the database. An empty field means default. Environment variables
only apply as long as nothing is set in the app.

| Value | Required? | Default | Environment | In the app |
|---|---|---|---|---|
| Printer: name | for the printer | – | `BAMBU_NAME` (default "Drucker") | Settings → printer, setup step 2 |
| Printer: model | for the printer | P2S | `BAMBU_MODEL` | Settings → printer, setup step 2 |
| Printer: IP address | for the printer | – | `BAMBU_HOST` | On the printer: settings → Wi-Fi or network |
| Printer: serial number | for the printer | – | `BAMBU_SERIAL` | On the printer: settings → device, or Bambu Studio |
| Printer: access code | for the printer | – | `BAMBU_ACCESS_CODE` | On the printer, shown with LAN mode |
| Currency | optional | € | – | Settings → filament |
| Filament per spool | optional | 1000 g | – | Settings → filament |
| Colour tolerance for prepared spools | optional | 60 (0–442) | – | Settings → filament |
| Show external spool | optional | off | – | Settings → filament |
| API key for the link import | optional | – (import off) | `ANTHROPIC_API_KEY` | Settings → link import (Anthropic API) |
| Model for the link import | optional | `claude-opus-5-5` | `SCRAPE_MODEL` | Settings → link import (Anthropic API) |

The printer is only needed for status, printing, camera and history. The `BAMBU_*` variables create the printer once at
start if its serial number is not known yet. Template for all variables: [`.env.example`](.env.example).

Environment only, because they must be known before the database:

| Variable | Default | Purpose |
|---|---|---|
| `DATA_DIR` | `data` (in the image `/data`) | Database, model files, thumbnails, print photos |
| `PORT` | `8795` | Port for API and UI |
| `HOST` | `127.0.0.1` (in the image `0.0.0.0`) | Address the server listens on |
| `FFMPEG` (build argument) | `0` | `1` installs ffmpeg for the camera of X1, H2 and P2S |

### Network

The app talks to the printer directly: MQTT TLS (8883), FTPS (990 plus passive ports), camera on 6000 (A1, P1) or
RTSPS 322 (X1, H2, P2S). If the printer sits in another network, these ports must be reachable from the container.
Times are shown in the browser's time zone.

## 💾 Backup

Everything lives in the data folder (`DATA_DIR`, with Docker `./data`): `stl.db`, `files/`, `thumbs/` and `photos/`.
To back up, stop the container and copy the folder; to restore, put it back and start again.

## 🛠 Development

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Vite runs on :5181 and forwards `/api` to the server on :8795. Check with `npm run typecheck`, build with
`npm run build` (into `dist/`, served by the server).

```
server/   Hono API, SQLite schema, uploads and 3MF parsing, printer connection, camera, filament, catalogue, link import
shared/   Types and logic for server and UI (settings, print profiles, colour names, catalogue)
web/      React UI: pages in pages/, components in ui/, three.js loading and thumbnails in lib/three.ts
scripts/  Refresh the error codes and the Sunlu catalogue
docs/     Screenshots
```

**Stack**: Hono on Node 24 (runs straight from TypeScript via tsx), `node:sqlite`, React 19, Vite, Tailwind CSS 4,
TanStack Query, three.js.

The screenshots show sample models and a simulated printer with a sample address.

## 🔒 Privacy

One container, one SQLite file, one data folder. No Bambu cloud, no account, no tracking, no telemetry. The app talks to
the printer directly on your network. The only thing that leaves it is the link import, and only once you enter an API key.

Druckwerk is a private project and not affiliated with Bambu Lab. Bambu Lab, AMS and Bambu Studio are trademarks of their
owners. The printer protocol fields are not officially documented and may change with new firmware.

## 📄 License

[MIT](LICENSE)
