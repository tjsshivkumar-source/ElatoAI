# Fake device

Talks to the Deno edge server exactly like the ESP32 firmware (`firmware-arduino/src/Audio.cpp`), using the
laptop mic and headphones, so server work (check-ins, tools, memory) can be tested without the board.

## Needs

- `sox` (`brew install sox`) for `rec` / `play`
- Next.js app on :3000 (issues the device token) and the Deno server on :8000 (`deno run -A --env-file=.env main.ts`)
- `JWT_SECRET_KEY` identical in `frontend-nextjs/.env.local` and `server/deno/.env` (otherwise the server answers 401)
- Headphones, so the AI doesn't hear itself

## Run

```sh
cd tools/fake-device
deno task start                       # start = pouch opened
# Ctrl-C                              # = pouch closed
deno task start --mac AA:BB:CC:DD:EE:01 --backend http://localhost:3000 --ws ws://localhost:8000/
```

Wait for `state SPEAKING → LISTENING` before talking: like the board, the mic is only sent while LISTENING.

## Differences from the board (deliberate)

- **Back to LISTENING** 1 s after the later of `RESPONSE.COMPLETE` and local playback end. The board goes back
  1 s after `COMPLETE` and flushes its speaker; its small playback buffer throttles network reads so the two
  roughly coincide, but a laptop receives the whole reply at once and would cut it off.
- **Mic opens before the speaker.** Bluetooth headsets switch to a 16/24 kHz headset mode when the mic opens;
  if `play` was already running, replies play at half speed, an octave down.
- The token is fetched on every start (the board stores it in NVS once).

## Checking what the server heard

In DEV_MODE the server writes the raw mic input to `server/deno/debug_audio_<ts>.pcm` (s16le, 16 kHz mono):

```sh
sox -t raw -r 16000 -e signed-integer -b 16 -c 1 server/deno/debug_audio_<ts>.pcm /tmp/heard.wav && open /tmp/heard.wav
```
