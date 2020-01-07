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
      "stop_url": "http://1.2.3.4/window/stop",
      "show_stop_button": false,
      "use_same_url_for_stop": false,
      "motion_time": 10000,
      "response_lag": 0,
      "http_method": {
        "body": "{}",
        "headers": {
          "API-Token": "aaabbbcccddd"
        },
        "method": "PUT"
      },
      "trigger_stop_at_boundaries": false,
      "success_codes": [ 200, 204 ],
      "max_http_attempts": 5,
      "retry_delay": 2000,
      "verbose": false
    }
```

You can omit any of the `up_url`, `down_url`, etc. if you don't want these to send a command.

If `use_same_url_for_stop` is set to true, it will send the previously sent url (either, `up_url` or `down_url`) again. This is for specific blind types that don't use a standard stop URL.
If `show_stop_button` is set to `true`, it will expose a HomeKit button for the stop command. Some logic has also been added to smoothly abort any currently running functions.


You can omit `http_method`, it defaults to `POST`. Note that it can be configured to accept any number of additional arguments (headers, body, form, etc.) that [request](https://github.com/request/request) or [requestretry](https://github.com/FGRibreau/node-request-retry) supports.

`motion_time` is the time, in milliseconds, for your blinds to move from up to down. This should only include the time the motor is running.

`response_lag` is an optional parameter used to improve the calculation for setting a specific blinds position. It takes into account the delay of the device you are using control the blinds (RF transmitter or otherwise). This is useful since it will do a better job of not under/overshooting the target:

1. Send HTTP command to url
2. Wait `response_lag`; expected finish time (`current_position` - `target_position`) / 100 * `motion_time`
3. Send stop command at (`current_position` - `target_position`) / 100 * `motion_time` - `response_lag`

You can see the amount of time that Step 1 takes by reviewing the logs, i.e., `Move request sent (484 ms)` indicates the HTTP request took 484 ms.

`success_codes` allows you to define which HTTP response codes indicate a successful server response. If omitted, it defaults to 200.

`max_http_attempts` allows you to define a maximum number of retries on a failed or timed out request (retry on 5xx or network errors). If omitted, it defaults to 5. If no retries are desired, set this value to 1.

`retry_delay` allows you to define the number of ms between HTTP retries (`max_http_attempts` > 1). If omitted, it defaults to 2000 (2 seconds). The minimum number of ms has been set to 100 to avoid excessive requests.

`trigger_stop_at_boundaries` allows you to choose if a stop command should be fired or not when moving the blinds to position 0 or 100.  Most blinds dont require this command and will stop by themself, for such blinds it is advised to set this to `false`.

`verbose` is optional and shows `getTargetPosition` / `getTargetState` / `getCurrentPosition` requests

## Note
Currently the plugin only emulates the position (it saves it in a variable), because my blinds only support
up and down via urls.

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
      "motion_time": 11000, 
      "response_lag": 1000, 
      "http_method": {
        "body": "{}", 
        "headers": {
          "BOND-Token": "<BondToken>"
        }, 
        "method": "PUT"
      }, 
      "success_codes": [ 204 ], 
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