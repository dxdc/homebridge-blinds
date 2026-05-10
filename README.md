# homebridge-blinds

[![CI](https://github.com/dxdc/homebridge-blinds/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/ci.yml)
[![Smoke](https://github.com/dxdc/homebridge-blinds/actions/workflows/smoke.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/smoke.yml)
[![CodeQL](https://github.com/dxdc/homebridge-blinds/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/codeql.yml)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![isc license](https://badgen.net/badge/license/ISC/red)](https://github.com/dxdc/homebridge-blinds/blob/master/LICENSE)
[![npm](https://badgen.net/npm/v/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![npm](https://badgen.net/npm/dt/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![Discord](https://camo.githubusercontent.com/7494d4da7060081501319a848bbba143cbf6101a/68747470733a2f2f696d672e736869656c64732e696f2f646973636f72642f3433323636333333303238313232363237303f636f6c6f723d373238454435266c6f676f3d646973636f7264266c6162656c3d646973636f7264)](https://discord.gg/9VgPRmY)
[![Donate](https://badgen.net/badge/Donate/PayPal/91BE09)](https://paypal.me/ddcaspi)

`homebridge-blinds` controls **blinds, shades, awnings, shutters, and roller
curtains** in Apple HomeKit via [Homebridge](https://homebridge.io). It speaks:

- **HTTP / REST** — direct `up` / `down` / `stop` / `setPosition` endpoints
  with custom methods, headers, bodies, retries, and per-URL timeouts.
- **Shell commands, scripts, and CLI tools** — any URL prefixed `file://` is
  executed as a shell command, so MQTT publishes (`mosquitto_pub`), Python
  scripts, serial bridges, or anything else you can run from a shell works
  out of the box.
- **Webhooks** — optional HTTP listener (with Basic Auth or TLS) that lets
  external automations or physical remotes push position updates back into
  HomeKit.
- **Polled position feedback** with [JSONata](https://jsonata.org)
  extraction for nested device payloads.

Tested with **Tasmota**, **Bond Bridge**, **Louvolite Neo Smart Blinds**, and
many DIY firmware variants. Fully written in TypeScript, verified by
Homebridge, supports Homebridge `1.8+` and `2.x`.

## Installation

If you're new to Homebridge, start with the [Homebridge documentation](https://www.npmjs.com/package/homebridge).
On a Raspberry Pi, the [homebridge-punt Wiki](https://github.com/cflurin/homebridge-punt/wiki/Running-Homebridge-on-a-Raspberry-Pi)
walks through the basics.

The easiest way to install and configure this plugin is via the
[Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x). Search
for `homebridge-blinds` and install. To install on the command line:

```sh
sudo npm install -g homebridge-blinds
```

## Quick start

Add an accessory in your Homebridge `config.json`:

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": { "url": "http://1.2.3.4/window/up", "method": "GET" },
    "down_url": { "url": "http://1.2.3.4/window/down", "method": "GET" },
    "stop_url": { "url": "http://1.2.3.4/window/stop", "method": "GET" },
    "http_success_codes": [200, 204],
    "motion_time": 10000
}
```

That's everything most setups need. `motion_time` (in milliseconds) is how long
your motor takes to move from fully open to fully closed.

## Advanced configuration

Every option is documented below. A fully populated example is at the bottom of
this section for reference.

### URLs (`up_url`, `down_url`, `stop_url`, `pos_url`)

Each URL accepts either a string (the URL itself) or an object with the
following keys:

| Key           | Description                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `url`         | Required. The HTTP URL or a `file://` shell command (see below).                                                        |
| `method`      | `GET` (default), `POST`, `PUT`, `PATCH`, or `DELETE`.                                                                   |
| `headers`     | Object of header name → value.                                                                                          |
| `body`        | String or JSON-serializable object. Sent for non-`GET` methods.                                                         |
| `maxAttempts` | Override the global retry budget for just this URL (default: `5`).                                                      |
| `retryDelay`  | Override the base retry delay (ms) for just this URL (default: `2000`). The actual delay grows exponentially per retry. |
| `timeout`     | Per-attempt timeout in ms for just this URL (default: `request_timeout_ms`, which is `10000`).                          |

Any URL can be omitted; the plugin simply won't issue that command. Without a
`pos_url`, the plugin emulates the position with a timer.

#### Position placeholders

Within any URL, body, or header value:

- `%%POS%%` — replaced literally with the integer target (0–100). Goes inside JSON strings unchanged.
- `"%%POSINT%%"` — the **quoted** placeholder is replaced as a raw JSON number,
  dropping the surrounding quotes. Use this when your device requires a numeric
  JSON field (e.g. `{ "position": "%%POSINT%%" }` becomes `{ "position": 42 }`).

When a placeholder is present, the plugin assumes the request drives the blind
exactly to the target, so it does **not** send a separate stop command unless
`trigger_stop_at_boundaries` is true.

#### `file://` — run a shell command

Any URL prefixed with `file://` is executed as a shell command instead of
issuing an HTTP request. Use this for MQTT publishes, serial commands, or
custom scripts. See the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Command-line-scripts)
for examples.

#### `http_success_codes`

Array of HTTP status codes treated as success. Defaults to `[200]`. Set to e.g.
`[200, 202, 204]` if your device returns something other than `200`.

### Position polling

| Option        | Default | Description                                                                                             |
| ------------- | ------- | ------------------------------------------------------------------------------------------------------- |
| `pos_url`     | —       | URL polled for the actual blind position. Must return `0`–`100`, or use `pos_jsonata` to extract it.    |
| `pos_poll_ms` | `15000` | Milliseconds between polls (minimum `5000`).                                                            |
| `pos_jsonata` | —       | [JSONata](https://jsonata.org) expression run against the parsed JSON response to extract the position. |

If your device returns plain text (e.g. just `42`), no `pos_jsonata` is needed.
If it returns JSON like `{"ShutterPosition1": 42}`, set `pos_jsonata` to
`ShutterPosition1`. If it returns JSON without a clear field name, the plugin
uses the first numeric value in the object.

### Position webhook (push-based updates)

When your device or another automation can push position changes, run a small
HTTP listener on the plugin so it stays in sync without polling.

| Query string          | Effect                                                                                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `?pos=<0-100>`        | Update both `CurrentPosition` and `TargetPosition`. Use this to sync HomeKit after the device has moved.                                                                                |
| `?target=<0-100>`     | Update `TargetPosition` **only**, without driving the motor. Use this when an external system has decided the new desired state and you don't want the plugin to issue its own command. |
| `?pos=<N>&target=<N>` | When both are present, `pos` wins.                                                                                                                                                      |

Send any HTTP method to `http://<homebridge-host>:<webhook_port>/`. The body
is ignored.

| Option                   | Default | Description                                                    |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `webhook_port`           | `0`     | Port to listen on. `0` disables the listener.                  |
| `webhook_http_auth_user` | —       | Optional Basic Auth username.                                  |
| `webhook_http_auth_pass` | —       | Optional Basic Auth password.                                  |
| `webhook_https`          | `false` | Use HTTPS instead of HTTP.                                     |
| `webhook_https_keyfile`  | —       | Path to TLS private key. Auto-generated and cached if omitted. |
| `webhook_https_certfile` | —       | Path to TLS certificate. Auto-generated and cached if omitted. |

Credentials are compared with timing-safe equality. Self-generated certificates
rotate automatically before expiry.

### Outbound position mapping (`send_pos_jsonata`)

JSONata expression that maps the HomeKit target (0–100) to whatever value your
device expects before substituting into `%%POS%%` or `%%POSINT%%`. The input
to the expression is the integer position; the output is substituted directly.

```jsonc
"send_pos_jsonata": "$round( ( 100 - $number($) ) * 255 / 100 )"
```

The above example inverts the value and scales it from `0–100` to `0–255`.

### Motion timing and calibration

`motion_time` (ms) is how long the motor takes to move fully open ↔ fully
closed. Even when `pos_url` is configured, this value is still required — it is
used to estimate when the blind _should_ be at the target, which avoids
hammering the device with status checks.

Tip: filming the blinds with your phone gives the most accurate timing. If
multiple blinds run on the same controller and you see network errors when
they all move at once, set slightly different `motion_time` values per blind
(e.g. `9800`, `10000`, `10200`).

#### Per-direction and non-linear motion (`motion_time_graph`)

When the up and down speeds differ, or when motion is not linear (slow start,
fast middle, etc.), use `motion_time_graph`:

```jsonc
"motion_time_graph": {
    "up":   [{ "pos": 0, "seconds": 0 }, { "pos": 50, "seconds": 9.7 }, { "pos": 100, "seconds": 14.3 }],
    "down": [{ "pos": 100, "seconds": 0 }, { "pos": 0, "seconds": 23.7 }]
}
```

Each direction must have entries for both `pos: 0` and `pos: 100`. Intermediate
points describe a piecewise-linear curve. `motion_time_graph` takes precedence
over `motion_time` when both are set.

`response_lag_ms` adds a fixed pre-motion delay to account for network or RF
latency between sending the command and the motor starting.

### Reliability and retries

| Option                  | Default | Description                                                                                                                                                                                                                                                        |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `request_timeout_ms`    | `10000` | Per-attempt HTTP timeout. Lower values prevent stalls when the device is unreachable.                                                                                                                                                                              |
| `command_repeat_count`  | `1`     | Send each move command this many times in sequence. Helps with unreliable RF blinds that miss the first command.                                                                                                                                                   |
| `obstruction_threshold` | `1`     | Number of consecutive failed requests required before HomeKit's `ObstructionDetected` is set to `true`. Increase to filter out transient flakes (e.g. a brief Wi-Fi blip). The counter resets to zero on the next successful request.                              |
| `set_debounce_ms`       | `0`     | Wait this many milliseconds after the last `TargetPosition` change before issuing the move command. Coalesces the burst of events the Home app fires while the user is dragging the slider into a single HTTP request against the device. `0` disables debouncing. |

Per-URL `maxAttempts`, `retryDelay`, and `timeout` overrides take precedence
over the global values.

### Battery (optional)

Battery-powered blinds (e.g. Soma, Ikea, some Bond-controlled units) can
expose their charge level in HomeKit. When `battery_url` is set, the plugin
adds a HomeKit Battery service alongside the WindowCovering and polls the
URL on a slow cadence (default every 5 minutes).

| Option                  | Default  | Description                                                                                                              |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `battery_url`           | —        | URL polled to read battery percentage. Must return `0`–`100`, or use `battery_jsonata` to extract from a larger payload. |
| `battery_jsonata`       | —        | JSONata expression run against the parsed JSON response to extract the battery level.                                    |
| `battery_poll_ms`       | `300000` | Milliseconds between battery polls. Minimum `30000`. Battery state changes slowly, so a long interval is fine.           |
| `battery_low_threshold` | `20`     | iOS shows the low-battery indicator when `BatteryLevel` is at or below this value.                                       |

Battery-poll failures **do not** trip `ObstructionDetected` — the blind
itself may be perfectly reachable on its primary URLs.

### Optional behavior

| Option                       | Default | Description                                                                                                                                                                                     |
| ---------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show_stop_button`           | `false` | Expose a HomeKit switch that sends the stop URL.                                                                                                                                                |
| `show_toggle_button`         | `false` | Expose a HomeKit switch that toggles between the last up and last down command. On startup it does nothing until either the persisted position is `0` or `100` or the user has issued one move. |
| `show_favorite_buttons`      | `[]`    | Expose HomeKit switches for shortcut positions, e.g. `[25, 50, 75]`.                                                                                                                            |
| `invert_position`            | `false` | Swap the `0%` and `100%` endpoints in HomeKit. Common for awnings/shades where "closed" is physically extended.                                                                                 |
| `unique_serial`              | `false` | Use a UUID-based serial/model in HomeKit. Required for some external integrations (e.g. Eve) that expect distinct serials.                                                                      |
| `use_same_url_for_stop`      | `false` | Re-send the most recent up_url or down_url instead of `stop_url`. For blinds that toggle on a single endpoint.                                                                                  |
| `trigger_stop_at_boundaries` | `false` | Send a stop command even when moving to fully open or fully closed. Most blinds stop themselves; only enable if yours don't.                                                                    |
| `verbose`                    | `false` | Additional diagnostics: every poll, motion calculations, JSON parse errors, etc. Use when debugging.                                                                                            |

### HomeKit characteristics exposed

The accessory implements the standard HAP `WindowCovering` service plus an
`AccessoryInformation` service. The following characteristics are wired:

| Characteristic        | Direction  | Notes                                                                                                                                                                         |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CurrentPosition`     | read       | Returns the cached last-known position immediately; never blocks on the network. Polled in the background when `pos_url` is set.                                              |
| `TargetPosition`      | read/write | Writes trigger the move pipeline. Optionally debounced via `set_debounce_ms`.                                                                                                 |
| `PositionState`       | read       | `INCREASING` / `DECREASING` / `STOPPED`.                                                                                                                                      |
| `ObstructionDetected` | read       | Set on retry-exhausted failures (after `obstruction_threshold` consecutive failures). Clears on the next success.                                                             |
| `HoldPosition`        | write      | **Standard HAP characteristic on the WindowCovering tile itself** — the Home app exposes it inline, and Siri/automations can target it ("stop the blinds"). Sends `stop_url`. |

`HoldPosition` is different from the optional `show_stop_button` feature
(below): the latter adds a separate HomeKit `Switch` accessory. Most users
should rely on `HoldPosition`. The Stop button is kept for setups that
already have automations bound to that switch.

### Obstruction reporting

`ObstructionDetected` is set to `true` when an HTTP request fails after
exhausting its retry budget. By default a single failure trips it; tune
`obstruction_threshold` (above) to require N consecutive failures first.
It clears automatically on the next successful request, and is also
cleared at the start of every new move attempt so a user retrying clears
any stale obstruction.

### Tested device configurations

A community-maintained list of working setups for Tasmota, Bond, Louvolite Neo
Smart Blinds, and others lives on the
[Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Tested-configurations).

Ready-to-edit example configurations for the most common scenarios — basic,
awning, exact-position, position polling, push webhook, non-linear motion,
unreliable RF, Tasmota, Bond, Louvolite, shell scripts, and multi-blind
setups — are in the [`examples/`](./examples) directory.

### Full advanced example

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": {
        "url": "http://1.2.3.4/window/up?pos=%%POS%%",
        "body": "{}",
        "headers": { "API-Token": "aaabbbcccddd" },
        "method": "PUT",
        "maxAttempts": 5,
        "retryDelay": 2000,
        "timeout": 8000
    },
    "down_url": {
        "url": "http://1.2.3.4/window/down?pos=%%POS%%",
        "body": "{}",
        "headers": { "API-Token": "aaabbbcccddd" },
        "method": "PUT"
    },
    "stop_url": {
        "url": "http://1.2.3.4/window/stop",
        "headers": { "API-Token": "aaabbbcccddd" },
        "method": "PUT"
    },
    "send_pos_jsonata": "$round( ( 100 - $number($) ) * 255 / 100 )",
    "pos_url": "http://1.2.3.4/window/position",
    "pos_poll_ms": 15000,
    "pos_jsonata": "ShutterPosition1",
    "http_success_codes": [200, 204],
    "response_lag_ms": 0,
    "request_timeout_ms": 10000,
    "command_repeat_count": 1,
    "obstruction_threshold": 1,
    "set_debounce_ms": 0,
    "battery_url": "http://1.2.3.4/window/battery",
    "battery_jsonata": "BatteryLevel",
    "battery_poll_ms": 300000,
    "battery_low_threshold": 20,
    "motion_time_graph": {
        "up": [
            { "pos": 0, "seconds": 0 },
            { "pos": 50, "seconds": 9.7 },
            { "pos": 100, "seconds": 14.3 }
        ],
        "down": [
            { "pos": 100, "seconds": 0 },
            { "pos": 0, "seconds": 23.7 }
        ]
    },
    "show_toggle_button": false,
    "show_stop_button": false,
    "show_favorite_buttons": [25, 75],
    "use_same_url_for_stop": false,
    "trigger_stop_at_boundaries": false,
    "invert_position": false,
    "webhook_port": 51828,
    "verbose": false
}
```

## Migration from v2

v3 is a TypeScript rewrite, but every v2 configuration key still works. Any
key that has been renamed (e.g. `position_url` → `pos_url`) will continue to
work and log a one-time warning at startup. See `CHANGELOG.md` for the full
list of changes.

## Development

```sh
npm install
npm run lint        # ESLint (flat config, typescript-eslint)
npm run typecheck   # tsc --noEmit
npm test            # vitest
npm run build       # emits dist/
```

## How to contribute

Bug reports, feature requests, and pull requests are welcome. When filing an
issue, please include the relevant Homebridge log lines (run with `verbose: true`
for additional context) and your config (with secrets redacted).

## Credits

A huge thank you to [@zwerch](https://github.com/zwerch), the original creator
of this plugin.

## Support this project

If this plugin saves you time and you'd like to say thanks:

- Star and share the projects you like
- [![PayPal][badge_paypal]][paypal-donations-dxdc] **PayPal** — one-time donations to **dxdc**
- **Venmo** — one-time donations
  ![Venmo QR Code](https://raw.githubusercontent.com/dxdc/homebridge-blinds/master/images/venmo.png 'Venmo QR Code')
- **Bitcoin** — `33sT6xw3tZWAdP2oL4ygbH5TVpVMfk9VW7`

[badge_paypal]: https://img.shields.io/badge/Donate-PayPal-blue.svg
[paypal-donations-dxdc]: https://paypal.me/ddcaspi
