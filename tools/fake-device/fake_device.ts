// Fake ESP32 device: talks to the Deno edge server exactly like firmware-arduino/src/Audio.cpp does,
// using the laptop mic (sox `rec`) and speakers/headphones (sox `play`).
// Start = pouch opened. Ctrl-C = pouch closed.
//
//   cd tools/fake-device && deno task start [--backend URL] [--ws URL] [--mac MAC]
//
// Protocol (see "Device↔server protocol" in CLAUDE.md):
//   1. GET <backend>/api/generate_auth_token?macAddress=<MAC> → {token}
//   2. WebSocket <ws> with Authorization / X-Wifi-Rssi / X-Elato-Playback-Ack / X-Device-Mac headers
//   3. Up: raw PCM16 LE, 16 kHz mono, 64-byte binary chunks, only while LISTENING
//   4. Down: Opus packets (24 kHz mono, 120 ms frames), accepted only while SPEAKING
//   5. Text: RESPONSE.CREATED → SPEAKING; RESPONSE.COMPLETE/ERROR → LISTENING after 1 s;
//      AUDIO.COMMITTED → PROCESSING; SESSION.END → exit (the board would deep-sleep)

import { parseArgs } from "jsr:@std/cli@1/parse-args";
import WebSocket from "npm:ws@8";
import { Decoder } from "npm:@evan/opus@^1.0.3";

const args = parseArgs(Deno.args, {
  string: ["backend", "ws", "mac"],
  default: {
    backend: "http://localhost:3000",
    ws: "ws://localhost:8000/",
    mac: "98:C3:77:B5:1B:70", // the real board's MAC (registered in `devices`)
  },
});

const MIC_RATE = 16000; // firmware MIC_SAMPLE_RATE
const MIC_CHUNK = 64; // firmware MIC_COPY_SIZE
const OPUS_RATE = 24000; // server createOpusPacketizer
const LISTEN_DELAY_MS = 1000; // firmware: scheduledTime = millis() + 1000

type State = "IDLE" | "PROCESSING" | "LISTENING" | "SPEAKING";
let state = "IDLE" as State;
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const setState = (s: State, why: string) => {
  if (s !== state) log(`state ${state} → ${s} (${why})`);
  state = s;
};

// --- 1. auth token (the board fetches this once and keeps it in NVS) ---
const tokenRes = await fetch(`${args.backend}/api/generate_auth_token?macAddress=${encodeURIComponent(args.mac)}`);
const tokenBody = await tokenRes.json().catch(() => ({}));
if (!tokenRes.ok || !tokenBody.token) {
  console.error(`token request failed (${tokenRes.status}):`, tokenBody);
  Deno.exit(1);
}
log(`got auth token for MAC ${args.mac}`);

// --- audio I/O via sox ---
const rec = new Deno.Command("rec", {
  args: ["-q", "--buffer", "1024", "-t", "raw", "-r", String(MIC_RATE), "-e", "signed-integer", "-b", "16", "-c", "1", "-"],
  stdout: "piped",
  stderr: "inherit",
}).spawn();
// Open the mic BEFORE the speaker. Bluetooth headsets (e.g. AirPods) switch from 48 kHz music mode to a
// 16/24 kHz headset mode when the mic opens; if `play` is already running it keeps converting for the old
// rate and everything plays at half speed, an octave down. So wait for mic data, let the switch settle, then open `play`.
const micReader = rec.stdout.getReader();
await micReader.read(); // first mic data (dropped: we're not LISTENING yet)
await new Promise((r) => setTimeout(r, 1000));
const play = new Deno.Command("play", {
  args: ["-q", "--buffer", "2048", "-t", "raw", "-r", String(OPUS_RATE), "-e", "signed-integer", "-b", "16", "-c", "1", "-"],
  stdin: "piped",
  stderr: "inherit",
}).spawn();
const speaker = play.stdin.getWriter();
const decoder = new Decoder({ channels: 1, sample_rate: OPUS_RATE });

// Laptop note: the server sends RESPONSE.COMPLETE when generation ends, not when playback ends. The board's
// small playback buffer throttles reads so the two roughly coincide; a laptop receives everything at once.
// So we go back to LISTENING at max(COMPLETE, local playback end) + 1 s, instead of cutting playback off.
let playbackEndsAt = 0;
let completeAt = 0;
let listenTimer: ReturnType<typeof setTimeout> | undefined;
let sentBytes = 0;
let receivedPackets = 0;

