# tv-home

A replacement home screen and background service for a rooted LG webOS TV, plus a boot hook that stops LG's ad and
telemetry services. Tested on an LG OLED C5 (2025, webOS 11) rooted with the
[webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel).

- **Wii Menu launcher.** The Home button opens a Wii-style channel grid built from the TV's installed apps and HDMI
  inputs. The drawing code and sounds are ported from [wii-tv](https://github.com/MauroProto/wii-tv) (MIT); see
  [server/public/wii/CREDITS.md](server/public/wii/CREDITS.md).
- **Input switching.** When an HDMI-CEC device (Apple TV, PS5) turns on, the TV switches to it. Soundbars never take
  the screen.
- **Per-source volume, night mode, screensaver.** Restores each source's volume, dims the picture at night, and swaps
  LG's screensaver for aerial video while Home is open.
- **Sonos.** Follows a Sonos soundbar's source over UPnP events.
- **Power and CEC log.** Records every power change with LG's own reason and which HDMI device woke the TV.
- **Debloat.** [tv/init.d/55-debloat](tv/init.d/55-debloat) stops LG's ACR, ad, recommendation and log-upload
  services at every boot, declines the optional user agreements, closes the phone-remote port to the network and
  blocks firmware updates. See [PRIVACY.md](PRIVACY.md) for what LG collects and what this turns off.
- **MCP server.** [mcp/](mcp/) lets an AI agent read the TV's state and logs, take screenshots and run commands on it.

## Requirements

- An LG webOS TV rooted with the Homebrew Channel, with SSH enabled and your public key on it.
- Node 20 and Python with [uv](https://docs.astral.sh/uv/) on the computer you deploy from.

## Install

```bash
TV=root@<your-tv-ip> ./deploy.sh
```

This builds and checks the server, copies it to `/home/root/tv-home` on the TV, installs the launcher app and the boot
hooks under `/var/lib/webosbrew/init.d/`, and starts it. The server listens on `127.0.0.1:8765` on the TV only.

Edit [server/config.json](server/config.json) to pin or hide apps and set night-mode hours. Weather is off unless you
add `"home": {"lat": ..., "lon": ...}`; coordinates are rounded to one decimal before they're sent to Open-Meteo. To try the launcher
without a TV, run `npm run dev` in `server/`: it serves against the mock TV in [mock/](mock/).

## Undo

- Debloat: delete `/var/lib/webosbrew/init.d/55-debloat` on the TV, copy each `/home/root/debloat/*.orig` back to
  its path (the file name is the path with `/` as `_`), and reboot. Everything else it changes lives in RAM.
- Launcher and server: delete `/var/lib/webosbrew/init.d/70-tvhome` and `/home/root/tv-home`, then remove the
  `org.tvhome.launcher` app.

## LG's own source code

This repo doesn't include LG's firmware. Its proprietary parts (Home, ACR, the ad services) can't be redistributed.
LG publishes the open-source parts (Linux kernel, GPL and LGPL packages) for each TV model at
[opensource.lge.com](https://opensource.lge.com); search for your model number.

## Licence

MIT. The Wii theme's code and sounds are from wii-tv under its MIT licence.
