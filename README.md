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
      "verbose": false
    }
```

You can omit `http_method`, it defaults to `POST`. Note that it can be configured to accept any number of additional arguments (headers, body, form, etc.) that [request](https://github.com/request/request) supports.

`motion_time` is the time, in milliseconds, for your blinds to move from up to down.

`response_lag` is an optional parameter used to improve the calculation for setting a specific blinds position. `expected_wait_time` = (`current_position` - `target_position`) / 100 * `motion_time` - `response_lag`.

`success_codes` allows you to define which HTTP response codes indicate a successful server response. If omitted, it defaults to 200.

`trigger_stop_at_boundaries` allows you to choose if a stop command should be fired or not when moving the blinds to position 0 or 100.  Most blinds dont require this command and will stop by themself, for such blinds it is advised to set this to `false`.

`verbose` is optional and shows getTargetPosition / getTargetState / getCurrentPosition requests

## Note
Currently the plugin only emulates the position (it saves it in a variable), because my blinds only support
up and down via urls.

Feel free to contribute to make this a better plugin!