// --- 2. WebSocket with the firmware's headers ---
const ws = new WebSocket(args.ws, {
  headers: {
    Authorization: `Bearer ${tokenBody.token}`,
    "X-Wifi-Rssi": "-50",
    "X-Elato-Playback-Ack": "1",
    "X-Device-Mac": args.mac,
  },
  perMessageDeflate: false,
});

const shutdown = async (why: string, code = 0) => {
  log(`shutting down: ${why}`);
  clearTimeout(listenTimer);
  try { ws.close(); } catch { /* already closed */ }
  try { rec.kill("SIGTERM"); } catch { /* already exited */ }
  try { await speaker.close(); } catch { /* already closed */ }
  setTimeout(() => Deno.exit(code), 300);
};
Deno.addSignalListener("SIGINT", () => shutdown("Ctrl-C (pouch closed)"));

ws.on("unexpected-response", (_req: unknown, res: { statusCode: number }) => {
  console.error(`WebSocket upgrade rejected: HTTP ${res.statusCode}`);
  shutdown("auth failed", 1);
});
ws.on("error", (e: Error) => { console.error("WebSocket error:", e.message); shutdown("ws error", 1); });
ws.on("open", () => setState("PROCESSING", "connected; waiting for greeting"));
ws.on("close", (code: number) => shutdown(`server closed the socket (code ${code})`));

const scheduleListening = () => {
  clearTimeout(listenTimer);
  const at = Math.max(completeAt, playbackEndsAt) + LISTEN_DELAY_MS;
  listenTimer = setTimeout(() => {
    if (Date.now() < playbackEndsAt + LISTEN_DELAY_MS) return scheduleListening(); // more audio arrived late
    setState("LISTENING", "reply finished; mic open");
  }, Math.max(0, at - Date.now()));
};

ws.on("message", (data: Uint8Array, isBinary: boolean) => {
  if (isBinary) {
    // Firmware drops audio unless SPEAKING (and once a listening restart is scheduled; we keep it so the tail plays).
    if (state !== "SPEAKING") return;
    receivedPackets++;
    const pcm = decoder.decode(data);
    const now = Date.now();
    playbackEndsAt = Math.max(playbackEndsAt, now) + (pcm.length / 2 / OPUS_RATE) * 1000;
    speaker.write(pcm).catch(() => {});
    if (completeAt) scheduleListening();
    return;
  }

  let msg: any;
  try { msg = JSON.parse(data.toString()); } catch { return log("non-JSON text:", data.toString()); }

  if (msg.type === "auth") {
    log(`auth: volume=${msg.volume_control} pitch=${msg.pitch_factor} ota=${msg.is_ota} reset=${msg.is_reset}`);
    if (msg.is_ota || msg.is_reset) log("(the board would restart into OTA / factory reset here)");
    return;
  }
  if (msg.type !== "server") return log("text:", JSON.stringify(msg));

  switch (msg.msg) {
    case "RESPONSE.CREATED":
      clearTimeout(listenTimer);
      completeAt = 0;
      receivedPackets = 0;
      setState("SPEAKING", "RESPONSE.CREATED");
      break;
    case "RESPONSE.COMPLETE":
    case "RESPONSE.ERROR":
      if (msg.playback_id) log(`note: playback_id ${msg.playback_id} present (OpenAI path never sends this)`);
      log(`${msg.msg}: ${receivedPackets} Opus packets this reply`);
      completeAt = Date.now();
      scheduleListening();
      break;
    case "AUDIO.COMMITTED":
      log(`AUDIO.COMMITTED (${sentBytes} bytes of mic audio sent this turn)`);
      sentBytes = 0;
      setState("PROCESSING", "server committed user audio");
      break;
    case "SESSION.END":
      shutdown("SESSION.END (the board would deep-sleep)");
      break;
    default:
      log("server:", JSON.stringify(msg));
  }
});

// --- 3. mic loop: 64-byte PCM16 chunks, only while LISTENING (otherwise dropped = firmware's mic flush) ---
let pending = new Uint8Array(0);
while (true) {
  const { value: block, done } = await micReader.read();
  if (done) break;
  if (state !== "LISTENING" || ws.readyState !== WebSocket.OPEN) {
    pending = new Uint8Array(0);
    continue;
  }
  const buf = new Uint8Array(pending.length + block.length);
  buf.set(pending);
  buf.set(block, pending.length);
  let off = 0;
  for (; off + MIC_CHUNK <= buf.length; off += MIC_CHUNK) {
    ws.send(buf.subarray(off, off + MIC_CHUNK), { binary: true });
    sentBytes += MIC_CHUNK;
  }
  pending = buf.slice(off);
}
