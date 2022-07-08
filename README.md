# homebridge-blinds

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![isc license](https://badgen.net/badge/license/ISC/red)](https://github.com/dxdc/homebridge-blinds/blob/master/LICENSE)
[![npm](https://badgen.net/npm/v/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![npm](https://badgen.net/npm/dt/homebridge-blinds)](https://www.npmjs.com/package/homebridge-blinds)
[![Discord](https://camo.githubusercontent.com/7494d4da7060081501319a848bbba143cbf6101a/68747470733a2f2f696d672e736869656c64732e696f2f646973636f72642f3433323636333333303238313232363237303f636f6c6f723d373238454435266c6f676f3d646973636f7264266c6162656c3d646973636f7264)](https://discord.gg/9VgPRmY)
[![Donate](https://badgen.net/badge/Donate/PayPal/91BE09)](https://paypal.me/ddcaspi)

`homebridge-blinds` is a plugin for Homebridge.

Control your `http`-based blinds via Homebridge (also works for command-line scripts as well)!

## Installation

If you are new to Homebridge, please first read the Homebridge [documentation](https://www.npmjs.com/package/homebridge).
If you are running on a Raspberry, you will find a tutorial in the [homebridge-punt Wiki](https://github.com/cflurin/homebridge-punt/wiki/Running-Homebridge-on-a-Raspberry-Pi).

Install Homebridge:

```sh
sudo npm install -g homebridge
```

Install homebridge-blinds:

```sh
sudo npm install -g homebridge-blinds
```

## Configuration

Add the accessory in `config.json` in your home directory inside `.homebridge`.

#### Basic configuration

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": {
        "url": "http://1.2.3.4/window/up",
        "method": "GET"
    },
    "down_url": {
        "url": "http://1.2.3.4/window/down",
        "method": "GET"
    },
    "stop_url": {
        "url": "http://1.2.3.4/window/stop",
        "method": "GET"
    },
    "http_success_codes": [200, 204],
    "motion_time": 10000
}
```

#### Advanced configuration

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": {
        "url": "http://1.2.3.4/window/up?pos=%%POS%%",
        "body": "{}",
        "headers": {
            "API-Token": "aaabbbcccddd"
        },
        "method": "PUT",
        "maxAttempts": 5,
        "retryDelay": 2000,
        "time": true
    },
    "down_url": {
        "url": "http://1.2.3.4/window/down?pos=%%POS%%",
        "body": "{}",
        "headers": {
            "API-Token": "aaabbbcccddd"
        },
        "method": "PUT"
    },
    "send_pos_jsonata": "$round( ( 100 - $number($) ) * 255 / 100 )",
    "stop_url": {
        "url": "http://1.2.3.4/window/stop",
        "body": "{}",
        "headers": {
            "API-Token": "aaabbbcccddd"
        },
        "method": "PUT"
    },
    "pos_url": "http://1.2.3.4/window/position",
    "pos_poll_ms": 15000,
    "pos_jsonata": "ShutterPosition1",
    "http_success_codes": [200, 204],
    "response_lag_ms": 0,
    "motion_time_graph": {
        "up": [
            { "pos": 0, "seconds": 0 },
            { "pos": 1, "seconds": 9.25 },
            { "pos": 10, "seconds": 11.09 },
            { "pos": 99, "seconds": 24.72 },
            { "pos": 100, "seconds": 24.87 }
        ],
        "down": [
            { "pos": 100, "seconds": 0 },
            { "pos": 50, "seconds": 6.8 },
            { "pos": 1, "seconds": 15.35 },
            { "pos": 0, "seconds": 23.72 }
        ]
    },
    "unique_serial": false,
    "show_toggle_button": false,
    "show_stop_button": false,
    "show_favorite_buttons": [1, 50],
    "use_same_url_for_stop": false,
    "trigger_stop_at_boundaries": false,
    "webhook_port": 51828,
    "webhook_http_auth_user": "username",
    "webhook_http_auth_pass": "password",
    "webhook_https": false,
    "webhook_https_keyfile": "/path/to/https.key",
    "webhook_https_certfile": "/path/to/https.crt",
    "verbose": false
}
```

## Tested Configurations

Tested and working configurations for devices (e.g., Tasmota, Bond, Louvolite) are available on the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Tested-configurations).

### URL Configuration

---

#### Basic

You can omit any of the `up_url`, `down_url`, `stop_url` if you don't want these to send a command. By default, the blinds will emulate the position (using a timer) unless `pos_url` is specified.

Note that any number of additional http arguments (headers, body, etc.) that [request](https://github.com/request/request) or [requestretry](https://github.com/FGRibreau/node-request-retry) supports can be included. For instance, `maxAttempts` and `retryDelay` can be used for http retries, and `time` will log a full request timing profile (see [timingPhases](https://github.com/request/request/blob/master/README.md)).

`http_success_codes` allows you to define which HTTP response codes indicate a successful server response. If omitted, it defaults to 200.

#### Triggering command-line scripts

Any of the url config parameters (`up_url`, `down_url`, `stop_url`, etc.) can be used to trigger command-line scripts instead. To use this feature, simply add the `file://` prefix to the command. The command should be specified in full without URL encoding. This could be used to trigger external blinds commands via serial connection or MQTT. See the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Command-line-scripts) for examples of user-written scripts. Setting `verbose` to `true` in the config may also be useful for troubleshooting.

### Blinds position

---

The plugin emulates the blinds position using a timer, but it can be optionally used to poll the current position (with `pos_url`), include the target position in the request (with `%%POS%%`), and trigger a change in blind position via webhook.

See the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Blinds-position) for additional details.

### Motion Time and Calibration

---

`motion_time` is the number of milliseconds for your blinds to move from up to down, and should only include the time the motor is running.

Even if your blinds are reporting its position back to this plugin, this value still needs to be set. It's used to emulate the blind position internally, and calculate the expected duration of movement, thereby more efficiently knowing when the blind _should_ be at the target position and not sending too many HTTP requests to update its current position.

Filming this with your phone is recommended for precision. **NOTE**: If you are performing multiple blind requests simultaneously and are getting network timeouts due to an overloaded API, try using non-identical `motion_time` values (e.g., 9800, 10000, 10200 vs. 10000 for each) it may help.

For cases where `motion_time` varies based on the direction of shutter movement, `motion_time_graph` can be used for more fine-tuning. Setting `response_lag_ms` accounts for network or RF-based delays. See the [Wiki](https://github.com/dxdc/homebridge-blinds/wiki/Motion-time).

### Optional parameters

| Option                       | Default | Explanation                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `show_stop_button`           | `false` | Expose a HomeKit button for the stop command.                                                                                                                                                                                                                                                                                                                                              |
| `show_toggle_button`         | `false` | Expose a HomeKit button that allows the blinds position to be toggled based on the last command sent. For example, if the last command sent to the blinds was `up`, it will send the command `down`. Note that on startup, `toggle` will have no effect unless either 1) the initial blinds position on start up is either 0 or 100, or, 2) at least one command (`up` or `down`) is sent. |
| `show_favorite_buttons`      | `[]`    | Expose HomeKit buttons for favorite positions, which are provided as an array of integers.                                                                                                                                                                                                                                                                                                 |
| `unique_serial`              | `false` | Use a uuid-based serial/model number instead of the default `BlindsHTTPAccessory`. This should only be required for specific external integrations (such as Eve) that may have problems with identical serial numbers for multiple devices.                                                                                                                                                |
| `use_same_url_for_stop`      | `false` | Send the previously sent url (either, `up_url` or `down_url`) again. This is for specific blind types that don't use a standard stop URL.                                                                                                                                                                                                                                                  |
| `trigger_stop_at_boundaries` | `false` | Send an additional stop command when moving the blinds to position 0 or 100. Most blinds don't require this command and will stop by themselves.                                                                                                                                                                                                                                           |
| `verbose`                    | `false` | Turns on additional logging.                                                                                                                                                                                                                                                                                                                                                               |

## How to contribute

Have an idea? Found a bug? Contributions and pull requests are welcome.

## Credits

:star2: A huge thank you to @zwerch who is the original creator and developer of this repository.

## Support this project

I try to reply to everyone needing help using these projects. Obviously, this takes time. However, if you get some profit from this or just want to encourage me to continue creating stuff, there are few ways you can do it:

-   Starring and sharing the projects you like :rocket:
-   [![PayPal][badge_paypal]][paypal-donations-dxdc] **PayPal**— You can make one-time donations to **dxdc** via PayPal.
-   **Venmo**— You can make one-time donations via Venmo.
    ![Venmo QR Code](/images/venmo.png?raw=true 'Venmo QR Code')
-   **Bitcoin**— You can send me Bitcoin at this address: `33sT6xw3tZWAdP2oL4ygbH5TVpVMfk9VW7`

[badge_paypal]: https://img.shields.io/badge/Donate-PayPal-blue.svg
[paypal-donations-dxdc]: https://paypal.me/ddcaspi
