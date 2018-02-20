var request = require("request");
var Service, Characteristic;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;

    homebridge.registerAccessory("homebridge-blinds", "BlindsHTTP", BlindsHTTPAccessory);
}

function BlindsHTTPAccessory(log, config) {
    // global vars
    this.log = log;

    // configuration vars
    this.name = config["name"];
    this.upURL = config["up_url"];
    this.downURL = config["down_url"];
    this.stopURL = config["stop_url"];
    this.stopAtBoundaries = config["trigger_stop_at_boundaries"];
    this.httpMethod = config["http_method"] || { method: "POST" };
    this.successCodes = config["success_codes"] || [ 200 ];
    this.motionTime = config["motion_time"];

    // state vars
    this.interval = null;
    this.timeout = null;
    this.lastPosition = 0; // last known position of the blinds, down by default
    this.currentPositionState = 2; // stopped by default
    this.currentTargetPosition = 0; // down by default

    // register the service and provide the functions
    this.service = new Service.WindowCovering(this.name);

    // the current position (0-100%)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L493
    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .on('get', this.getCurrentPosition.bind(this));

    // the position state
    // 0 = DECREASING; 1 = INCREASING; 2 = STOPPED;
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1138
    this.service
        .getCharacteristic(Characteristic.PositionState)
        .on('get', this.getPositionState.bind(this));

    // the target position (0-100%)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js#L1564
    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));
}

BlindsHTTPAccessory.prototype.getCurrentPosition = function(callback) {
    this.log("Requested CurrentPosition: %s", this.lastPosition);
    callback(null, this.lastPosition);
}

BlindsHTTPAccessory.prototype.getPositionState = function(callback) {
    this.log("Requested PositionState: %s", this.currentPositionState);
    callback(null, this.currentPositionState);
}

BlindsHTTPAccessory.prototype.getTargetPosition = function(callback) {
    this.log("Requested TargetPosition: %s", this.currentTargetPosition);
    callback(null, this.currentTargetPosition);
}

BlindsHTTPAccessory.prototype.setTargetPosition = function(pos, callback) {
    this.log("Set TargetPosition: %s", pos);
    this.currentTargetPosition = pos;
    if (this.currentTargetPosition == this.lastPosition) {
        if (this.interval != null) clearInterval(this.interval);
        if (this.timeout != null) clearTimeout(this.timeout);
        this.log("Already here");
        callback(null);
        return;
    }
    const moveUp = (this.currentTargetPosition >= this.lastPosition);
    this.log((moveUp ? "Moving up" : "Moving down"));

    this.service
        .setCharacteristic(Characteristic.PositionState, (moveUp ? 1 : 0));

    this.httpRequest((moveUp ? this.upURL : this.downURL), this.httpMethod, function() {
        this.log(
            "Success moving %s",
            (moveUp ? "up (to " + pos + ")" : "down (to " + pos + ")")
        );
        this.service
            .setCharacteristic(Characteristic.CurrentPosition, pos);
        this.service
            .setCharacteristic(Characteristic.PositionState, 2);
    }.bind(this));

    var localThis = this;
    if (this.interval != null) clearInterval(this.interval);
    if (this.timeout != null) clearTimeout(this.timeout);
    this.interval = setInterval(function(){
        localThis.lastPosition += (moveUp ? 1 : -1);
        if (localThis.lastPosition == localThis.currentTargetPosition) {
            if (localThis.currentTargetPosition != 0 && localThis.currentTargetPosition != 100) {
                localThis.httpRequest(localThis.stopURL, localThis.httpMethod, function() {
                    localThis.log(
                        "Success stop moving %s",
                        (moveUp ? "up (to " + pos + ")" : "down (to " + pos + ")")
                    );
                    localThis.service
                        .setCharacteristic(Characteristic.CurrentPosition, pos);
                    localThis.service
                        .setCharacteristic(Characteristic.PositionState, 2);
                    localThis.lastPosition = pos;
                }.bind(localThis));
            }
            clearInterval(localThis.interval);
        }
    }, parseInt(this.motionTime) / 100);
    if (this.stopAtBoundaries && (this.currentTargetPosition == 0 || this.currentTargetPosition == 100)) {
        this.timeout = setTimeout(function() {
            localThis.httpRequest(localThis.stopURL, localThis.httpMethod, function() {
                localThis.log(
                    "Success stop adjusting moving %s",
                    (moveUp ? "up (to " + pos + ")" : "down (to " + pos + ")")
                );
            }.bind(localThis));
        }, parseInt(this.motionTime));
    }
    callback(null);
}

BlindsHTTPAccessory.prototype.httpRequest = function(url, methods, callback) {
    var options = Object.assign({url: url}, methods);
    request(options, function(err, response, body) {
        if (!err && response && this.successCodes.includes(response.statusCode)) {
            callback(null);
        } else {
            this.log(
                "Error sending request (HTTP status code %s): %s",
                (response ? response.statusCode : "not defined"),
                err
            );
            callback(err);
        }
    }.bind(this));
}

BlindsHTTPAccessory.prototype.getServices = function() {
    return [this.service];
}