# OBS Dual iPhone Cam

🇪🇸 [Leer en español](README.es.md)

Use 2 (or more) iPhones as cameras in OBS **with no paid apps** (no Camo, no
EpocCam, no iVCam) — just Safari on the iPhone and a small Node.js server
running on your Mac. Includes **basic digital stabilization** based on the
iPhone's gyroscope.

| Studio (remote control) | Home page |
|---|---|
| ![Studio](screenshots/studio.png) | ![Home](screenshots/index.png) |

## How it works

```
iPhone 1 (Safari) ─┐                          ┌─ OBS ("Browser" source)
                    ├─ WebRTC (P2P, same WiFi) ┤
iPhone 2 (Safari) ─┘                          └─ sees both videos live
```

- Each iPhone opens a page (`sender.html`) that turns on the camera,
  applies real-time digital stabilization, and sends the video over WebRTC.
- Your Mac runs `server.js`: it serves the pages over HTTPS (required for
  Safari to allow camera access) and acts as a "switchboard" (signaling) so
  the iPhones and OBS can find each other.
- In OBS you add a **Browser** source pointing at `receiver.html`, which
  receives both videos and displays them — OBS treats it as a live video
  source, no virtual camera or driver needed.

Everything runs on your local network; nothing gets uploaded to the internet.

## Requirements

