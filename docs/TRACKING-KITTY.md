# Where is Kitty? — tracking her position for the 3D living room

## Straight answers to the questions in the brief

**Does Apple AirTag / Find My have an API?** No. developer.apple.com/find-my is
only the accessory-maker programme. The iOS 18 "Share Item Location" pages are
lost-item-only, expire after seven days, and are not an API.

**What is airpinpoint.com/airtag-api, and is there a free clone?** Airpinpoint
($11.99–14.99 per tag per month) is a hosted version of the community trick: its
own setup docs require a Mac on macOS 11–14 with Full Disk Access to read the
Find My keychain, i.e. it exports your AirTags' private keys once, then its
servers pull and decrypt Apple's offline-finding reports. The free equivalent is
**FindMy.py** (v0.10.2, 14 Sep 2026) with **hass-FindMy** for Home Assistant.
Every real-AirTag route needs: an iPhone to pair the tag, an Apple ID with 2FA,
an "anisette" helper server, and a Mac on macOS 15 or older to export the keys
(macOS 26 is blocked, open issue). Apple broke this login in September 2026 and
the community patched it a week later; expect that to keep happening.
OpenHaystack and macless-haystack only work with home-made ESP32/nRF beacons,
never a real AirTag.

**Can we read the AirTag's Bluetooth locally to know which room she is in?**
Poorly. Its identifier rotates every 15 minutes while your iPhone is nearby, and
the two room-presence projects both say so: ESPresense lists AirTags as "known to
not work" and Bermuda calls them unsupported without the exported key. And an
AirTag only becomes locally trackable when your phone is *away*, which is the
wrong way round for "watch Kitty while I'm home".

**Cat GPS trackers with an API?** None official. Tractive, Weenect and Pawfit
have reverse-engineered clients only, need £4–7/month subscriptions, weigh
27–32 g, and cannot resolve rooms indoors. Worth revisiting only for a later
"Kitty is out exploring SE16" map beat.

## Recommendation: a plain Bluetooth beacon on the collar, three tiny scanners, your Pi

Total about £30–50, no Apple or Google account involved, works while you are home.

| Part | Pick | Cost |
|---|---|---|
| Collar beacon | A small iBeacon with a static address: BeaconZone E8 (8 g) or PC038 from beaconzone.co.uk, or a Blue Charm BC021. Set 300–500 ms advertising at 0 dBm. In a silicone AirTag-style collar sleeve, because collars go in water bowls. | £12–25 |
| Scanners | Three identical ESP32-C3 boards (same model, same batch; clones differ by several dB) flashed with **ESPresense** from its browser flasher. One by the sofa, one on the kitchen counter, one at the garden door. | £10–21 |
| Broker + brain | Your Raspberry Pi 4: Mosquitto MQTT plus a 60-line Python zone resolver. The Pi's own Bluetooth is a free fourth sensor. | owned |

**The zone resolver** subscribes to `espresense/devices/<beacon>/<room>`
distances, picks the nearest node with hysteresis (a new zone must win by about
1 m for 10 s), declares **garden/outside** when no node has heard the beacon for
60 s, and **asleep somewhere** when the strongest signal has been flat for
20 minutes. It writes `kitty_state {zone, confidence, per_node_rssi, updated_at}`
to Supabase through PostgREST with a key that lives only on the Pi, throttled to
zone changes plus a 30 s heartbeat.

**The website** keeps a map from zone → an anchor point and facing in the
scanned room, subscribes to `kitty_state` changes (anon read policy), and tweens
the 3D Kitty between anchors with idle or sleep animations. If Realtime
connections ever saturate, `/api/kitty` serves a cached copy.

If you would rather click than code: Home Assistant Container on the Pi, the
same ESP32s flashed with ESPHome `bluetooth_proxy`, the Bermuda integration for
area sensors, and a `rest_command` automation to Supabase. Same hardware,
heavier stack.

## Only choose a real AirTag if…

…you have **both** an iPhone and a Mac on macOS 15 or older. Then hass-FindMy
(a September 2026 change added local matching of real AirTags through ESPHome
proxies) can identify the tag locally and also pull Find My cloud fixes every
15 minutes. Budget the £29 tag plus tolerance for Apple breaking authentication
a few times a year. Skip Airpinpoint: same mechanism, sold as a service.

## What I need from you

- Do you have an iPhone, and a Mac (which macOS)? Decides whether an AirTag
  route is even possible. The beacon route needs neither.
- A rough floor plan sketch with where the sofa, counter and garden door are,
  so the three scanner positions and the room anchors line up with the scan.
