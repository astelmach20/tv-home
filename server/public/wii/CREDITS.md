# Wii Menu theme audio

The `.ogg` files here are the menu sounds and music from [wii-tv](https://github.com/MauroProto/wii-tv)
(commit `4a763c7`, `launcher/app/src/main/res/raw/wii_*.ogg`): original remakes contributed by **Soffizlly (2026)**,
not recordings extracted from Nintendo software. They are distributed under wii-tv's MIT licence, copied
unchanged in `LICENSE`.

| File | wii-tv resource | Use |
| --- | --- | --- |
| `move.ogg` | `wii_move.ogg` | Moving the hand |
| `select.ogg` | `wii_select.ogg` | Opening a channel or menu item |
| `page.ogg` | `wii_page.ogg` | Turning the page |
| `back.ogg` | `wii_back.ogg` | Closing a menu |
| `big_buttons.ogg` | `wii_big_buttons.ogg` | The round buttons and the SD card |
| `start.ogg` | `wii_start.ogg` | Jingle when the theme comes up |
| `woop.ogg` | `wii_woop.ogg` | Once after resting 0.5 s on a channel |
| `menu_music.ogg` | `wii_menu_music.ogg` | Menu music loop, from 1 s after the jingle |

The theme's drawing code (`web/home/wii/`) is ported from wii-tv's `WiiMenuView`, `WiiBase`, `WiiPalette`,
`WiiGrid` and `WiiHand` under the same licence.
