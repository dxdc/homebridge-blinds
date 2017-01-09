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
      "motion_time": "<time which your blind needs to move from up to down (in milliseconds)>",
      "http_method": "PUT"
    }
```

You can omit `http_method`, it defaults to `POST`.

## Note
Currently the plugin only emulates the position (it saves it in a variable), because my blinds only support
up and down via urls.

Feel free to contribute to make this a better plugin!