- A Mac (or PC) with [Node.js](https://nodejs.org) installed (v18+).
- The iPhones and the computer on the **same WiFi network**.
- OBS with the **"Browser" source**, which it already ships with.

## Installation

```bash
cd obs-dual-iphone-cam
npm install
node server.js
```

The first time, the server automatically generates a self-signed HTTPS
certificate and prints something like this:

```
First, create your cameras (with their PIN) from the studio:
  http://192.168.1.23:8080/studio.html

From each iPhone (Safari, same WiFi as this computer), open:
  https://192.168.1.23:8443/sender.html
  ...and enter the 4-digit PIN the studio gave you for that camera.

In OBS, add a "Browser" source pointing at:
  http://localhost:8080/receiver.html
```

> **Important:** for OBS use **`http://localhost:8080`** (no "s"), not
> HTTPS. OBS's embedded browser (CEF) has no way to "accept" a self-signed
> certificate — there's no prompt to click through like in Safari — so if
> you give it an HTTPS URL it just stays black, with no visible error.
> `receiver.html` doesn't use the camera, so it doesn't need HTTPS: that's
> why the server also serves plain HTTP on port 8080, just for this.

Leave this terminal open (the server needs to keep running while you're
streaming).

### Home page

Open `http://<Mac-IP>:8080/` (or `https://<Mac-IP>:8443/` from the Mac/iPhone
itself) — it gives you direct links to the studio and the OBS receiver,
ready to copy or open. The cameras themselves are created from the studio
(see "Studio — remote control" below), not from here.

## Step by step

### 1. On each iPhone

1. **First, create the camera from the studio** (`studio.html`, "+ Add
   camera" button) — it gives you a **4-digit PIN** for that specific
   camera (see "Studio" below).
2. Open Safari on the iPhone (it has to be Safari, not Chrome, for the
   motion/gyroscope permission on iOS) and visit
   `https://192.168.1.23:8443/sender.html` — it will ask for that PIN.
   Type it and tap "Enter". **There's no shortcut via the URL**: the PIN
   is the only way to identify yourself as a specific camera (2026-09-12,
   deliberately removed for security — there used to be a `?id=camN` that
   skipped the PIN).
3. Safari will show **"This Connection Is Not Private"** because the
   certificate is self-signed (normal, it's your own server). Tap
   **"Show Details" → "visit this website" → "Visit Website"**.
4. Tap **"Start camera and connect"**. Accept the camera and
   motion/orientation permissions iOS asks for (the motion one is needed
   for stabilization).
5. Below, you'll see the status go from "connecting" to **"connected ✔"**
   once you open `receiver.html` in step 2. You can uncheck
   "Stabilization" if you prefer the uncropped image, or check "Front
   camera" to use the selfie camera.
6. Leave the iPhone with the screen on and on a stand/tripod (digital
   stabilization corrects hand shake, it doesn't replace a tripod).

### 2. In OBS (on the Mac)

1. Add a new source → **Browser**.
2. URL: `http://localhost:8080/receiver.html` (no "s" — see note above,
   and **no `?ids=`** — see "Choosing cameras" below, selection now
   happens inside the page itself, no need to put it in the URL).
3. Width/height: whatever your scene uses (e.g. 1920×1080).
4. Enable "Refresh browser when scene becomes active" if you'll be
   switching scenes.
5. Right-click the source → **Interact**, tap the ⚙ gear icon (top
   right) and check which cameras you want to see — they arrange
   themselves into a grid.

If you want each camera in its own separate source (so you can move or
crop them independently in the scene), just add as many Browser sources
as cameras, each with a single fixed id in the URL: `?ids=cam1`,
`?ids=cam2`, etc. (this still works exactly as before — see "Fixed mode"
below).

## Choosing cameras (live selector, no URL editing)

Since v2 (2026-09-12) you no longer need to write/edit `?ids=cam1,cam2`
every time you add or remove an iPhone. With the Browser source pointing
at plain `receiver.html`:

1. Right-click the source in OBS → **Interact**.
2. Tap the ⚙ in the top-right corner — a list of iPhones connected RIGHT
   NOW opens (it refreshes itself every 3s).
3. Check the ones you want to show. The grid recalculates itself.

The selection is saved (in that source's own browser) — if you close and
reopen OBS, it keeps showing the same cameras without you having to
choose them again.

**Fixed mode (backward compatibility)**: if you set `?ids=cam1,cam2`
explicitly in the URL, it behaves exactly as before (fixed list, no
selector or gear icon) — useful if you'd rather keep controlling it that
way, or for separate sources per camera (see above).

## More than 2 cameras

There's no fixed limit — use whatever `id` you want (`cam1`, `cam2`,
`cam3`, `cam4`...) on each iPhone. The receiver's gear icon detects them
on its own (see above); if you prefer fixed mode, add them separated by
commas: `?ids=cam1,cam2,cam3,cam4`. The grid arranges itself based on how
many feeds there are (2 → one row of 2, 4 → 2×2, etc.) — if you want to
force a specific number of columns, add `&layout=cols-3`.

The home page (see above) keeps generating each sender's link for you (to
copy to the iPhones); you never need to build the receiver URL by hand at
all.

## Studio — remote control (2026-09-12)

`http://<Mac-IP>:8080/studio.html` is a third page, separate from the
per-camera ones and the OBS one, meant for managing everything from one
place (say, an iPad next to the control desk) without touching the
iPhones or the OBS source:

- **Live preview** of every connected camera.
- **Add camera**: cameras are created ONLY from here (the "+" button).
  Each one is born with a unique **4-digit PIN** — that's what you hand
  to whoever is holding the iPhone (see "1. On each iPhone" above).
  Without creating it from the studio, there's no valid PIN to use it.
- **Delete camera**: 🗑 button on each card — wipes it completely (name
  and PIN); if that iPhone still has `sender.html` open, it's left unable
  to reconnect until it's given a new PIN from another camera.
- **Name**: give each camera a name (saves itself, survives a server
  restart) — shown on the iPhone itself, in the receiver's selector, and
  right here.
- **Manual focus**: if the connected iPhone supports it (not all expose
  it through the browser), a focus control shows up alongside
  Quality/Stabilization/Color.
- **Manual exposure**: same criteria as focus (only shows up if the
  device supports it) — useful when the camera gets it wrong with very
  contrasty lighting.
- **Automatic white balance**: an "⚪" button that asks the camera to
  recalibrate white balance right now (handy when the light changes —
  from a window to a lamp, for instance). It's a one-off action, not a
  saved value; like focus, it only shows up/does anything if THAT iPhone
  supports it.
- **Quality, Stabilization, Color, Focus and Exposure remotely**: the
  same controls from `sender.html`, but driven from the studio — they're
  applied to the iPhone live (same mechanism that already lets you change
  them without restarting, see below), without anyone having to touch the
  phone.
- **Each camera's last setting is remembered**: quality, stabilization,
  color, focus and exposure are saved per camera (alongside its PIN, in
  `cameras.json`) every time they're actually changed — whether from the
  iPhone itself or from the studio. The next time that camera connects
  (even a different iPhone with the same PIN, or after restarting the
  server), it starts up with those values instead of always reverting to
  factory defaults.
- **`sender.html` link**, ready to copy and send to whoever is holding the
  iPhone — it's the same for every camera (generic, no `?id=`); what
  identifies EACH camera is its card's PIN, not the URL.
- **Cloudflare Tunnel**: a button to expose the pages (cameras, receiver,
  the studio itself) with a real public HTTPS URL `*.trycloudflare.com`
  — real Cloudflare HTTPS, no self-signed certificate warning.

**Real limitation, so it doesn't surprise you**: the tunnel solves the
*pages* being reachable from another network — it doesn't by itself solve
the *video* (WebRTC, a direct connection between the iPhone and the Mac)
traversing any NAT. It works fine between "normal" networks; on mobile
data or very restrictive networks (symmetric NAT/CGNAT) the video may
fail to connect even though the page loads fine, without a separate TURN
server — not included in this version, it would be a separate piece if
needed down the line.

**If the tunnel button gives an error like "couldn't launch cloudflared"**:
the `cloudflared` binary isn't installed (or isn't in the `PATH`) on that
particular Mac — install it with `brew install cloudflared` and try
again. The studio shows this exact message in red if it happens.

## Live color adjustment

`sender.html` has 3 controls (Brightness, Contrast, Saturation — 50%-150%
for the first two and 0%-200% for saturation) that apply to the video in
real time, without touching "Stop"/"Start" (same as Quality and
Stabilization). Useful for matching the tone of 2 different cameras (a
newer iPhone tends to look different from an older one) or compensating
for yellowish/greenish ambient light. The "↺ Reset" button brings them
all back to 100%.

## Image quality

`sender.html` has a **Quality** selector with 3 levels:

| Preset | Resolution requested from the camera | Target bitrate |
|---|---|---|
| 720p  | 1280×720  | 3 Mbps |
| 1080p | 1920×1080 | 6 Mbps (default) |
| 1440p | 2560×1440 | 10 Mbps |

Besides requesting that resolution from the camera, the page now:
- Explicitly sets the WebRTC connection's **maximum bitrate** (it used to
  be left at the browser's default, which tends to start very low and
  doesn't always climb on home WiFi networks — hence the blurry image you
  were seeing).
- Tells the encoder to **prioritize sharpness over fps** if bandwidth is
  short (`degradationPreference: "maintain-resolution"`).
- Prefers the **H.264** codec when the browser allows it, which on the
  iPhone is encoded in hardware and keeps more detail than the default
  codec (VP8) at the same bitrate.
- Shows a line below the status with the resolution and fps actually
  being **sent** (`sending: 1920x1080 @ 30fps · ...`), useful to confirm
  the chosen level is really being applied and nothing (weak WiFi, a
  camera that doesn't support that resolution) is silently dragging
  quality down.

Changing the Quality selector applies live (2026-09-12): the resolution
is re-requested from the same already-active camera (`applyConstraints`,
no need to restart getUserMedia) and the maximum bitrate is adjusted on
the fly over the already-established connection — no need to touch
"Stop"/"Start". The same goes for Stabilization. Only "Front camera"
still needs a restart, because it switches to a different physical
camera (front↔back), it's not a simple adjustment on the same one.

**If it still looks blurry**, it's almost always the WiFi not sustaining
the chosen bitrate (more common on the 2.4GHz band or with the router far
away): try dropping to 720p, moving the iPhone closer to the router, or
using the 5GHz band if your router separates them.

## About the stabilization

It's a **digital** (not optical) stabilization, meant to smooth out hand
shake — it's not as good as Apple's "Cinematic" mode, but it's free and
runs in real time. It now has a **Stabilization** selector with 4 levels
(Off / Soft / Medium / Strong) right in `sender.html`, no code editing
needed.

How it works, in two stages:
1. **High-pass filter**: integrates the gyroscope (`devicemotion`) and
   lets that value decay with a time constant — so fast shake gets
   corrected, but a slow, intentional pan (moving the camera on purpose)
   "forgets itself" and isn't fought against.
2. **Smoothing**: the value actually applied to the crop is interpolated
   frame by frame, so the correction itself doesn't jitter from sensor
   noise.

The crop (and therefore the "zoom" you sacrifice) grows with the level:
Soft crops ~7%, Medium ~12%, Strong ~18%. If you need more correction for
strong shake, try "Strong"; if you notice it looks "floaty" or loses too
much framing, drop down to "Soft".

If you want to fine-tune the exact numbers, they're in
`public/sender.html`, in the `STAB_PRESETS` object (`marginRatio`,
`gain`, `tau`, `smoothTau`).

Tip: the more light there is, the better the image looks in general (like
any phone camera), and a cheap stand/mini tripod helps more than any
digital stabilization — digital corrects hand shake, it doesn't replace a
fixed support point.

## Automatic reconnection

If the WiFi drops for a moment mid-stream (or the WebRTC video itself
drops from a network hiccup even while signaling stays alive),
`sender.html` retries on its own — no need to touch Stop/Start by hand.
The camera never shuts off during this, only the signaling/video
reconnects; the screen shows "connection lost, retrying..." while it
does. This ONLY kicks in after a "Start" that succeeded and until "Stop"
is tapped on purpose — a drop before starting, or a deliberate Stop, never
triggers a retry.

## Common issues

- **"Nothing shows up in receiver.html"**: check that the camera is
  checked in the receiver's ⚙ selector (see "Choosing cameras" above) and
  that the iPhone is still on the page showing "connected ✔".
- **Won't connect / stuck on "waiting"**: confirm the iPhone and Mac are
  on the same WiFi, and that the router doesn't have "client
  isolation"/"AP isolation" enabled (common on guest networks) — that
  blocks direct connections between devices even on the same network.
- **Safari doesn't offer the camera**: it only works in a secure context
  (HTTPS), which is why the server generates a certificate — make sure to
  accept the untrusted-certificate warning the first time.
- **Cuts out when the screen locks**: the iPhone can pause the camera in
  the background; keep the screen on during the stream (the page already
  asks to keep the screen active via Wake Lock, but iOS can ignore it in
  some cases).
- **I also want audio**: in `sender.html`, change `audio: false` to
  `audio: true` inside `constraints` — but if you use 2 iPhones with
  audio at once you'll get 2 simultaneous sound sources, better to manage
  audio separately (e.g. only on one of the two).

## Project structure

```
obs-dual-iphone-cam/
├── server.js          HTTPS server + WebSocket signaling + API (cameras/tunnel)
├── mini-static.js      static file server (no dependencies)
├── package.json
├── LICENSE             MIT
├── certs/              self-signed certificate (generates itself, don't share it)
├── cameras.json         id -> {name, pin, settings} for each camera (generates itself)
└── public/
    ├── index.html      direct links to the studio, the sender and the receiver
    ├── sender.html     page each iPhone opens (asks for the PIN)
    ├── receiver.html   page you set as a "Browser" source in OBS
    └── studio.html     create cameras (with their PIN), remote control, tunnel
```

## License

[MIT](LICENSE) — © 2026 [Nicolás Sierra](https://github.com/nicolasierra)
