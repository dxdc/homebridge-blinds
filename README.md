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

#### Standard, basic configuration

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": "http://1.2.3.4/window/up",
    "down_url": "http://1.2.3.4/window/down",
    "stop_url": "http://1.2.3.4/window/stop",
    "http_options": {
        "method": "GET"
    },
    "success_codes": [200],
    "motion_time": 10000,
    "response_lag": 0
}
```

#### More advanced configuration

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": "http://1.2.3.4/window/up",
    "down_url": "http://1.2.3.4/window/down",
    "position_url": "http://1.2.3.4/window/position",
    "position_interval": 15000,
    "position_jsonata": "ShutterPosition1",
    "stop_url": "http://1.2.3.4/window/stop",
    "map_send_jsonata": "$round( ( 100 - $number($) ) * 255 / 100 )",
    "http_options": {
        "body": "{}",
        "headers": {
            "API-Token": "aaabbbcccddd"
        },
        "method": "PUT"
    },
    "success_codes": [200, 204],
    "max_http_attempts": 5,
    "retry_delay": 2000,
    "unique_serial": false,
    "use_same_url_for_stop": false,
    "show_stop_button": false,
    "show_toggle_button": false,
    "webhook_port": 51828,
    "webhook_http_auth_user": "username",
    "webhook_http_auth_pass": "password",
    "webhook_https": false,
    "webhook_https_keyfile": "/path/to/https.key",
    "webhook_https_certfile": "/path/to/https.crt",
    "motion_up_time": 11000,
    "motion_down_time": 10000,
    "response_lag": 0,
    "trigger_stop_at_boundaries": false,
    "verbose": false
}
```

### URL Configuration

---

#### Basic

You can omit any of the `up_url`, `down_url`, `stop_url` if you don't want these to send a command, and `position_url` if you want the blinds to only emulate the position (using a timer).

