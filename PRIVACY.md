# What an LG TV sends home, and how to stop it

Findings from a root-level audit of an LG OLED C5 (2025, webOS 11) in October 2026: its settings, the services
running, 7 days of its own logs, and its live network connections, sampled every 3 seconds for 10 minutes. Other
models and firmware will differ in the details.

## Summary

- **Live Plus (ACR) reported what was on screen,** including HDMI inputs like an Apple TV, until it was turned off.
  On one boot around the time it was turned off, the ACR service ran for about 25 seconds and sent a report before
  shutting down.
- **The optional user agreements are what allow most collection.** Turning settings off isn't enough: the
  agreements stay accepted until you untick them.
- **Most logging shares a server with the app store and sign-in** (`*.tv.wiselg.com`), so you can't block it at the
  router without breaking the TV. Stopping the services on the TV itself works; that needs root.
- **No stored voice recordings were found,** and the built-in mic was closed with hands-free voice off.

## What the TV collects

| What | Sent to | How to stop it |
| --- | --- | --- |
| ACR / Live Plus (`/usr/sbin/acr2`, Alphonso SDK): what's on screen, the HDMI source's name, ad ID, the TV's MAC, and nearby Wi-Fi access points with signal strength (a location fingerprint) | `AIC.tv.wiselg.com/lgsplog/...`, Alphonso servers | Settings: turn off Live Plus, untick the Viewing Information agreement. Root: block `acr2` (debloat hook). |
| ACR audio capture | Same | Attempted 10 times in 7 days; all failed because sound went out over HDMI eARC to a soundbar. With the TV's own speakers it may succeed. |
| Foreground app every 60 s, channel, power state | `nudge/send_log`, `homeprv`, `cmp/api/v3/beacon` on `tv.wiselg.com` | Root: block `admanager`, `contentminer`, `nudge`. Settings: turn off watched-list collection and AI suggestions. |
| Voice requests from the remote's mic button | Nuance speech recognition at `he-us-ai.lgthinq.com` | Only while the button is held. Untick the Voice Information agreement, or block that host (breaks LG voice). |
| Diagnostic and crash logs, which include MAC addresses, Wi-Fi BSSIDs and the LG account email | `aic.tv.wiselg.com/devlog/...` | Untick Diagnostic Data. Old archives sit in `/var/spool/faultmanager/crash`. |
| ThinQ device sync | `aic-connect-client.lgthinq.com`, `api.lgtviot.com` | Turn off ThinQ / Home Hub. |
| Bluetooth LE advertising, Wi-Fi Direct listening | Local radio only | Optional. |

### The agreements

Settings > General > System > Additional Settings > User Agreements. On the audited TV these were all still
accepted after Live Plus was turned off, read from `eulaStatus`:

- Viewing Information / ACR (`acrOnAllowed`, `acrAdAllowed`)
- Interest-based and cross-device ads (`customAdAllowed`)
- Voice Information (`voiceAllowed`, `voice2Allowed`)
- Additional Data / Diagnostics (`additionalDataAllowed`)
- Marketing (`marketingOnAllowed`, `shoppingOnAllowed`)

Untick every one you don't need.

## Microphones

- **Built-in far-field mic:** off unless hands-free voice is on (`voiceLongDistance`, `turnOnByVoice`). Every
  capture device, including the wake-on-voice mic, was closed. There's also a physical switch; the TV reports it
  through `luna://com.webos.service.voiceinput/factory/getMicSwitchStatus`.
- **Remote mic:** reaches the TV over Bluetooth by a separate path, so the TV's switch probably doesn't cover it. It
  only streams while the button is held.
- **Stored audio:** a search of `/var`, `/mnt/lg`, `/tmp`, `/home` and `/media` found no recordings, only firmware
  sounds. Upload queues were empty.

## What the debloat hook does

[tv/init.d/55-debloat](tv/init.d/55-debloat) runs at every boot. Everything except the declined agreements lives in
RAM.

| Service | What it does | How it's stopped |
| --- | --- | --- |
| `remotelogger`, `service-logger` | Usage and log uploads | `systemctl mask --runtime` |
| `contentminer`, `nudge` | Home-screen recommendations, promotions | `systemctl mask --runtime` |
| `acr2` | Live Plus screen recognition | A do-nothing program bind-mounted over the binary |
| `admanager`, `adoverlay-service` | Ads on Home and over live TV | Same |
| `sportsalarm` | Sports score pop-ups | Same |
| `rdxd`, `uploadd` | Builds crash and analytics reports, and uploads them | `rdxd`: masked. `uploadd`: no-op bind-mount |
| `dmost` | LG Channels beacons: session IDs, foreground app, last channel | `systemctl mask --runtime` |
| `iconnectivity` | LG phone pairing | No-op bind-mount |
| `amazon-alexa-adapter` | Alexa built-in | Same |

It also:

- **Declines the optional agreements** at every boot (marketing, voice, ACR/viewing information, interest-based ads,
  diagnostics), because LG re-accepts them after some updates. Consent is stored in four places:
  `/var/luna/preferences/eula`, which the Settings screen shows, and three copies of
  `sdp/eula-service/eula.json` under `/mnt/lg/{cmn_data,cache,user}`, which the services read (`"A"` accepted,
  `"D"` declined). Terms of Use and the Privacy Policy stay accepted because the app store needs them. The first
  original of each file is kept in `/home/root/debloat/*.orig`.
- **Closes port 3001 to the network.** It's LG's phone-remote API (the ThinQ app): after one pairing prompt, a device
  on your network gets full remote control. LG already limits the plain port 3000 to localhost; the hook does the
  same for 3001 and turns off the matching "mobile device access" setting.
- **Hides the screen capture.** LG's OLED service writes a 640×360 capture of the screen to `/tmp/capture.rgb` every
  few seconds, readable by any app. The hook makes it root-only.
- Points three ad servers and LG's firmware update servers (`nsu.lge.com`, `snu-dev.lge.com`) at localhost. A
  firmware update can remove root, and with it this hook.

Make sure the Homebrew Channel's telnet server is off (`/var/luna/preferences/webosbrew_telnet_disabled` exists): when
it's on, anyone on your network gets a root shell with no password.

LG's Home, the app store and streaming apps keep working.

## Router-level blocking

Safe to block with wildcards (a hosts file can't do wildcards):

- `*.alphonso.tv`
- `*.lgsmartad.com`, `lgads.tv`, `*.lgads.tv`
- `*.cdpbeacon.lgtvcommon.com`, `aic.cdpsvc.lgtvcommon.com`

Don't block `*.tv.wiselg.com` or `ngfts.tv.wiselg.com`: the app store, sign-in and home screen use them.

## Credits

The debloat service list started from [cleanyourtv-WebOS](https://github.com/lasharor/cleanyourtv-WebOS) and was
checked against this TV. The extra services, the consent stores, the port 3001 fix and the screen capture finding come
from [own-your-glass](https://github.com/JulioFerrero/own-your-glass) (MIT), a fuller hardening toolkit for rooted LG
TVs.
