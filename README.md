# homebridge-blinds

`homebridge-blinds` is a plugin for Homebridge.

Control your `http`-based blinds via Homebridge!

## Installation

If you are new to Homebridge, please first read the Homebridge [documentation](https://www.npmjs.com/package/homebridge).
If you are running on a Raspberry, you will find a tutorial in the [homebridge-punt Wiki](https://github.com/cflurin/homebridge-punt/wiki/Running-Homebridge-on-a-Raspberry-Pi).

Install homebridge:
```sh
sudo npm install -g homebridge
```
Install homebridge-blinds:
```sh
sudo npm install -g homebridge-blinds
```

## Configuration

Add the accessory in `config.json` in your home directory inside `.homebridge`.

```js
    {
      "accessory": "BlindsHTTP",
      "name": "Window",
      "up_url": "http://1.2.3.4/window/up",
      "down_url": "http://1.2.3.4/window/down",
      "position_url": "http://1.2.3.4/position",
      "stop_url": "http://1.2.3.4/window/stop",
      "http_method": {
        "body": "{}",
        "headers": {
          "API-Token": "aaabbbcccddd"
        },
        "method": "PUT"
      },
      "success_codes": [ 200, 204 ],
      "max_http_attempts": 5,
      "retry_delay": 2000,
      "use_same_url_for_stop": false,
      "show_stop_button": false,
      "show_toggle_button": false,
      "motion_time": 10000,
      "response_lag": 0,
      "trigger_stop_at_boundaries": false,
      "verbose": false
    }
```

### Standard URL Configuration

You can omit any of the `up_url`, `down_url`, `stop_url`, `position_url` if you don't want these to send a command.

You can omit `http_method`, it defaults to `POST`. Note that it can also be configured to accept any number of additional arguments (headers, body, form, etc.) that [request](https://github.com/request/request) or [requestretry](https://github.com/FGRibreau/node-request-retry) supports.

`success_codes` allows you to define which HTTP response codes indicate a successful server response. If omitted, it defaults to 200.

`max_http_attempts` allows you to define a maximum number of retries on a failed or timed out request (retry on 5xx or network errors). If omitted, it defaults to 5. If no retries are desired, set this value to 1.

`retry_delay` allows you to define the number of ms between HTTP retries (`max_http_attempts` > 1). If omitted, it defaults to 2000 (2 seconds). The minimum number of ms has been set to 100 to avoid excessive requests.

### Advanced URL Configuration

Alternatively, for more advanced configuration of URL's, each URL can be set to a complete request/requestretry object, e.g.:

```js
      "up_url": {
        "url": "http://1.2.3.4/window/up",
        "body": "{}",
        "headers": {
          "API-Token": "aaabbbcccddd"
        },
        "method": "PUT",
        "maxAttempts": 5,
        "retryDelay": 2000
      },
```

If an object is used for the configuration, `http_method`, `max_http_attempts`, and `retry_delay` are ignored, and these values must be instead specified directly inside the object. `success_codes` are still used globally.

### Sending specific position to the blinds

For `up_url` and `down_url`, the variable `%%POS%%` can be included in the URL, which will be replaced with the desired target before the URL is requested. For example, use of `http://1.2.3.4/window/up?pos=%%POS%%` would be modified to `http://1.2.3.4/window/up?pos=100` if the position 100 was requested. This is useful for cases where blinds offer the ability to directly specify the value.

When `%%POS%%` is used, note that `stop_url` will not be sent. Because the blinds can receive a specific position, that there is no need to send an additional stop command.

### Receiving specific position from the blinds

`position_url` is optional, but must report the current state of the blinds as an integer (0-100) via a simple GET request. Headers or other methods specified in `http_method` are ignored. Optionally, this response can also be in JSON format, e.g. `{"current_position": 40}`. JSON keys are filtered to look for a **single** numeric response, but the JSON handling is not very robust and will cause unexpected results if multiple numeric keys are present.

Ensure that the motion time is configured properly, even when `position_url` is set, as it is used to obtain an estimate of blind position to avoid multiple web requests to the `position_url`. (After the estimated position is reached, the position will be confirmed).

### Motion Time and Calibration

`motion_time` is the time, in milliseconds, for your blinds to move from up to down. This should only include the time the motor is running. Filming this with your phone to determine the time may be easier than trying to do it with a timer. **NOTE**: If you are performing multiple blind requests simultaneously and are getting network timeouts due to your configuration, try using non-identical `motion_time` (e.g., 9800, 10000, 10200 vs. 10000 for each) it may help.

**Steps:**
1. HTTP UP/DOWN request sent; wait for successful reply (i.e., `success_codes`) = `HTTP request delay (measured)`
2. Wait for device to send the signal to blinds, and movement begins = `response_lag`
3. Total motion time = `current_position` - `target_position`) / 100 * `motion_time`
4. Send stop request (if needed) = `Total motion time` - `HTTP request delay` - `response_lag`
5. Wait for blinds to reach the target position = `Total motion time`

- The HTTP request delay is in the logs, i.e., `Move request sent (484 ms)` indicates the HTTP request took 484 ms.

- Using `response_lag` also helps ensure that if a move event is interrupted early, the position of the blinds will still be correct.

- Because the `HTTP request delay` in Step 1 can vary significantly (e.g., in the event of a failed request, it could be a few seconds), it is not included in the equation for Step 4. This is also shown in the Example below.

- The optional stop request needs to be sent *before* the blinds will actually reach the target position. This is because there is a delay (i.e., Steps 1 and 2) before a request is sent, received, and the corresponding signal sent.

Therefore, to calibrate your blinds, you will need to set `response_lag`. This can be a second or more in some cases. The simplest way to do this is to determine the time from initiating an open/close event via HomeKit to the time you can see/hear movement, and subtract the `HTTP request delay` (from the logs). This is only relevant when `trigger_stop_at_boundaries` is required, or, a value of 1-99 is used for the blinds (not just fully open or closed).

##### Example scenario (`motion_time` = 10000, `response_lag` = 750):

- 0.00 `Open` command sent
- 0.25 `HTTP request` successful (`Move request sent (250 ms)`)
- 1.00 Blinds moving...
- 10.25 `Stop` request sent
- 10.50 (est.) `HTTP request` successful
- 11.00 (Blinds should have stopped moving here, but `HTTP request delay` was ignored as mentioned above)
- 11.25 `Stop` command received by blinds, blinds stopped moving

### Remaining Parameters

If `show_stop_button` is set to `true`, it will expose a HomeKit button for the stop command. Some logic has also been added to smoothly abort any currently running functions.

If `show_toggle_button` is set to `true`, it will expose a HomeKit button that will allow the blinds position to be toggled based on the last command sent. For example, if the last command sent to the blinds was `up`, it will send the command `down`. Note that on start up, `toggle` will have no effect unless either 1) the initial blinds position on start up is either 0 or 100, or, 2) at least one command (`up` or `down`) is sent.

