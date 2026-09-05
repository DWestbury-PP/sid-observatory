# Changelog

## 0.3.0 — Third pressing

- The High Voltage SID Collection is browsable in the app: a starter shelf, a folder tree and a search box over every composer and title. Tunes stream from hvsc.c64.org on demand and are never stored by the site.
- The browsable index is generated from HVSC's `Songlengths.md5`, committed, and pinned to one HVSC release.
- Elapsed time is shown against the song length; **Continue** advances to the next tune in the collection.
- Each HVSC tune links out to DeepSID for a reference listen.
- The two bundled demo tunes were removed from the sidebar and kept only as test fixtures. The sidebar shelf scrolls.
- The publish script stamps cache-busters with the version and commit.

## 0.2.0 — Multi-SID

- 2SID and 3SID tunes (PSID v3/v4) play. Chip addresses and per-chip model bits follow the HVSC specification.
- The jsSID adapter applies chip models per chip; upstream parsed them but applied the first chip's model everywhere.
- Two inspector layouts for multi-chip tunes, Compact and Tabs, remembered in the browser. One filter strip and one model selector per chip.
- Phosphor mode nests extra chips as smaller rings; oscilloscope mode gives each chip its own band.
- An original three-chip fixture exercises all nine voices in the test suite.

## 0.1.2

- Imported tracks have a separate remove button.
- The two visualization modes use distinct geometry, including under reduced motion.

## 0.1.1

- Layout uses the dynamic viewport height, with dedicated header and transport rows and a scrollable workspace between them.
- Voice cards use fixed row heights so live values cannot resize a card.
