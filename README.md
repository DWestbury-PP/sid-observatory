# SID Observatory

A browser SID listening room: demoscene phosphor meets a modern instrument panel.

Live demo: https://tender-coral-87w9.here.now/
Source: https://github.com/DWestbury-PP/sid-observatory

First pressing, 0.1.2. Built with Darrell Westbury's C64/EVO64 brief in mind.

### Collection and visualization update (0.1.2)

Imported tracks have a separate remove button. The two visualization modes now use distinct geometry, including when the operating system requests reduced motion.

### Layout update (0.1.1)

The application now uses the available dynamic viewport height. Header and playback controls have dedicated layout rows, with a scrollable workspace between them. Wide, shorter windows use a smaller main display and tighter spacing. Content remains reachable when browser chrome, window resizing or text enlargement reduces the available space.

Voice cards use explicit, stable row heights for pitch, combined-waveform labels, scopes and numeric readouts. Changing live values cannot grow a card. Full combined-waveform and filter labels are available on hover if space is limited.

## Run

Requires Python 3 for the local static server and Node.js 20+ for tests. No npm dependencies or build step.

```sh
npm run serve
# Open http://localhost:8080 and press Play.
npm test
```

Serve over HTTPS in production: AudioWorklet requires a secure context. Publish the contents of `dist/` to here.now or another static host. Opening index.html as a file will not work.

## What works

- Original bundled PSID tune, `Phosphor dreams`, plus local file selection, drag-and-drop and removal of imported tracks. Removing the playing track stops it and selects the nearest remaining tune, paused. Removing another track preserves playback. Original files on disk are unchanged.
- PAL single-SID PSID playback, subtunes, pause/resume, restart and volume.
- Hermit's jsSID 0.9.1 adapted to AudioWorklet, with 6581/8580 model selection.
- Emulator-derived pre-filter voice waveforms and internal envelope levels.
- Frequency, nearest equal-tempered note (A4=440), raw pulse-width register / 4096, ADSR nibbles, gate/sync/ring/test flags.
- Mute and solo at the mixer/filter input; oscillator and envelope emulation continue.
- Shared filter mode, cutoff register, resonance, routing and $D400–$D418 hex view.
- Phosphor visualization, oscilloscope mode, listening mode and reduced-motion support.
- Responsive layout, keyboard controls (Space toggles playback), accessible control labels.

Imported tunes remain in browser memory. No tune upload, persistent storage, analytics or backend. Google Fonts is the only external display resource and has local font fallbacks. DeepSID and emulator links are optional external navigation.

## Accuracy and compatibility boundaries

This is an instrumented prototype, not a cycle-exact reference player. It intentionally rejects RSID, NTSC-only tunes, MUS/PlaySID-specific files, multiple SIDs and interrupt-vector playback (zero play address). ROM-dependent tunes, digis and unusual interrupt timing are not supported by this engine and may fail or sound wrong. PAL is assumed if a file does not specify a clock. See the upstream README for its limitations.

The 50 Hz inspector samples emulated state; it is not a complete history of all SID writes and can miss changes between snapshots. Visual state may lead audible output by device buffering latency. Voice waveforms contain oscillator output multiplied by the emulated envelope before routing through the shared filter. Phosphor mode maps the samples radially into three glowing orbits with short waveform-history trails and slow rotation driven by playback time. Oscilloscope mode shows triggered, flat time-domain traces. Reduced-motion mode removes orbit rotation and history trails while retaining the distinct radial geometry.

Envelope meters are internal emulator counters, not hardware-readable per-voice registers: real SID hardware exposes ENV3 only. ADSR fields show raw 4-bit values; cutoff shows an 11-bit register rather than an estimated Hz value. Noise voices display their oscillator frequency word as Hz, not perceived musical pitch. Pulse percentage is the threshold fraction of 4096; it is not labeled as high-time duty cycle. Mute/solo changes shared-filter excitation, so summing isolated renders need not reproduce the full nonlinear/filter behavior.

## Structure

- `dist/index.html`, `style.css`, `app.js`: interface and main-thread audio controller.
- `dist/sid-format.js`: PSID validation and metadata parsing.
- `dist/collection.js`: deterministic track-removal state transitions.
- `dist/visualizations.js`: separate oscilloscope and phosphor renderers.
- `dist/sid-worklet.js`: realtime render and instrument snapshot bridge.
- `dist/vendor/jssid.js`: unchanged upstream emulator.
- `dist/vendor/sid-core.js`: generated AudioWorklet-friendly, instrumented emulator core.
- `scripts/adapt-engine.py`: reproducible patch, including explicit-load-address handling in the wrapper, bounded CPU execution and ENV3 index correction.
- `scripts/make-demo.py`: original 6502 music routine and PSID generator.
- `tests/player.test.js`: format validation, audio output, restart, mute/model and worklet-bridge tests.

To regenerate the derived files:

```sh
python3 scripts/adapt-engine.py
python3 scripts/make-demo.py
npm test
```

## Next iteration

Establish a reference corpus of familiar tunes and compare playback against a reference emulator; evaluate reSID/WebSID fidelity, 2SID/3SID support and complete register-write capture. Add authorized archive access, song lengths and a proper collection experience after validating that foundation. A user-picked familiar SID is a better listening acceptance test than the bundled diagnostic composition.

## Credits

Emulator: **Mihaly Horvath (Hermit), 2016**, jsSID 0.9.1, mirrored at https://github.com/og2t/jsSID. Original source blob: `552a05f94353160158a485852629b43107c41c96`. The author's licensing statement is preserved in `dist/vendor/README-jsSID.txt`; it allows use/modification under the author's “WTF license” statement. Original and adapted sources are distributed together. No third-party SID music is bundled.

The visual interface, adapter, tests and included procedural composition were created for this project. A project-level license has not yet been chosen by the repository owner.

References: https://vice-emu.sourceforge.io/vice_17.html (SID format); https://deepsid.chordian.net/ (reference player); https://here.now/docs (hosting).
