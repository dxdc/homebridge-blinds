# Example configurations

These are starting-point configurations for common device families, every
example below is a single Homebridge accessory entry that drops into the
`accessories` array of `~/.homebridge/config.json`.

Each example targets a different feature mix; combine pieces freely. **Replace
all placeholder URLs, tokens, and IDs with your own values.** The
[Tested-configurations Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Tested-configurations)
is the source of truth for device-specific endpoints — these examples are
intended to demonstrate plugin features, not to be canonical for any given
firmware.

| File                     | Showcases                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `basic.json`             | Smallest viable configuration. Three URLs, motion time. Start here.                        |
| `awning-inverted.json`   | `invert_position: true` for awnings/shades whose "closed" position is physically extended. |
| `exact-position.json`    | Single endpoint that drives the blind to an exact position via `%%POS%%` — no stop URL.    |
| `position-feedback.json` | Polls `pos_url` with `pos_jsonata` to keep HomeKit in sync with the real device.           |
| `webhook-push.json`      | Listens for push updates from the device or another automation.                            |
| `non-linear-motion.json` | `motion_time_graph` for blinds that move at different speeds at different positions.       |
| `unreliable-rf.json`     | `command_repeat_count` and `obstruction_threshold` for flaky RF blinds.                    |
| `tasmota.json`           | Tasmota smart switch driving a 3-position relay. POST + Backlog command.                   |
| `bond-bridge.json`       | Bond Bridge / Bond Bridge Pro with a `BOND-Token` API header.                              |
| `louvolite-neo.json`     | Louvolite Neo Smart Blinds via the Neo Smart Controller API.                               |
| `shell-script.json`      | `file://` prefix — runs a shell script instead of an HTTP request. For MQTT, serial, etc.  |
| `multiple-blinds.json`   | Two accessories in the same config with different motion times.                            |

Open any file for inline comments explaining each option.
