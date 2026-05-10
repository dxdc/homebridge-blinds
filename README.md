# homebridge-blinds

[![CI](https://github.com/dxdc/homebridge-blinds/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/ci.yml)
[![Smoke](https://github.com/dxdc/homebridge-blinds/actions/workflows/smoke.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/smoke.yml)
[![CodeQL](https://github.com/dxdc/homebridge-blinds/actions/workflows/codeql.yml/badge.svg?branch=master)](https://github.com/dxdc/homebridge-blinds/actions/workflows/codeql.yml)
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![isc license](https://badgen.net/badge/license/ISC/red)](https://github.com/dxdc/homebridge-blinds/blob/master/LICENSE)
[![npm](https://badgen.net/npm/v/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![npm](https://badgen.net/npm/dt/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![Discord](https://img.shields.io/discord/432663330281226270?color=728ED5&logo=discord&label=discord)](https://discord.gg/9VgPRmY)
[![Donate](https://badgen.net/badge/Donate/PayPal/91BE09)](https://paypal.me/ddcaspi)

Bring **blinds, shades, awnings, shutters, and roller curtains** into Apple
HomeKit via [Homebridge](https://homebridge.io). If your blind exposes any
kind of network or scriptable interface, this plugin can drive it.

- **HTTP / REST** — `up` / `down` / `stop` / `setPosition` endpoints with
  custom methods, headers, bodies, retries, and per-URL timeouts.
- **Shell commands** — prefix any URL with `file://` to run a script, an
  MQTT publish (`mosquitto_pub`), a serial bridge, or anything else you can
  invoke from a shell.
- **Webhooks** — optional HTTP listener (Basic Auth and TLS supported) so
  external automations or physical remotes can push position updates back
  into HomeKit.
- **Polled position feedback** with [JSONata](https://jsonata.org)
  extraction for nested JSON payloads.
- **Resilient by default** — per-URL retry budgets, exponential backoff,
  command repeats for unreliable RF, slider debouncing, and last-known
  position persisted across Homebridge restarts.

Tested with **Tasmota**, **Bond Bridge**, **Louvolite Neo Smart Blinds**, and
many DIY firmware variants. Written in TypeScript, [verified by
Homebridge](https://github.com/homebridge/homebridge/wiki/Verified-Plugins),
runs on Homebridge `1.8+` and `2.x`.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Common scenarios](#common-scenarios)
- [Configuration reference](#configuration-reference)
    - [URLs](#urls-up_url-down_url-stop_url-pos_url)
    - [Motion timing](#motion-timing-and-calibration)
    - [Position polling](#position-polling)
    - [Position webhook](#position-webhook-push-based-updates)
    - [Outbound position mapping](#outbound-position-mapping-send_pos_jsonata)
    - [Reliability and retries](#reliability-and-retries)
    - [Battery](#battery-optional)
    - [Optional behavior](#optional-behavior)
    - [HomeKit characteristics](#homekit-characteristics-exposed)
    - [Full example](#full-advanced-example)
- [Migration from v2](#migration-from-v2)
- [Development](#development)
- [Contributing](#how-to-contribute)
- [Support this project](#support-this-project)

## Install

New to Homebridge? Start with the
[Homebridge docs](https://www.npmjs.com/package/homebridge). On a Raspberry Pi, see
[this guide](https://github.com/cflurin/homebridge-punt/wiki/Running-Homebridge-on-a-Raspberry-Pi).

The easiest path is the
[Homebridge UI](https://github.com/homebridge/homebridge-config-ui-x): search
for **homebridge-blinds** and click **Install**. Or, from a terminal:

```sh
sudo npm install -g homebridge-blinds
```

## Quick start

You only need three things to get going:

1. **One or more URLs** the plugin will hit to drive the blind (`up_url`,
   `down_url`, `stop_url`).
2. **`motion_time`** — milliseconds your motor takes to move from fully open
   to fully closed.
3. **A name** that will show up in the Home app.

Drop this into the `accessories` array of your Homebridge `config.json`:

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": "http://1.2.3.4/window/up",
    "down_url": "http://1.2.3.4/window/down",
    "stop_url": "http://1.2.3.4/window/stop",
    "motion_time": 10000
}
```

Restart Homebridge. The blind appears as a Window Covering tile in the Home
app — drag the slider, the plugin issues the `up`/`down`/`stop` requests on
your behalf. Method defaults to `GET`; status `200` counts as success.

> **Tip:** if you use the Homebridge UI, every option below is also
> available as a form field — you don't need to hand-edit JSON.

## Common scenarios

Pick the closest match and copy the matching example. Each one is a complete,
working config you can paste in and tweak.

| If your blind…                                                 | Use this example                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Has separate up / down / stop endpoints (most common)          | [`examples/basic.json`](./examples/basic.json)                         |
| Accepts an exact target position (e.g. Tasmota Shutter)        | [`examples/tasmota.json`](./examples/tasmota.json)                     |
| Is a Bond Bridge–controlled motor                              | [`examples/bond-bridge.json`](./examples/bond-bridge.json)             |
| Is a Louvolite Neo Smart Blind                                 | [`examples/louvolite-neo.json`](./examples/louvolite-neo.json)         |
| Is an awning or shade where "closed" means physically extended | [`examples/awning-inverted.json`](./examples/awning-inverted.json)     |
| Reports its real position back via a polled URL                | [`examples/position-feedback.json`](./examples/position-feedback.json) |
| Pushes position updates via webhook (e.g. external automation) | [`examples/webhook-push.json`](./examples/webhook-push.json)           |
| Has different up vs. down speeds, or non-linear motion         | [`examples/non-linear-motion.json`](./examples/non-linear-motion.json) |
| Is RF-driven and sometimes misses commands                     | [`examples/unreliable-rf.json`](./examples/unreliable-rf.json)         |
| Is driven by an MQTT publish or a custom shell script          | [`examples/shell-script.json`](./examples/shell-script.json)           |
| You want to expose multiple blinds at once                     | [`examples/multiple-blinds.json`](./examples/multiple-blinds.json)     |

A community-maintained list of working setups lives on the
[Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Tested-configurations).

## Configuration reference

Every option is documented below. Only `name`, the URLs you want to use, and
`motion_time` are required — everything else has a sensible default. A fully
populated example sits at the [bottom of this
section](#full-advanced-example).

### URLs (`up_url`, `down_url`, `stop_url`, `pos_url`)

A URL can be a plain string (just the URL) or an object with these keys:

| Key           | Default              | Description                                                                                 |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `url`         | required             | The HTTP URL, or a `file://` shell command (see below).                                     |
| `method`      | `GET`                | `GET`, `POST`, `PUT`, `PATCH`, or `DELETE`.                                                 |
| `headers`     | —                    | Object of header name → value.                                                              |
| `body`        | —                    | String or JSON-serializable object. Sent for non-`GET` methods.                             |
| `maxAttempts` | `5`                  | Retry budget for this URL only.                                                             |
| `retryDelay`  | `2000`               | Base delay (ms) between retries; grows exponentially per attempt.                           |
| `timeout`     | `request_timeout_ms` | Per-attempt timeout in ms. Falls back to the global `request_timeout_ms` (default `10000`). |

Any URL can be omitted — the plugin simply won't issue that command.

```jsonc
// Compact: just the URL string
"up_url": "http://1.2.3.4/window/up"

// Full: every override available
"up_url": {
    "url": "http://1.2.3.4/window/up",
    "method": "POST",
    "headers": { "API-Token": "abc" },
    "body": "{}",
    "timeout": 5000
}
```

#### Position placeholders

You can target an exact position by embedding placeholders in the URL, body,
or any header value:

- `%%POS%%` — replaced with the integer target `0`–`100` (treated as plain
  text; safe to drop inside a JSON string).
- `"%%POSINT%%"` — the **quoted** placeholder is replaced as a raw JSON
  number, dropping the surrounding quotes. Use when your device expects a
  numeric field, e.g. `{ "position": "%%POSINT%%" }` becomes
  `{ "position": 42 }`.

When a placeholder is present the plugin trusts the request to drive the
blind to the exact target, so no separate stop command is sent (unless
`trigger_stop_at_boundaries` is `true`).

#### `file://` — run a shell command

Prefix any URL with `file://` to run a shell command instead of an HTTP
request. Useful for MQTT publishes, serial commands, or custom scripts.
See the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Command-line-scripts)
for examples.

#### `http_success_codes`

HTTP status codes that count as success. Defaults to `[200]`; set to e.g.
`[200, 202, 204]` if your device returns something else.

### Motion timing and calibration

`motion_time` (ms) is how long the motor takes to move fully open ↔ fully
closed. This is required even when `pos_url` is configured — it tells the
plugin when the blind _should_ have arrived, so it doesn't hammer the
device with status checks.

> **Tip:** filming the blinds with your phone gives the most accurate timing.
> If multiple blinds run on the same controller and you see network errors
> when they all move at once, set slightly different `motion_time` values
> per blind (e.g. `9800`, `10000`, `10200`).

#### Per-direction and non-linear motion (`motion_time_graph`)

When up and down speeds differ, or motion is non-linear (slow start, fast
middle, etc.), use `motion_time_graph`:

```jsonc
"motion_time_graph": {
    "up":   [{ "pos": 0, "seconds": 0 }, { "pos": 50, "seconds": 9.7 }, { "pos": 100, "seconds": 14.3 }],
    "down": [{ "pos": 100, "seconds": 0 }, { "pos": 0, "seconds": 23.7 }]
}
```

Each direction must include entries for both `pos: 0` and `pos: 100`.
Intermediate points describe a piecewise-linear curve. `motion_time_graph`
takes precedence over `motion_time` when both are set.

`response_lag_ms` adds a fixed pre-motion delay to account for network or
RF latency between sending the command and the motor actually starting.

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

When your device or another automation can push position changes, run a
small HTTP listener so HomeKit stays in sync without polling. Send any HTTP
method to `http://<homebridge-host>:<webhook_port>/` — the body is ignored;
only the query string matters:

| Query string          | Effect                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `?pos=<0-100>`        | Update both `CurrentPosition` and `TargetPosition`. Use this to sync HomeKit after the device has moved.              |
| `?target=<0-100>`     | Update `TargetPosition` **only**, without driving the motor. Use when an external system has already moved the blind. |
| `?pos=<N>&target=<N>` | When both are present, `pos` wins.                                                                                    |

| Option                   | Default | Description                                                    |
| ------------------------ | ------- | -------------------------------------------------------------- |
| `webhook_port`           | `0`     | Port to listen on. `0` disables the listener.                  |
| `webhook_http_auth_user` | —       | Optional Basic Auth username.                                  |
| `webhook_http_auth_pass` | —       | Optional Basic Auth password.                                  |
| `webhook_https`          | `false` | Use HTTPS instead of HTTP.                                     |
| `webhook_https_keyfile`  | —       | Path to TLS private key. Auto-generated and cached if omitted. |
| `webhook_https_certfile` | —       | Path to TLS certificate. Auto-generated and cached if omitted. |

Credentials are compared with timing-safe equality, and self-generated
certificates rotate automatically before expiry.

### Outbound position mapping (`send_pos_jsonata`)

JSONata expression that maps the HomeKit target (0–100) to whatever value your
device expects before substituting into `%%POS%%` or `%%POSINT%%`. The input
to the expression is the integer position; the output is substituted directly.

```jsonc
"send_pos_jsonata": "$round( ( 100 - $number($) ) * 255 / 100 )"
```

The above inverts the value and scales it from `0–100` to `0–255`.

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

**Extra HomeKit controls**

| Option                  | Default | Description                                                                                                                                                                              |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `show_stop_button`      | `false` | Expose a HomeKit switch that sends the stop URL. Most users should rely on the standard `HoldPosition` (see below) instead.                                                              |
| `show_toggle_button`    | `false` | Expose a HomeKit switch that toggles between the last up and last down command. On startup it stays idle until either the persisted position is `0` or `100`, or the user issues a move. |
| `show_favorite_buttons` | `[]`    | Expose HomeKit switches for shortcut positions, e.g. `[25, 50, 75]`.                                                                                                                     |

**Position quirks**

| Option                       | Default | Description                                                                                                                  |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `invert_position`            | `false` | Swap the `0%` and `100%` endpoints in HomeKit. Common for awnings/shades where "closed" means physically extended.           |
| `use_same_url_for_stop`      | `false` | Re-send the most recent up/down URL instead of `stop_url`. For blinds that toggle on a single endpoint.                      |
| `trigger_stop_at_boundaries` | `false` | Send a stop command even when moving to fully open or fully closed. Most blinds stop themselves; only enable if yours don't. |

**Identity and diagnostics**

| Option          | Default | Description                                                                                                                |
| --------------- | ------- | -------------------------------------------------------------------------------------------------------------------------- |
| `unique_serial` | `false` | Use a UUID-based serial/model in HomeKit. Required for some external integrations (e.g. Eve) that expect distinct serials. |
| `verbose`       | `false` | Log additional diagnostics: every poll, motion calculations, JSON parse errors, etc. Useful when debugging.                |

### HomeKit characteristics exposed

The accessory implements the standard HAP `WindowCovering` service plus an
`AccessoryInformation` service. The following characteristics are wired:

| Characteristic        | Direction  | Notes                                                                                                                                                                         |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CurrentPosition`     | read       | Returns the cached last-known position immediately; never blocks on the network. Polled in the background when `pos_url` is set, and persisted across Homebridge restarts.    |
| `TargetPosition`      | read/write | Writes trigger the move pipeline. Optionally debounced via `set_debounce_ms`.                                                                                                 |
| `PositionState`       | read       | `INCREASING` / `DECREASING` / `STOPPED`.                                                                                                                                      |
| `ObstructionDetected` | read       | Set on retry-exhausted failures (after `obstruction_threshold` consecutive failures). Clears on the next success.                                                             |
| `HoldPosition`        | write      | **Standard HAP characteristic on the WindowCovering tile itself** — the Home app exposes it inline, and Siri/automations can target it ("stop the blinds"). Sends `stop_url`. |

`HoldPosition` is different from the optional `show_stop_button` feature
(below): the latter adds a separate HomeKit `Switch` accessory. Most users
should rely on `HoldPosition`. The Stop button is kept for setups that
already have automations bound to that switch.

### Full advanced example

A maximalist example showing every supported option at once. **You almost
certainly don't need most of this** — copy from [`examples/`](./examples)
instead and only reach for these knobs if your blind genuinely needs them.

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
npm run lint         # ESLint (flat config, typescript-eslint)
npm run typecheck    # tsc --noEmit
npm test             # vitest
npm run build        # emits dist/
npm run format       # prettier --write
npm run smoke        # end-to-end packaging check (requires npm run build first)
```

`prepublishOnly` chains `format:check`, `lint`, `typecheck`, `test`, `build`,
and `smoke`, so a clean `npm publish` proves the whole pipeline.

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
