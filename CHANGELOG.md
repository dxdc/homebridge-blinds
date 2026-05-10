# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/).

## [3.0.0] - 2026-05-10

> **Drop-in upgrade.** Every working v2 configuration continues to work
> unchanged. Renamed keys log a one-time deprecation warning so you know
> what to migrate. The on-disk persisted position carries over.

### What's new

- **Native HomeKit "stop" gesture** — the WindowCovering tile now exposes
  the standard HAP `HoldPosition` characteristic, so Siri ("stop the
  blinds") and HomeKit automations work without an extra Switch tile.
- **`invert_position`** — flip 0%/100% in HomeKit for awnings or shades
  whose "closed" position is physically extended.
- **Battery support** — set `battery_url` (with optional
  `battery_jsonata` and `battery_low_threshold`) to surface a HomeKit
  Battery service alongside the blind.
- **`set_debounce_ms`** — coalesce slider-drag bursts in the Home app
  into a single HTTP request against the device.
- **`command_repeat_count`** — send each move N times for unreliable RF.
- **`request_timeout_ms`** — bound HTTP timeouts so an unreachable device
  doesn't stall Homebridge. Per-URL `timeout` overrides also accepted.
- **`obstruction_threshold`** — require N consecutive failures before
  HomeKit shows the blind as obstructed (filters transient flakes).
- **Webhook `?target=N`** — external automations or physical remotes
  can update the HomeKit target without driving the motor.
- **Push position updates** — when `pos_url` is set, polled values are
  pushed to HomeKit live; the Home app reflects external changes
  without re-opening the tile.
- **Examples** — twelve ready-to-edit configs in
  [`examples/`](./examples) (Tasmota, Bond, Louvolite, MQTT shell,
  awnings, multi-blind, …).

### What's better

- **No more freezes when a blind is unreachable.** Position reads return
  cached state immediately; HTTP I/O is fully background.
- **Bounded retries** with exponential backoff and `AbortController`
  timeouts.
- **Clearer diagnostics** when a `pos_url` response can't be parsed —
  the warning now includes the raw body and the configured JSONata
  expression, even without `verbose`.
- **HTTP success codes**, motion calibration, and webhook fields
  reorganized in the Homebridge UI for clarity.

### Engine requirements

- Node `^18.20 || ^20.18 || ^22.10`
- Homebridge `^1.8.0 || ^2.0.0`

### Deprecated (will be removed in v4)

| Old key             | Use instead              |
| ------------------- | ------------------------ |
| `position_url`      | `pos_url`                |
| `position_interval` | `pos_poll_ms`            |
| `position_jsonata`  | `pos_jsonata`            |
| `map_send_jsonata`  | `send_pos_jsonata`       |
| `response_lag`      | `response_lag_ms`        |
| `success_codes`     | `http_success_codes`     |
| `motion_up_time`    | `motion_time_graph.up`   |
| `motion_down_time`  | `motion_time_graph.down` |
| `http_method`       | `http_options`           |
| `max_http_attempts` | per-URL `maxAttempts`    |
| `retry_delay`       | per-URL `retryDelay`     |

## [2.0.1] - 2022-08-22

- Tweak `requestretry` strategy.

## [2.0.0] - 2022-07-23

- Add favorite-position HomeKit buttons (`show_favorite_buttons`).
- Per-direction motion-time graph (`motion_time_graph`) for non-linear
  or asymmetric motion ([#43], [#70]).

## [1.x]

Earlier releases introduced:

- Position polling (`position_url`) with JSONata extraction.
- `%%POSINT%%` placeholder for raw numeric JSON injection ([#63]).
- Outbound position mapping via `mapSendJsonata` ([#59]).
- Cached state across restarts ([#22]).
- Configurable HTTP success codes ([#21]).
- `file://` shell-command support ([#45]).
- Stop-at-boundaries and stop-via-up/down options ([#18]).
- Initial Homebridge UI schema ([#44]).
- Toggle, stop, and unique-serial options.

[#18]: https://github.com/dxdc/homebridge-blinds/issues/18
[#21]: https://github.com/dxdc/homebridge-blinds/issues/21
[#22]: https://github.com/dxdc/homebridge-blinds/issues/22
[#43]: https://github.com/dxdc/homebridge-blinds/issues/43
[#44]: https://github.com/dxdc/homebridge-blinds/issues/44
[#45]: https://github.com/dxdc/homebridge-blinds/issues/45
[#59]: https://github.com/dxdc/homebridge-blinds/issues/59
[#63]: https://github.com/dxdc/homebridge-blinds/issues/63
[#70]: https://github.com/dxdc/homebridge-blinds/issues/70