`verbose` is optional and adds additional logging capabilities

### Parameters for Special Cases

If `use_same_url_for_stop` is set to `true`, it will send the previously sent url (either, `up_url` or `down_url`) again. This is for specific blind types that don't use a standard stop URL.

`trigger_stop_at_boundaries` allows you to choose if a stop command should be fired or not when moving the blinds to position 0 or 100.  Most blinds dont require this command and will stop by themselves, for such blinds it is advised to set this to `false`.

## Note

Currently the plugin only emulates the position (it saves it in a variable), but it can be used with `position_url` for realtime feedback.

Feel free to contribute to make this a better plugin!

## Specific configurations by manufacturer:

### Bond

- [Product Link](https://bondhome.io/)
- [Homebridge-Bond](https://github.com/aarons22/homebridge-bond)
- [Bond API](http://docs-local.appbond.com/)

Sample `config.json`, noting that you need to replace `1.2.3.4` with your Bond IP address, `<deviceId>` with your deviceId, and `<BondToken>` with your Bond token.

These values can be obtained from the Bond app, under `Device settings` for any individual shades.

```js
    {
      "accessory": "BlindsHTTP",
      "name": "Dining Room Shades",
      "up_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Open",
      "down_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Close",
      "stop_url": "http://1.2.3.4/v2/devices/<deviceId>/actions/Hold",
      "http_method": {
        "body": "{}",
        "headers": {
          "BOND-Token": "<BondToken>"
        },
        "method": "PUT"
      },
      "success_codes": [ 204 ],
      "motion_time": 11000,
      "response_lag": 1000,
      "trigger_stop_at_boundaries": false,
    }
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

- [Product Link](https://github.com/arendst/Tasmota)

Sample `config.json`, noting that you need to replace `1.2.3.4` with your Tasmota IP address. As described above, `%%POS%%` is used to supply the target position (0-100) to the plugin.

```js
    {
      "accessory": "BlindsHTTP",
      "name": "Window",
      "up_url": "http://1.2.3.4/cm?cmnd=ShutterPosition%20%%POS%%",
      "down_url": "http://1.2.3.4/cm?cmnd=ShutterPosition%20%%POS%%",
      "stop_url": "http://1.2.3.4/cm?cmnd=Power3%20ON",
      "http_method": {
          "method": "GET"
      },
      "success_codes": [ 200 ],
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