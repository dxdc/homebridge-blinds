var request = require("request");
var Service, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;
    homebridge.registerAccessory("homebridge-blinds", "BlindsHTTP", BlindsHTTPAccessory);
}

function BlindsHTTPAccessory(log, config) {
    // global vars
    this.log = log;

    // configuration vars
    this.name = config.name;
    this.upURL = config.up_url || false;
    this.downURL = config.down_url || false;
    this.stopURL = config.stop_url || false;
    this.stopAtBoundaries = config.trigger_stop_at_boundaries || false;
    this.httpMethod = config.http_method || { method: "POST" };
    this.successCodes = config.success_codes || [200];
    this.motionTime = parseInt(config.motion_time, 10) || 10000;
    this.responseLag = parseInt(config.response_lag, 10) || 0;
    this.verbose = config.verbose || false;

    this.cacheDirectory = HomebridgeAPI.user.persistPath();
    this.storage = require('node-persist');
    this.storage.initSync({
        dir: this.cacheDirectory,
        forgiveParseErrors: true
    });

    // state vars
    this.timeout = null;
    this.interval = null;
    this.lastPosition = this.storage.getItemSync(this.name) || 0; // last known position of the blinds, down by default
    this.currentTargetPosition = this.lastPosition;

    // register the service and provide the functions
    this.service = new Service.WindowCovering(this.name);

    // the current position (0-100%)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L493
    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .on('get', this.getCurrentPosition.bind(this));

    // the target position (0-100%)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1564
    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));
}

BlindsHTTPAccessory.prototype.getCurrentPosition = function(callback) {
    if (this.verbose) {
        this.log(`Requested CurrentPosition: ${this.lastPosition}%`);
    }
    callback(null, this.lastPosition);
}

BlindsHTTPAccessory.prototype.getTargetPosition = function(callback) {
    if (this.verbose) {
        this.log(`Requested TargetPosition: ${this.currentTargetPosition}%`);
    }
    callback(null, this.currentTargetPosition);
}

BlindsHTTPAccessory.prototype.setTargetPosition = function(pos, callback) {
    if (this.timeout != null) clearTimeout(this.timeout);
    if (this.interval != null) clearInterval(this.interval);

    this.currentTargetPosition = pos;
    if (this.currentTargetPosition == this.lastPosition) {
        if (this.currentTargetPosition % 100 > 0) {
            this.log(`Already there: ${this.currentTargetPosition}%`);
            callback(null);
            return;
        } else {
            this.log(`Already there: ${this.currentTargetPosition}%, re-sending request`);
        }
    }

    const moveUp = (this.currentTargetPosition >= this.lastPosition);
    const moveMessage = `Move ${moveUp ? 'up' : 'down'}`;
    this.log(`Requested ${moveMessage} (to ${this.currentTargetPosition}%)`);

    let self = this;
    this.httpRequest((moveUp ? this.upURL : this.downURL), this.httpMethod, function(err) {
        if (err) {
            callback(null);
            return;
        }

        this.storage.setItemSync(this.name, this.currentTargetPosition);
        const motionTimeSinglePct = this.motionTime / 100;

        let needsSendStopRequest = this.stopAtBoundaries || this.currentTargetPosition % 100 > 0;
        const sendStopAtPositionDiff = (motionTimeSinglePct > 0) ? Math.round(this.responseLag / motionTimeSinglePct) : 0;

        const waitDelay = Math.abs(this.currentTargetPosition - this.lastPosition) * motionTimeSinglePct;
        this.log(`Move request sent, waiting ${Math.round(waitDelay / 100) / 10}s (+ response lag of ${Math.round(this.responseLag / 100) / 10}s)...`);

        this.timeout = setTimeout(function() {
            self.interval = setInterval(function() {
                if (needsSendStopRequest && Math.abs(self.currentTargetPosition - self.lastPosition) <= sendStopAtPositionDiff) {
                    // Stop command needs to be sent before final position is reached to account for response lag
                    needsSendStopRequest = false;
                    self.httpRequest(self.stopURL, self.httpMethod, function(err) {
                        if (err) {
                            self.log.warn("Stop request failed");
                        } else {
                            self.log("Stop request sent");
                        }
                    }.bind(self));
                }

                if (self.lastPosition == self.currentTargetPosition) {
                    self.log(`End ${moveMessage} (to ${self.currentTargetPosition}%)`);
                    self.service.getCharacteristic(Characteristic.CurrentPosition)
                        .updateValue(self.lastPosition);
                    clearInterval(self.interval);
                } else {
                    self.lastPosition += (moveUp ? 1 : -1);
                }
            }, motionTimeSinglePct);
        }, this.responseLag);
    }.bind(this));

    callback(null);
}

BlindsHTTPAccessory.prototype.httpRequest = function(url, methods, callback) {
    if (!url) callback(null);

    var options = Object.assign({ url: url }, methods);
    request(options, function(err, response, body) {
        if (!err && response && this.successCodes.includes(response.statusCode)) {
            callback(null);
        } else {
            this.log.error(`Error sending request (HTTP status code ${response ? response.statusCode : 'not defined'}): ${err}`);
            callback(err);
        }
    }.bind(this));
}

BlindsHTTPAccessory.prototype.getServices = function() {
    return [this.service];
}
