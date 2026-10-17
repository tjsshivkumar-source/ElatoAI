# Personal Computing Kit — project brief for Claude Code

Read this whole file before doing anything. It is the single source of truth for this project.
Full human-readable build guide: https://claude.ai/code/artifact/1d0a10d9-58a1-497e-bdd9-b5382d55a7ac

## What this is

An exhibition piece for the TIAT "Personal Computing" show at an SF gallery (runs about a month from Oct 21, 2026).
A kiss-lock toiletry pouch with a mic, a speaker and an ESP32-S3. Opening the pouch starts a voice conversation;
the AI checks in on the user's skincare/hair/body routine, logs which products they use, and remembers it next time.

This repo is a fork of ElatoAI (MIT, github.com/akdeb/ElatoAI). Elato provides the voice plumbing
(ESP32 firmware, Deno edge server, Supabase, Next.js app). Our work adds: lid trigger, check-in behaviour,
memory layer, exhibition mode, and (later) a rebranded app. Keep Elato's LICENSE file.

## Hard deadline

- Install on site Wed Oct 21 (owner flies in for one day). Everything must work before that.
- Plan: Fri 10/16 ALL software (tasks 0–7). Two parallel Claude Code sessions: session A runs tasks 0–6 in
  the main checkout; session B runs task 7 (display app) in its own git worktree, touching only
  `frontend-nextjs/` display files and `frontend-nextjs/design/`. Session B treats the task-5 table
  definitions in this file as its data contract and uses local mock data until task 5's tables exist.
  Sat 10/17 soldering + wiring + first real audio; Sun 10/18 assembly + burn-in; Mon 10/19 buffer;
  Tue 10/20 pack; Wed 10/21 install.
- Goal: by Saturday morning all software is done and tested without audio hardware, so on Saturday the only
  work is connecting mic, amp and reed sensor to the pins below.
- Prefer the smallest change that works. Do not refactor Elato code that we don't need to touch.

## Rules for Claude Code in this repo

- **Never** push, merge, rebase onto main, force anything, or open/merge PRs. The owner does all git remote operations.
- Work on the local branch `tiat`. Commit only when the owner asks; show the diff summary first.
- Never write API keys or secrets into source files. Secrets live in `.env` files (gitignored) and in the
  Deno Deploy / Supabase dashboards. Use `.env.example` files to learn variable names.
- Before any multi-file change, propose a short plan and wait for approval.
- Explain *why* briefly when changing hardware-facing code; the owner is new to embedded work and is learning.
- After a change, verify it: build the firmware (`pio run`), type-check/run the server, or run the relevant test.
  Say plainly what you could not verify (e.g. anything needing the physical board or audio).
- Ask before installing global tools or Docker.

## Hardware (fixed — don't change pins without asking)

Board: ESP32-S3-DevKitC-1 clone, module ESP32-S3-N16R8 (16MB flash, 8MB octal PSRAM). Arduino IDE board name:
"ESP32S3 Dev Module". Flashing port on the owner's Mac shows as `/dev/cu.usbserial*` or `/dev/cu.wchusbserial*`.

| Part pin | ESP32 | Notes |
| --- | --- | --- |
| Mic INMP441 VDD | 3V3 | 3.3V part only |
| Mic GND | GND | |
| Mic L/R | GND | left channel |
| Mic SCK | GPIO 1 | I2S bit clock |
| Mic WS | GPIO 4 | I2S word select |
| Mic SD | GPIO 14 | I2S data in |
| Amp MAX98357A Vin | 5V | 5V for volume (Elato's diagram shows 3V3) |
| Amp GND | GND | |
| Amp BCLK | GPIO 6 | |
| Amp LRC | GPIO 5 | |
| Amp DIN | GPIO 7 | |
| Amp SD (shutdown) | GPIO 10 | firmware turns amp off when idle |
| Amp GAIN | unconnected | 9 dB default |
| Reed sensor lead 1 | GPIO 2 | Elato's button pin; internal pull-up |
| Reed sensor lead 2 | GND | |

Avoid GPIO 0, 3, 45, 46 (strapping) and 35–37 (octal PSRAM).

Lid sensor is an MC-32 **normally closed** reed switch: magnet near (pouch closed) = open circuit = GPIO 2 HIGH;
pouch opened = contacts close = GPIO 2 LOW. So "opened" looks like a button press.

Power at the gallery: USB wall adapter (always on). Backup: Anker power bank with trickle mode.
Gallery WiFi: WPA password only (no login page). Entered on site via the board's setup portal; the network must be 2.4 GHz.

This is the production build. There is no separate demo build: `exhibition mode` is only a per-device data-profile switch.
The single dev→prod step is task 6 (cloud deploy + firmware PROD_MODE). One Supabase project serves both, so
clear test data from the demo profile before the show.

## Architecture

- **Firmware** (ESP32, `firmware-arduino/`): lid sensing, I2S mic in / speaker out, Opus, WSS to edge server.
- **Edge server** (Deno, `server/`, deployed to Deno Deploy): holds API keys, builds the context brief,
  runs the check-in timer, executes tools, writes session summaries (no raw transcripts).
- **Voice model**: OpenAI Realtime API (speech-to-speech) via Elato's OpenAI model path. Keep this path.
- **Database**: hosted Supabase (Postgres). Use the hosted project, not local Docker, unless the owner says otherwise.
- **App**: Next.js (`frontend-nextjs/`), Vercel. Reads/writes Supabase. Rebrand is a stretch goal.

## Work to do (in order — update the checkboxes as tasks complete)

**Session A order:** 0 → 1 → 1b → 4 → 5 → 5b → 2 → 3 → 6. (Tasks 2–3 need the USB board; the server
tasks come first so they can be tested with the fake device.) **Session B:** 7a → 7b → 7c → 7d.
**Decided:** keep Elato's deep-sleep/wake model for task 3 unless the owner says otherwise.

**Owner inputs available:** all keys are in the `.env` files (`BEAUTY_API_KEY` included; `SEARCH_API_KEY`
intentionally absent). Starting inventory is in `products.md` (`category | routine step | brand | name`).
Gallery WiFi is password-only.

### 0. Recon
- [x] Map the repo: where the button handler, config (`config.h`, `Config.cpp`), audio pins, the Deno OpenAI
      session handler, Supabase schema/migrations and env vars live. Write the map into "Repo map" below.

### 1. Run Elato as-is
- [ ] Hosted Supabase: apply Elato's schema/migrations; create user, device, personality.
- [ ] Deno server runs locally with `.env`; Next.js app runs locally.
- [ ] Talk to the AI in the browser (gate: a spoken conversation works).
- [ ] Register the device using the board's MAC address (flash Elato's MAC-print test sketch to read it).