You can omit `http_options`, it defaults to `{ method: 'POST' }`. Note that it can also be configured to accept any number of additional arguments (headers, body, form, etc.) that [request](https://github.com/request/request) or [requestretry](https://github.com/FGRibreau/node-request-retry) supports.

`success_codes` allows you to define which HTTP response codes indicate a successful server response. If omitted, it defaults to 200.

`max_http_attempts` allows you to define a maximum number of retries on a failed or timed out request (retry on 5xx or network errors). If omitted, it defaults to 5. If no retries are desired, set this value to 1.

`retry_delay` allows you to define the number of ms between HTTP retries (`max_http_attempts` > 1). If omitted, it defaults to 2000 (2 seconds). The minimum number of ms has been set to 100 to avoid excessive requests.

#### Command-line scripts

Any of the url config parameters (`up_url`, `down_url`, `stop_url`, etc.) can be used to trigger command-line scripts instead. To use this feature, simply add the `file://` prefix to the command. The command should be specified in full without URL encoding. This could be used to trigger external blinds commands via serial connection or MQTT.

For example:

```json
      "up_url": "file://python /home/pi/run_script.py",
```

If `file://` is found as the prefix, it is removed and the remaining string is executed directly. _Use caution when defining scripts_ as they are submitted to the system as received.

See the Wiki for examples of user-written scripts. Setting `verbose` to `true` in the config may also be useful for troubleshooting.

#### Advanced

Alternatively, for more advanced configuration of URL's, each URL can be set to a complete `request`/`requestretry` object, e.g.:

```json
      "up_url": {
        "url": "http://1.2.3.4/window/up",
        "body": "{}",
        "headers": {
          "API-Token": "aaabbbcccddd"
        },
        "method": "PUT",
        "maxAttempts": 5,
        "retryDelay": 2000,
        "time": false
      },
```

If an object is used for the configuration, `http_options`, `max_http_attempts`, and `retry_delay` are ignored, and these values must be instead specified directly inside the object. `success_codes` are still used globally.

If `time` is set to true, a full request timing profile (wait, dns, tcp, firstByte, download, total) will be logged (see [timingPhases](https://github.com/request/request/blob/master/README.md)).

### Blinds position

---

The plugin emulates the blinds position (it saves it in a variable) using an understanding of how long the blinds take to move and the relative position, but it can be used with `position_url` for real time feedback.

#### Sending specific/exact position (optional)

For `up_url` and `down_url`, the variable `%%POS%%` can be included in the URL, which will be replaced with the desired target before the URL is requested. For example, use of `http://1.2.3.4/window/up?pos=%%POS%%` would be modified to `http://1.2.3.4/window/up?pos=100` if the position 100 was requested. This is useful for cases where blinds offer the ability to directly specify the value.

When `%%POS%%` is used, note that `stop_url` will not be sent. (Because the blinds can receive a specific position, there is no need to send an additional stop command.)

**NOTE**: In scenarios where `%%POS%%` is part of a body object and required to be sent as an integer instead of a string, `{ pos: "%%POSINT%%" }` can be used. In this case, it will be replaced with the target position as an integer value, e.g., `{ pos: 5 }`.

If transforming `%%POS%%` or `%%POSINT%%` values before sending is desired (e.g., the endpoint uses a different numerical scheme), `map_send_jsonata` can be defined. This allows a [JSONata](https://jsonata.org/) expression to be used to pre-parse the value instead of the default HomeKit 0-100 values.

So, `map_send_jsonata` could be set to a custom expression like `$round( ( 100 - $number($) ) * 255 / 100 )` where `$` represents the target position value.
The [JSONata Exerciser](https://try.jsonata.org/) can be a helpful tool for developing custom expressions.

#### Receiving specific position (optional, ad hoc basis)

If the following parameters are defined, the position can be updated using a webhook. At a minimum, `webhook_port` must be defined. `webhook_http_auth_user` / `webhook_http_auth_pass` are used for basic authentication. If `webhook_https` is true, then an SSL connection is used instead. If `webhook_https_keyfile` / `webhook_https_keyfile` are not defined, a self-signed certificate will be used instead.

Once defined, this can be updated as follows: `http://homebridgeip:port/?pos=##`, where `pos=` any integer between 0-100. A simple JSON where `success` is true or false is returned. Additional information is returned in the logs.

For example, `http://192.168.1.40:51828/?pos=30`.

This implementation does take into account whether or not the blinds are moving, but will be most reliable in cases when blinds are stationary.

```json
      "webhook_port": 51828,
      "webhook_http_auth_user": "username",
      "webhook_http_auth_pass": "password",
      "webhook_https": false,
      "webhook_https_keyfile": "/path/to/https.key",
      "webhook_https_certfile": "/path/to/https.crt",
```

#### Receiving specific position (optional, ongoing basis)

`position_url` must report the current state of the blinds as an integer (0-100) in either plain text or JSON format, e.g. `{"current_position": 40}`. If JSON is used, JSON keys are filtered to look for a **single** numeric response, but the JSON handling is not very robust and will cause unexpected results if multiple numeric keys are present.

`position_url` defaults to a simple GET request, ignoring headers or other methods specified in `http_options`. If more robust handling is required, `position_url` can be defined as a complete `request`/`requestretry` object as specified in `Advanced URL` above.

If more robust handling of `position_url` responses in JSON format is needed, `position_jsonata` can be defined. This allows a [JSONata](https://jsonata.org/) expression to be set to parse the result. For example, considering the following JSON response:

```json
{
    "example": { "value": 4 }
}
```

So, `position_jsonata` could be set to `example.value` (as below) to produce the value of `4`.

```json
    "position_jsonata": "example.value",
```

Also, note that if the returned value is not in JSON format, `$` can be used in some instances. For example, the expression below could be used to replace `"` in the case of a simple string response like `"25"`.

```json
    "position_jsonata": "$replace($, '\"', '')",
```

The [JSONata Exerciser](https://try.jsonata.org/) can be a helpful tool for developing custom expressions.

Ensure that the motion time is configured properly, even when `position_url` is set, as it is used to obtain an estimate of blind position to avoid multiple web requests to the `position_url`. (After the estimated position is reached, the position will be confirmed).

`position_interval` is specified in ms, and defaults to 15000 ms (15 s). It can be used to set the polling frequency, particularly useful in cases where the blinds can also be controlled externally.

### Motion Time and Calibration

---

`motion_time` is the time, in milliseconds, for your blinds to move from up to down. This should only include the time the motor is running. Filming this with your phone to determine the time may be easier than trying to do it with a timer. **NOTE**: If you are performing multiple blind requests simultaneously and are getting network timeouts due to your configuration, try using non-identical `motion_time` (e.g., 9800, 10000, 10200 vs. 10000 for each) it may help.

For cases where `motion_time` varies based on the direction of shutter movement (i.e., due to gravity), `motion_down_time` and `motion_up_time` may be used for more fine-tuning.

-   `motion_down_time` is the time, in milliseconds, for your blinds to move from up to down.
-   `motion_up_time` is the time, in milliseconds, for your blinds to move from down to up.
-   Everything else is exactly as described in `motion_time` above.

Ideally, a better approach would be using some kind of equation for calculating the exact time. This would be a nice-to-have feature in the future.

**`motion_down_time` and `motion_up_time` have a higher priority over `motion_time`**. This means, that if all three are explicitly provided in the configuration file, the value set in `motion_time` will be ignored.

**Steps:**

1. HTTP UP/DOWN request sent; wait for successful reply (i.e., `success_codes`) = `HTTP request delay (measured)`
2. Wait for device to send the signal to blinds, and movement begins = `response_lag`
3. Total motion time = `current_position` - `target_position`) / 100 \* `motion_time`
4. Send stop request (if needed) = `Total motion time` - `HTTP request delay` - `response_lag`
5. Wait for blinds to reach the target position = `Total motion time`

-   The HTTP request delay is in the logs, i.e., `Move request sent (484 ms)` indicates the HTTP request took 484 ms.

-   Using `response_lag` also helps ensure that if a move event is interrupted early, the position of the blinds will still be correct.

-   Because the `HTTP request delay` in Step 1 can vary significantly (e.g., in the event of a failed request, it could be a few seconds), it is not included in the equation for Step 4. This is also shown in the Example below.

-   The optional stop request needs to be sent _before_ the blinds will actually reach the target position. This is because there is a delay (i.e., Steps 1 and 2) before a request is sent, received, and the corresponding signal sent.

Therefore, to calibrate your blinds, you will need to set `response_lag`. This can be a second or more in some cases. The simplest way to do this is to determine the time from initiating an open/close event via HomeKit to the time you can see/hear movement, and subtract the `HTTP request delay` (from the logs). This is only relevant when `trigger_stop_at_boundaries` is required, or, a value of 1-99 is used for the blinds (not just fully open or closed).

##### Example scenario (`motion_time` = 10000, `response_lag` = 750):

-   0.00 `Open` command sent
-   0.25 `HTTP request` successful (`Move request sent (250 ms)`)
-   1.00 Blinds moving...
-   10.25 `Stop` request sent
-   10.50 (est.) `HTTP request` successful
-   11.00 (Blinds should have stopped moving here, but `HTTP request delay` was ignored as mentioned above)
-   11.25 `Stop` command received by blinds, blinds stopped moving

### Manual Stop and Toggle buttons

---

These can be set to `true` or `false`, but the default is `false`.

-   `show_stop_button` will expose a HomeKit button for the stop command. Some logic has also been added to smoothly abort any currently running functions.

-   `show_toggle_button` will expose a HomeKit button that allows the blinds position to be toggled based on the last command sent. For example, if the last command sent to the blinds was `up`, it will send the command `down`. Note that on start up, `toggle` will have no effect unless either 1) the initial blinds position on start up is either 0 or 100, or, 2) at least one command (`up` or `down`) is sent.

### Special Cases

---

These can be set to `true` or `false`, but the default is `false`.

-   `unique_serial` will use a uuid-based serial/model number instead of the default `BlindsHTTPAccessory`. This should only be required for specific external integrations (such as Eve) that may have problems with identical serial numbers for multiple devices.

-   `use_same_url_for_stop` will send the previously sent url (either, `up_url` or `down_url`) again. This is for specific blind types that don't use a standard stop URL.

-   `trigger_stop_at_boundaries` sends an additional stop command when moving the blinds to position 0 or 100. Most blinds don't require this command and will stop by themselves.

-   `verbose` adds additional logging capabilities.

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

## Specific configurations by manufacturer:

### Bond and Bond Bridge Pro

-   [Product Link](https://bondhome.io/)
-   [Homebridge-Bond](https://github.com/aarons22/homebridge-bond)
-   [Bond API](http://docs-local.appbond.com/)

Sample `config.json`, noting that you need to replace `1.2.3.4` with your Bond IP address, `<deviceId>` with your deviceId, and `<BondToken>` with your Bond token.

These values can be obtained from the Bond app, under `Device settings` for any individual shades.

#### Bond Configuration

```json
{
    "accessory": "BlindsHTTP",
    "name": "Dining Room Shades",
    "up_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Open",
    "down_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Close",
    "stop_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Hold",
    "http_options": {
        "body": "{}",
        "headers": {
            "BOND-Token": "<BondToken>"
        },
        "method": "PUT"
    },
    "success_codes": [200, 204],
    "motion_time": 11000,
    "response_lag": 1000,
    "trigger_stop_at_boundaries": false
}
```

#### Bond Bridge Pro Configuration (supports SetPosition)

Bond Bridge Pro supports the `SetPosition` command, which allows for finer-tuned control. Note that Bond's convention for 0-100% is exactly opposite of HomeKit's convention, so Jsonata was used to remap the values.

```json
{
    "accessory": "BlindsHTTP",
    "name": "Dining Room Shades",
    "up_url": {
        "url": "http://1.2.3.4/v2/devices/36ecfde3/actions/SetPosition",
        "body": "{\"argument\": %%POS%%}",
        "headers": {
            "BOND-Token": "<BondToken>"
        },
        "method": "PUT"
    },
    "down_url": {
        "url": "http://1.2.3.4/v2/devices/36ecfde3/actions/SetPosition",
        "body": "{\"argument\": %%POS%%}",
        "headers": {
            "BOND-Token": "<BondToken>"
        },
        "method": "PUT"
    },
    "position_url": {
        "url": "http://1.2.3.4/v2/devices/36ecfde3/state",
        "headers": {
            "BOND-Token": "<BondToken>"
        },
        "method": "GET"
    },
    "position_interval": 15000,
    "position_jsonata": "$round( 100 - $number(position) )",
    "map_send_jsonata": "$round( 100 - $number($) )",
    "stop_url": {
        "url": "http://1.2.3.4/v2/devices/36ecfde3/actions/Hold",
        "body": "{}",
        "headers": {
            "BOND-Token": "<BondToken>"
        },
        "method": "PUT"
    },
    "motion_time": 24000,
    "response_lag": 1000,
    "success_codes": [200, 204],
    "verbose": true
}
```

If you are having difficulty finding the settings, you can test your Bond device from the command line directly first (substituting your IP address, BOND-Token, and deviceId, e.g.:

```sh
    curl -H "BOND-Token: f074b61f628018fd" -i http://1.2.3.4/v2/devices/79135791/actions/Open -X PUT -d "{}"
```

Alternatively, sample shell script to retrieve the list of Bond deviceId's using the local API, replacing `1.2.3.4` with your Bond IP address, and `<BondToken>` with your Bond token:

```sh
#!/bin/sh

# CONFIGURE BOND_IP AND BOND_TOKEN TO MATCH YOUR CONFIGURATION
BOND_IP="1.2.3.4"
BOND_TOKEN="<BondToken>"

if ! [ -x "$(command -v jq)" ]; then
  echo 'Error: jq is not installed.' >&2
  exit 1
fi

BOND_DEVICES=$( curl -s "http://${BOND_IP}/v2/devices" -X GET -d "{\"_token\": \"${BOND_TOKEN}\"}" | jq -r 'keys[]' | grep -v '_' )

while read -r line; do
   DEVICE_DETAILS=$( curl -sH "BOND-Token: ${BOND_TOKEN}" "http://${BOND_IP}/v2/devices/${line}" | jq '.name' )
   echo "${DEVICE_DETAILS} ${line}"
done <<< "${BOND_DEVICES}"
```

### Tasmota

-   [Product Link](https://github.com/arendst/Tasmota)

Sample `config.json`, noting that you need to replace `1.2.3.4` with your Tasmota IP address. As described above, `%%POS%%` is used to supply the target position (0-100) to the plugin.

```json
{
    "accessory": "BlindsHTTP",
    "name": "Window",
    "up_url": "http://1.2.3.4/cm?cmnd=ShutterPosition%20%%POS%%",
    "down_url": "http://1.2.3.4/cm?cmnd=ShutterPosition%20%%POS%%",
    "stop_url": "http://1.2.3.4/cm?cmnd=Power3%20ON",
    "http_options": {
        "method": "GET"
    },
    "success_codes": [200],
    "max_http_attempts": 5,
    "retry_delay": 2000,
    "use_same_url_for_stop": false,
    "show_stop_button": true,
    "show_toggle_button": false,
    "motion_time": 20000,
    "response_lag": 0,
    "trigger_stop_at_boundaries": false,
    "verbose": false
}
```

### Louvolite One Touch (Neo Smart Blinds)

-   [Product Link](https://www.louvolite.com/louvolite-home-hub/)
-   [Neo Smart Blinds](http://neosmartblinds.com)

Louvolite's smart home system seems to be build on top of Neo Smart Blinds platform, so this configuration is likely to work with other manufacturers utilising Neo. You will need the following values for the config:

-   `<controller_ip>` is the IP address of Louvolite's One Touch (or other Neo-based hub), e.g. 1.2.3.4;
-   `<controller_id>` is the controller identifier, which you can find in the Neo app on the controller page, this is a long alphanumeric identifier;
-   `<blind_code>` you can also find in the Neo app at the bottom of the blind page — it looks something like 123.456-01.

```json
{
    "accessory": "BlindsHTTP",
    "name": "Louvolite Blind",
    "up_url": "http://<controller_ip>:8838/neo/v1/transmit?id=<controller_id>&command=<blind_code>-up",
    "down_url": "http://<controller_ip>:8838/neo/v1/transmit?id=<controller_id>&command=<blind_code>-dn",
    "stop_url": "http://<controller_ip>:8838/neo/v1/transmit?id=<controller_id>&command=<blind_code>-sp",
    "http_options": {
        "method": "GET"
    }
}
```

[badge_paypal]: https://img.shields.io/badge/Donate-PayPal-blue.svg
[paypal-donations-dxdc]: https://paypal.me/ddcaspi