### 1b. Fake device (so server work can be tested before soldering)
- [ ] A small local script (`tools/fake-device/`) that connects to the Deno server exactly like the ESP32
      does (same auth, same WebSocket protocol — raw PCM16 16 kHz up, Opus down; see "Device↔server
      protocol" in the Repo map), streams the laptop mic, and plays replies
      through the laptop speakers. Simulate "pouch open" by starting it and "pouch closed" by Ctrl-C.
      Read the firmware source to match the protocol precisely. Note: the browser chat in Elato's app may
      bypass the Deno server, so it does NOT exercise check-ins or tools — the fake device does.
- [ ] Fix the input sample rate in `server/deno/models/openai.ts`: the device sends 16 kHz PCM but the
      session declares 24 kHz (`realtime/client.js` `_toGASessionPayload`) and openai.ts forwards it
      unresampled. Reuse `resamplePcm16Mono` from `models/grok.ts` / `models/openai-live.ts` (16000 → 24000)
      before `input_audio_buffer.append`. Verify with the DEV_MODE debug files
      (`debug_audio_<ts>.pcm` in `server/deno/`, raw s16le mono): wrap one in a WAV header at 16000 Hz
      and at 24000 Hz and listen — the 16 kHz one should sound natural, proving the input rate. After the
      fix, confirm the logged user transcriptions match what was said.
- [ ] Gate: a spoken conversation through the fake device, server logs show the session.

### 2. Firmware bring-up
- [ ] `config.h`: comment out `TOUCH_MODE`; DEV_MODE with the laptop IP in `Config.cpp`.
- [ ] Confirm the pin definitions match the table above (esp. amp Vin note is wiring-only; SD = GPIO 10).
- [ ] Build + flash with PlatformIO; device connects to WiFi and the local server (works before soldering).
- [ ] With hardware soldered: spoken conversation through mic and speaker.

### 3. Lid trigger (firmware)
- [ ] GPIO 2 LOW held ≥300ms → start session. HIGH held ≥300ms → end session immediately, amp off.
- [ ] Test mode for before the reed sensor is wired: a compile flag `LID_TEST_BOOT_BUTTON` makes the
      onboard BOOT button (GPIO 0, safe to read after boot) act as the lid (pressed = open). Log every lid
      state change to serial. Default build uses GPIO 2.
- [ ] Before deep sleep, keep the lid pin's internal pull-up on in the RTC domain:
      `rtc_gpio_pullup_en(GPIO_NUM_2)` + `rtc_gpio_pulldown_dis(GPIO_NUM_2)` (same for GPIO 0 in
      `LID_TEST_BOOT_BUTTON` mode). Otherwise the pin floats while the pouch is closed (reed open circuit)
      and causes spurious wakes. Test: the board stays asleep 10+ minutes with the lid closed.
- [ ] Short local tone on open (before server connects); distinct error tone if WiFi/server fails.
- [ ] Sleep model: see "Implication for task 3" in the Repo map — confirm with owner before changing it.
      Whichever model, the device must recover on its own if WiFi drops overnight.

### 4. Check-ins (server)
- [ ] ~35s with no speech from either side → server makes the model take a turn asking about the next routine step.
- [ ] Stop rules: 2 unanswered check-ins → end session; max session 5 min; "give me a minute" pauses once.
- [ ] Interval, max length, routine order and persona read from the database at session start.

### 5. Memory (server + Supabase)
- [ ] Tables: `products` (name, brand, category, routine_step, status, opened_at, rating, notes, profile_id,
      `image_url` nullable, `image_source` (owner / beautyapi / none) — see "Product art" in the display spec,
      `slot` nullable int — position in the kit outline / cupboard),
      `usage_events` (product_id, ts, context, session_id, profile_id),
      `observations` (text, product_ids, ts, session_id, profile_id). Seed the owner's products.
- [ ] Realtime tools: `match_product(spoken_name)` (fuzzy match against products), `log_usage`,
      `update_product`, `add_observation`. Confirm aloud before saving a new product.

### 5b. Product lookup — CRUCIAL, core scope (not stretch)
When the user names a product that isn't in their kit, the kit identifies it, confirms it aloud, and saves it.
- [ ] Table `product_catalog` (shared cache across profiles): normalized_query, brand, name, category,
      routine_step_guess, key_ingredients text[], size, image_url, source,
      source_url, confidence, fetched_at. Every successful lookup is cached here first.
      `source` values: 'beautyapi' | 'obf' | 'web' | 'manual'. Store the Beauty API product id when available.
- [ ] Tool `lookup_product(query)`, called by the model when `match_product` has no confident match.
      Resolution chain, stop at the first confident hit:
      1. Owner's/demo profile's `products` (fuzzy; reuse `match_product` logic)
      2. `product_catalog` cache (fuzzy on brand + name)
      3. **The Beauty API** (thebeautyapi.com) — primary source. `GET /v1/products/search?q=` with header
         `x-api-key: $BEAUTY_API_KEY`; returns slim records (id, brand, name, category, image_url); fetch the
         full record only for the chosen candidate (on-label ingredient list, flags). Search requires EVERY
         word of q to match brand or name, so send short normalized queries (brand + 1–2 name words), never
         the raw transcript. On zero results, use the response's `no_match.hint` to drop the named word and
         retry once — that counts as the second (last) variant. Follow "The Beauty API reference" appendix
         below exactly. Every call is billed (trial = 100 calls total), so
         cache all results in `product_catalog`, and use mocked responses in automated tests — real calls
         only in the final verification run. On 429, back off; don't retry inside the 3 s budget.
      4. **Open Beauty Facts** search API (free, no key; send a descriptive User-Agent as their API rules
         require). Coverage is uneven — a free second opinion.
      5. **Web search fallback** (optional): query a search API (`SEARCH_API_KEY`; provider chosen by owner —
         Brave Search API or Tavily), pass the top few results to a small fast text model (via the existing
         `OPENAI_API_KEY`; check current model names), which extracts a structured record with a confidence
         score. Never invent fields the sources don't support; leave them null. Build this code path either
         way; if `SEARCH_API_KEY` is not set, skip this step and fall through to saving the product as unverified.
- [ ] Return the top 1–3 candidates to the voice model as short strings ("COSRX Advanced Snail 96 Mucin Power
      Essence, essence step"). The model reads back the best one and asks for a yes/no; on yes →
      insert into `products` for the active profile (status 'in use') + `log_usage`; on no → offer the next
      candidate once, then save what the user said as an unverified product (`source='manual'`,
      confidence 0) so nothing is lost.
- [ ] Latency: the model says a short filler ("let me look that up") before calling the tool. Whole chain
      has a hard 3 s budget; on timeout, save as unverified and enrich in the background later.
- [ ] Speech-to-text garbles brand names: normalize the query (lowercase, strip filler words, common
      phonetic fixes like "cos rx" → "cosrx") before searching; try brand-only and name-only variants.
- [ ] Verification: a test script runs ~15 spoken-style queries (incl. deliberately garbled ones and the
      owner's own products from products.md) through the chain and reports hit rate and latency per source.
      Report results to the owner; this is the gate.
- [ ] `key_ingredients` is stored now because recommendations (duplicates, overlaps) will use it later.
- [ ] Context brief at session start: routine order, products in use, running low, last 7 days of use,
      ≤10 newest observations. Keep it short.
- [ ] Exhibition mode: device flag selects a demo profile; visitors never write to the owner's profile.
- [ ] RLS on every new table. The display app runs with the public anon key and no login, so give anon
      READ-ONLY access to the demo profile's rows only (or serve the display through a read-only API route
      using the service key server-side). Anon must never be able to write, or read the owner's profile.
- [ ] Enable Supabase Realtime for `products`, `usage_events`, `observations` so the display updates live.
- [ ] Persona + first message: draft them (warm, brief, asks about the routine step by step, knows it's an
      exhibition piece talking to strangers, never asks for personal info) and get owner approval before
      seeding. Keep replies to 1–2 sentences.
- [ ] **Summaries, not transcripts (core, owner decision).** Raw transcripts are never kept:
      - At session end, the server sends the in-memory transcript to a small fast text model (existing
        `OPENAI_API_KEY`) which returns JSON: a 1–2 sentence session summary, products used, status changes,
        ratings, observations. Write those to `session_summaries` (profile_id, session_id, ts, summary)
        and the existing tables, then discard the transcript.
      - Stop Elato from persisting raw transcripts to `conversations` (or delete the row immediately after
        the summary is written). If summarization fails, log the error and drop the transcript anyway.
      - **Stop feeding raw chat history into the prompt.** Upstream `createSystemPrompt` injects previous
        conversations; at the gallery that would leak one visitor's words into the next visitor's session.
        Replace it with the context brief built only from structured data + recent `session_summaries`.
        Device path: `addConversation` calls in `models/openai.ts` (assistant + user transcripts) and
        `getChatHistory` → `createSystemPrompt` in `main.ts` / `supabase.ts`.
      - **Browser chat path too**, even though the gallery won't use it: stop
        `frontend-nextjs/app/components/Realtime/components/Transcript.tsx` (`dbInsertTranscriptItem`)
        from writing to `conversations`, and stop `frontend-nextjs/app/api/session/route.ts` from injecting
        `conversations` history into the prompt.
      - Notes page day summaries use `session_summaries`.
      - One-off cleanup script to delete all demo-profile data after the show.

### 6. Deploy
- [ ] Deno Deploy from the owner's fork (owner pushes), secrets set in the dashboard.
- [ ] Vercel: owner imports the fork with Root Directory `frontend-nextjs`, production branch `tiat`,
      env vars from `.env.local`. Owner adds the Vercel URL to Supabase Auth Site URL + redirect URLs.
- [ ] Firmware PROD_MODE: `ws_server` = Deno Deploy host, `backend_server` = Vercel host (the device fetches
      its auth token and OTA updates from the Next.js app). Confirm OTA update works.
- [ ] TLS: PROD_MODE uses `CA_cert` / `Vercel_CA_cert` in `Config.cpp`. Set the correct root certificates for
      the Deno Deploy and Vercel hosts (check which root CAs those domains actually chain to) — a wrong cert
      means the board connects to WiFi but every secure connection fails.
- [ ] Confirm the Deno server runs on Deno Deploy as-is (it uses an npm `ws` WebSocketServer and writes debug
      PCM files when `DEV_MODE` is on — make sure that's off in production, the filesystem there is read-only).

### 7. Companion display app (iPhone kiosk)
See "Display app design spec" below and `design/app-sketch.jpg`. Build in this priority order and stop
wherever time runs out; each step must ship working on its own.
- [ ] 7a. Theme tokens file + fonts + mirror-icon nav shell + live Supabase subscription.
- [ ] 7b. Home ("Your Kit"): kit outline with product PNGs populating live (text label fallback).
- [ ] 7c. Products ("cupboard"): grid of slots → product detail (PNG, name, product notes).
- [ ] 7d. Notes: post-it per day (summary built from session_summaries + usage_events for that date) → day detail.
      If a day has usage events but no session summary, the post-it shows the products used that day in
      routine order (e.g. "cleanser, serum, SPF").
- [ ] 7e. Recs: placeholder page ("coming soon") only.

### 8. Stretch (after the show)
- [ ] Richer LLM-written daily note summaries on the Notes page.
- [ ] Background enrichment of unverified products (re-run lookup later, fill images from catalog).
- [ ] Recs page: proactive recommendations from usage + observations.
- [ ] Notes ↔ product-specific notes cross-links.

## Display app design spec

A read-mostly companion display, run full-screen on a dedicated iPhone next to the pouch
(Safari → Add to Home Screen, Guided Access). Separate route group in `frontend-nextjs/`
(e.g. `/display`, `/display/products`, `/display/products/[id]`, `/display/notes`, `/display/notes/[date]`,
`/display/recs`). No login on the device; it reads one profile (the exhibition demo profile at the gallery)
selected by a config value. Never show raw transcripts.

**Look**
- Background: dusty pink, Acne Studios–style. Start at `#EFD3D2`; owner will fine-tune.
- Text and all outlines/line art: blue. Start at a deep cobalt `#1F3FA8`; it must keep ≥4.5:1 contrast on the
  background for body text (check and report the ratio if the hex changes).
- Line-drawn, hand-sketched feel: thin blue strokes, no shadows, no gradients.
- Fonts: a cursive/script display font for page titles (e.g. "Your Kit"), owner to choose; a clean sans for
  body text. Load from Google Fonts. Titles only in script — never body text.
- Mirror icon (SVG, blue line art) top-left on every page = the nav. Tap → menu: Your Kit, Products, Notes, Recs.

**Modularity (required) — the owner must be able to restyle the app by dropping in files, without touching components.**

File structure (inside `frontend-nextjs/`):

```
design/                      ← everything visual is configured here; components only read from it
  theme.css                  colors, font-size scale, spacing, stroke widths, radii — CSS variables only
  fonts.ts                   font registry: { display, body } → family name + source (Google or local file)
  elements.ts                THE main design file: registry of every ornamental element and icon by name
  layout.ts                  kit-outline slot positions, cupboard grid size, post-it rotation range
public/design/
  ornaments/                 drop-in SVGs: pouch-outline.svg, cupboard.svg, post-it.svg, …
  icons/                     drop-in SVGs: mirror.svg, back.svg, close.svg, …
  fonts/                     drop-in local font files (.woff2), if not using Google Fonts
components/display/          KitOutline, ProductSlot, Cupboard, PostIt, MirrorNav, … (no styling decisions)
app/display/                 the routes
```

Rules:
- `design/elements.ts` is the single registry for ornaments AND icons, e.g.
  `{ pouchOutline: '/design/ornaments/pouch-outline.svg', cupboard: …, postIt: …, mirror: '/design/icons/mirror.svg' }`.
  Components render them only via `<Ornament name="pouchOutline" />` / `<Icon name="mirror" />`, never by importing
  a file path directly. Swapping a visual = drop a new SVG in the folder and change one line in `elements.ts`
  (or overwrite the file with the same name).
- Ornaments/icons are inlined so they recolor from the theme: author them with `stroke="currentColor"` /
  `fill="currentColor"` and no hard-coded colors. The loader should strip hard-coded fills/strokes from
  dropped-in SVGs (or warn) so a downloaded icon still picks up the theme blue.
- Fonts are swapped only in `design/fonts.ts`; colors/sizes only in `design/theme.css`. No hex values, font
  names or pixel sizes anywhere in components.
- Pages are composed from small components; layout decisions (positions, counts) come from `design/layout.ts`.
- Starting outline: `design/pouch-outline.svg` in the repo root (traced from the real pouch). Copy it to
  `public/design/ornaments/`, remove its background rect, and convert its stroke to `currentColor`.
- Slot positions in `layout.ts` are `{x, y, w, h}` in percent of the outline's box. Note: replacing the
  pouch outline with a different shape may need the slots nudged — keep a `?debug=1` mode that draws the
  slot boxes over the outline so they're easy to re-place.
- Product art, in priority order (store which one in `products.image_source`):
  1. **Owner's cut-out PNG** (transparent background) in Supabase Storage bucket `product-images`.
     Owner drops files into `assets/products/` named after the product (e.g. `cosrx-snail-essence.png`);
     a script `tools/upload-product-images` uploads them and sets `image_url` by matching names to
     `products` (prints unmatched files instead of guessing).
  2. **Beauty API `image_url`** from the lookup (regular product photo, usually on white). Display it with
     `mix-blend-mode: multiply` so a white background visually drops out against the pink; reference the
     URL rather than copying the file (licensing unverified).
  3. **Text label**: product name in blue, same slot size.
  An owner cut-out always wins; uploading one later replaces the photo automatically.
- Add a short `design/README.md` explaining how to swap a font, a color, an icon and an ornament (one example each).

**Pages**
- *Your Kit (home):* script title "Your Kit", the pouch/kit outline drawn in blue line art, and each product's
  background-less PNG placed in its slot as products are added/used. On a new usage event the slot pulses gently.
- *Products:* drawn like a cupboard — a blue line-art cabinet with cut-out cells (grid, ~12 cells to start;
  cell count from config). Each cell shows the product PNG + name; tap → product detail page with the PNG,
  name, and that product's notes (observations linked to it). Implement the cupboard as SVG/CSS so it
  scales with the number of products; an owner-supplied cupboard PNG may replace the frame later via config.
- *Notes:* post-it notes (yellow sticky-note style, blue handwriting-feel text, slight random rotation),
  one per day, labelled MM/DD with a 1–2 line summary of that day's routine. Tap → full day view: products
  used that day in routine order + observations. MVP summary is built from data (no LLM).
- *Recs:* title + "coming soon" in the same style.

**States:** idle (pouch closed) vs. listening (pouch open) shown subtly, e.g. the mirror icon gently
glows while a session is live.

## Repo map

Verified against the fork (`tiat` branch, upstream through `18d35fc` "adding gpt-live-1") on 2026-10-16.
Paths are relative to the repo root `ElatoAI/`.

**Firmware** (`firmware-arduino/`, PlatformIO, Arduino framework, env `esp32-s3-devkitc-1`, espressif32 6.10.0)
- `src/Config.h`: mode selectors — `DEV_MODE` (currently on) / `PROD_MODE` / `ELATO_MODE`; voice backend
  `VOICE_SERVER_DENO` (keep) / `VOICE_SERVER_CLOUDFLARE`; input mode `#define TOUCH_MODE` (currently on —
  comment out in task 2). `platformio.ini` also sets `-D TOUCH_SENSOR_ENABLE=1` (harmless).
- `src/Config.cpp`: `ws_server` / `ws_port` / `ws_path` + `backend_server` / `backend_port` per mode.
  DEV_MODE: both hosts are `172.20.10.4` (an iPhone-hotspot IP — **set the laptop IP in task 2**),
  `ws_port` 8000, path `/`, backend port 3000, plain `ws://` + `http://`. PROD_MODE: `wss://` on 443
  via `beginSslWithCA(..., CA_cert)` and `https://` to `backend_server` with `Vercel_CA_cert`
  (both cert strings are placeholders). **Pins already match our wiring table** (mic SD 14 / WS 4 / SCK 1
  on I2S_NUM_1; amp WS 5 / BCK 6 / DATA 7 / SD 10 on I2S_NUM_0; `BUTTON_PIN = GPIO_NUM_2`). LED pins
  13/9/8 are unused in our build. `MIC_SAMPLE_RATE` 16000, speaker `SAMPLE_RATE` 48000.
- `src/main.cpp`: `setup()` — non-touch mode calls `esp_sleep_enable_ext0_wakeup(BUTTON_PIN, LOW)` and creates
  an `ESP32_Button` with long-press-up and double-click callbacks (both set `sleepRequested`; single click
  detached). `loop()` calls `processSleepRequest()` → `enterSleep()` (amp SD LOW, stop I2S, close WS,
  `esp_deep_sleep_start()`). A comment mentions an "inactivity timeout" in `loop()` — **none exists**; the
  firmware has no session cap. Tasks: LED, speaker, mic (core 1), websocket network task (core 0).
- `src/Audio.cpp`: websocket client + audio pipeline (protocol below). Amp SD pin goes HIGH on
  `RESPONSE.CREATED` and LOW when listening/sleeping.
- `src/WifiManager.*`: captive portal SoftAP "ELATO-DEVICE" (192.168.4.1, `/wifi`). On WiFi connect
  (`connectCb`) it fetches the auth token if NVS has none, then calls `websocketSetup(ws_server, ws_port, ws_path)`.
- `src/OTA.*` (`/api/ota_update_handler`), `src/FactoryReset.h` (`/api/factory_reset_handler`),
  `src/LEDHandler.*`, `src/PitchShift.*`.
- `platformio.ini`: PSRAM lines (`memory_type = qio_opi` etc.) are commented out; upstream runs without
  PSRAM. Leave it unless task 2 hits memory problems.
- `test/print_mac_address_test.cpp` — read the board's MAC for device registration. Other useful tests:
  `mic_test.cpp`, `speaker_radio_test.cpp`, `opus_audio_loop_test.cpp`, `audio_stream_test.cpp`.

**Device↔server protocol** (what the fake device in task 1b must reproduce)
1. Token: `GET http://<backend>:3000/api/generate_auth_token?macAddress=<MAC>` → `{token}`. HS256 JWT
   signed with `JWT_SECRET_KEY`, claims `aud/role = authenticated`, `sub = user_id`, `email`, **no expiry**.
   With `NEXT_PUBLIC_SKIP_DEVICE_REGISTRATION=True` the token is always for `admin@elatoai.com`; otherwise
   for the user linked to that MAC in `devices`. Stored in NVS (`auth` / `auth_token`).
2. WebSocket `ws://<ws_server>:8000/` with headers `Authorization: Bearer <token>`, `X-Wifi-Rssi: <rssi>`,
   `X-Elato-Playback-Ack: 1`, `X-Device-Mac: <MAC>`. Server (`main.ts` upgrade handler) verifies the JWT
   with `JWT_SECRET_KEY`, loads the user by email (with `personality`, `language`, `device`), and uses the
   token as the Supabase auth for all queries — so **`JWT_SECRET_KEY` must be a secret the hosted project
   accepts**. MAC check is skipped in DEV_MODE and whenever the header is absent. Failure → HTTP 401.
3. Server → device, text JSON: first `{type:"auth", volume_control, is_ota, is_reset, pitch_factor}`
   (`is_ota`/`is_reset` → device restarts into OTA / reset). Then `{type:"server", msg}`:
   - `RESPONSE.CREATED` (+ optional `volume_control`) → device SPEAKING, amp on.
   - `RESPONSE.COMPLETE` / `RESPONSE.ERROR` → device returns to LISTENING 1 s later (amp off, mic flushed).
     Only sent when the response contained audio (tool-call-only responses send nothing).
   - `AUDIO.COMMITTED` → device PROCESSING. `SESSION.END` → device deep-sleeps.
   - If `playback_id` is present on CREATED/COMPLETE, the device instead drains playback and replies
     `{type:"instruction", msg:"PLAYBACK.COMPLETE", playback_id}`. The OpenAI path never sends `playback_id`.
4. Server → device, binary: Opus packets, 24 kHz mono, 120 ms frames, 24 kbps (`utils.ts`
   `createOpusPacketizer`); device decodes and plays at 48 kHz. Only accepted while SPEAKING.
5. Device → server, binary: **raw PCM16 LE, 16 kHz mono, not Opus**, sent in 64-byte chunks, **only while
   LISTENING**. Server forwards it as `input_audio_buffer.append`. ⚠ The OpenAI session declares input as
   24 kHz (`realtime/client.js` `_toGASessionPayload`) and `openai.ts` does not resample — fix in task 1b.
   (`grok.ts` and `openai-live.ts` already resample 16→24 kHz.)
6. Turn flow: after connect the device is PROCESSING and sends no audio until the greeting finishes
   (first `RESPONSE.COMPLETE` + 1 s). Turn detection is OpenAI `server_vad`. Half-duplex: the firmware
   never sends `end_of_speech` or `INTERRUPT` (the server handles both, unused).
7. Messages that arrive before OpenAI connects are queued and replayed as text (`isBinary=false`), so early
   audio would be dropped — harmless because the device sends none before the greeting.

**Known limits (accepted, not tasks)**
- Visitors can't interrupt the AI mid-reply: the mic is off while the device is speaking (half-duplex).
- The 5-minute session cap is enforced server-side only; the firmware has no timeout of its own.

**Implication for task 3 (lid trigger):** upstream already deep-sleeps and wakes when GPIO 2 goes LOW —
which is exactly "pouch opened". Smallest change: keep that wake path; add "GPIO 2 HIGH held ≥300 ms →
`sleepRequested = true`" (pouch closed). This replaces the earlier "no deep sleep" idea: owner to confirm
(trade-off: simpler and proven, but ~2–3 s WiFi reconnect on each open; mask it with the open tone).
For `LID_TEST_BOOT_BUTTON`, GPIO 0 is also an RTC IO, so ext0 wake works on it too.

**Edge server** (`server/deno/`, entry `main.ts`; run `deno run -A --env-file=.env main.ts`)
- `main.ts`: `node:http` server + npm `ws` `WebSocketServer` (noServer, no permessage-deflate). Upgrade
  handler does auth (above). On connection: opens a debug PCM file if DEV_MODE, `getChatHistory`,
  `createFirstMessage` + `createSystemPrompt(chatHistory, payload)`, sends the `auth` message, picks
  provider from `user.personality.provider` (or `openai-live` via `OPENAI_LIVE_USER_IDS`) and calls e.g.
  `connectToOpenAI(providerArgs)`. Listens on `HOST:PORT` (8000) in DEV_MODE, **port 8080 otherwise**.
- `supabase.ts`: `getSupabaseClient(userJwt)`, `getUserByEmail`, `getDeviceInfo`, `getChatHistory` (line 60;
  last 20 `conversations` rows for user + personality), `createSystemPrompt` (line 171) — **replace the chat
  history with our context brief here**. `UserPromptTemplate` uses `users.supervisee_name/age/persona`.
  `addConversation` (line 201) writes transcripts.
- `models/openai.ts`: OpenAI Realtime via `realtime/client.js` (`RealtimeClient`). Tools are registered with
  `client.addTool(...)` under `// ADD TOOL CALLS HERE` — an `end_session` tool already exists and sends
  `{type:"server", msg:"SESSION.END"}`. **Add our tools here; reuse SESSION.END for the check-in stop rules
  and the 5-min cap.** `client.js` runs tool handlers and then calls `createResponse()` automatically.
  Transcripts saved via `addConversation` at lines ~103 (assistant) and ~182 (user). Session options: model
  `gpt-realtime-2.1`, `server_vad` (threshold 0.4, prefix 400 ms, silence 1000 ms), voice
  `personality.oai_voice` (default `ash`), `input_audio_transcription: gpt-realtime-whisper`,
  `instructions: systemPrompt`. First message is sent as a system item + `response.create` on `session.created`.
- `utils.ts`: `authenticateUser` (jose HS256 verify), Opus encoder/packetizer, `isDev`
  (`DEV_MODE === "True"`), PCM helpers. Other providers in `models/`: ignore.
- `.env.example`: `SUPABASE_URL`, `SUPABASE_KEY` (anon), `JWT_SECRET_KEY`, `ENCRYPTION_KEY`,
  `OPENAI_API_KEY`, `HOST`, `PORT=8000`, `DEV_MODE=True`. Other provider keys and the `OPENAI_LIVE_*` /
  `BOSON_*` / `GROK_*` overrides can stay blank. Ours add `BEAUTY_API_KEY` (and optional `SEARCH_API_KEY`).

**Database** (`supabase/`; CLI linked to hosted project `smart_pouch`, ref `ormchbazdipjwkhlprhc`)
- `migrations/`: `20250417155518_remote_schema.sql` (extensions incl. `vector`; tables api_keys,
  conversations, devices, languages, personalities, users; `match_documents` fn) + 5 later migrations:
  `20250603145138_add_pitch_factor`, `20250604180849_add_first_message`, `20250611011151_add_provider`,
  `20260901072000_add_boson_voices` (provider check), `20260911090000_add_openai_live_provider`.
  On 2026-10-16 none were applied to the hosted DB yet. Our new migrations go here with a later timestamp.
- `seed.sql`: `auth.users` + `public.users` row for **`admin@elatoai.com` / password `admin`** (default
  personality "Aria"), ~40 personalities, 4 languages.
- `users.device_id` → `devices` (`mac_address`, `user_code`, `volume`, `is_ota`, `is_reset`).
- **Upstream RLS is wide open:** anon can read `users`, `devices`, `personalities`; `conversations` has
  `USING (true)` for all commands; anyone can update `devices`; anon can update `users`. The display app ships
  the anon key, so task 5 must tighten these (at least `conversations`, `users`).

**App** (`frontend-nextjs/`, Next.js + Tailwind + shadcn `components/ui/`; `next` and `@supabase/*` are
pinned to `latest` in package.json — install with `npm ci` to respect `package-lock.json`)
- Supabase clients in `utils/supabase/` (client, server, middleware); data helpers in `db/` (conversations,
  devices, inbound, languages, personalities, supabase types, users).
- `app/api/generate_auth_token/route.ts` — mints the device token (see protocol step 1).
  `app/api/ota_update_handler`, `app/api/factory_reset_handler` — device OTA / reset.
- `app/api/session/route.ts` + `app/components/Realtime/` — the in-browser chat (WebRTC straight to OpenAI;
  **does not go through the Deno server**, hence the fake device in task 1b). It also injects
  `conversations` history into its prompt, and `Realtime/components/Transcript.tsx` writes transcripts via
  `dbInsertTranscriptItem` (task 5 removes both).
- `.env.example`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `JWT_SECRET_KEY`,
  `ENCRYPTION_KEY`, `OPENAI_API_KEY`, `NEXT_PUBLIC_SKIP_DEVICE_REGISTRATION` (True for dev);
  `GOOGLE_OAUTH` defaults to True in the example — set `False`; leave Stripe blank.
- Display app (task 7) goes in new `app/display/`, `components/display/`, `frontend-nextjs/design/`,
  `public/design/`.

**Design inputs** (repo root `design/`, not `frontend-nextjs/design/`): `app-sketch.jpg`,
`pouch-outline.svg`. Claude Code permissions live in `.claude/settings.json`.

**Ignore:** `server/cloudflare/`, `server/fastapi/`, landing-page/pricing/order components.

## Status log

Append one line per finished task or session (date, task, result, anything unverified or deferred), so a
fresh session after `/clear` knows exactly where things stand.

- 2026-10-16 — Task 0 done. Repo map verified and corrected (added device↔server protocol; found the 16→24 kHz
  input-rate bug in `openai.ts`, now a task-1b item; browser-chat transcript removal added to task 5).
  Setup checked: Supabase CLI logged in + linked to `smart_pouch`, hosted DB reachable, 0/6 migrations applied;
  `server/deno/.env` and `frontend-nextjs/.env.local` exist and are gitignored (not read); `products.md` has 4
  products; deno/node/npm/pio installed; `frontend-nextjs/node_modules` not installed yet. Renamed
  `design/app-sketch.JPG` → `.jpg`; Claude Code permissions moved to `.claude/settings.json` (by owner).
  Unverified before task 1: that the hosted project accepts HS256 tokens signed with `JWT_SECRET_KEY`
  (Dashboard → Project Settings → JWT Keys). Not committed.
- 2026-10-16 — Brief fixes: hardware day is Saturday; edge server writes summaries, not transcripts; 5b web
  fallback rewritten; `product_catalog.source` has one value list; task 7 runs today as session B, 7d uses
  `session_summaries` + `usage_events`; task 3 adds the RTC pull-up before deep sleep; profile decision logged;
  `.claude/settings.json` also denies reading `.env.local`. Not committed.

## Decisions log

- OpenAI Realtime chosen over chained STT→LLM→TTS for latency and because it's Elato's most-tested path.
  Claude has no realtime speech API; Claude may be used for post-session extraction.
- Hosted Supabase instead of local Docker (speed on macOS).
- Breadboard is optional; final wiring is F-F jumpers + Wago connectors.
- Seed (task 1): apply `supabase/seed.sql` as-is to the hosted DB; the owner changes the `admin@elatoai.com`
  password immediately afterwards.
- Known limits accepted, not tasks: no barge-in (half-duplex), and the 5-minute cap is server-side only
  (see "Known limits" in the Repo map).
- Profiles (task 5): a profile is a `profile_id` text value, `'owner'` or `'demo'`, chosen by a new
  `profile_id` column on `devices` (default `'demo'`). No extra user accounts.

## Appendix: The Beauty API reference (provided by The Beauty API for coding agents)

Base URL: https://api.thebeautyapi.com/v1 (JSON over HTTPS)
Auth: send the header `x-api-key: $BEAUTY_API_KEY` on every /v1 request. Keep the key in an environment
variable (`server/deno/.env` locally, Deno Deploy secrets in production), never in code or in this file.
Reference: https://thebeautyapi.com/docs.md | Spec: https://api.thebeautyapi.com/openapi.json

Endpoints
- Health: `GET /health` (no key)
- Search products: `GET /v1/products/search?q=&page=`
- Filter products: `GET /v1/products?category=&brand=&origin=&fragrance_free=&alcohol_free=&paraben_free=&sulfate_free=&silicone_free=&has_ingredient=&excludes_ingredient=&page=`
- Get a product: `GET /v1/products/{id}`
- Batch products: `POST /v1/products/batch` (body `{"ids": [uuid, ...]}`, max 50)
- Search ingredients: `GET /v1/ingredients/search?q=&page=`
- Get an ingredient: `GET /v1/ingredients/{id}`

Rules
1. Find a product with search, then fetch the full record with `GET /v1/products/{id}`. Search and filter return
   slim records (id, brand, name, category, image_url); detail and batch return the full record with the
   ingredient list in on-label order.
2. Every word in q must appear in the product's brand or name, in any order. Send the brand plus the distinctive
   part of the name ("CeraVe Moisturizing Cream"), never a full retail title. Case, accents and punctuation are
   ignored; the last word may be partial.
3. When `pagination.total` is 0 the response carries a `no_match` object: drop the word `no_match.hint` names
   and retry. An empty result does not mean the brand is missing.
4. Pages hold 20 results; page runs 1 to 51 and anything higher returns 400. Read `pagination.total` and
   `pagination.has_more`; above 1,020 matches, narrow with filters instead of paging.
5. Batch takes up to 50 ids and is billed per item (50 ids = 50 calls); unknown ids come back as null in the
   same positions.
6. Errors are JSON `{statusCode, error, message}` and message says what to change. 403 is a missing or revoked
   key. 429 is the rate limit; no rate-limit headers are sent, so back off exponentially.
7. `image_url` can be null.

Project-specific notes
- Use `GET /health` in the startup check, not a billed call.
- Never use batch or paging during a live conversation: one search (+ one hint retry) and one detail fetch, max.
- Before writing the client, fetch the OpenAPI spec once and derive types from it rather than guessing fields.
