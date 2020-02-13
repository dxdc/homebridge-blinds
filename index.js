'use strict';
const packageJSON = require('./package.json');

let request = require('requestretry');
let Service, Characteristic, HomebridgeAPI;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    HomebridgeAPI = homebridge;
    homebridge.registerAccessory(
        'homebridge-blinds',
        'BlindsHTTP',
        BlindsHTTPAccessory
    );
};

function BlindsHTTPAccessory(log, config) {
    // global vars
    this.log = log;
    if (!config) {
        this.log.info('No configuration found for homebridge-blinds');
        return;
    }

    // configuration vars
    this.name = config.name;
    this.upURL = config.up_url || false;
    this.downURL = config.down_url || false;
    this.positionURL = config.position_url || false;
    this.stopURL = config.stop_url || false;
    this.showStopButton = config.show_stop_button || false;
    this.showToggleButton = config.show_toggle_button || false;
    this.stopAtBoundaries = config.trigger_stop_at_boundaries || false;
    this.useSameUrlForStop = config.use_same_url_for_stop || false;
    this.httpMethod = config.http_method || { method: 'POST' };
    this.successCodes = config.success_codes || [200];
    this.maxHttpAttempts = parseInt(config.max_http_attempts, 10) || 5;
    this.retryDelay = parseInt(config.retry_delay, 10) || 2000;
    this.motionTime = parseInt(config.motion_time, 10) || 10000;
    this.responseLag = parseInt(config.response_lag, 10) || 0;
    this.verbose = config.verbose || false;

    this.cacheDirectory = HomebridgeAPI.user.persistPath();
    this.storage = require('node-persist');
    this.storage.initSync({
        dir: this.cacheDirectory,
        forgiveParseErrors: true
    });
    this.exactPosRegex = RegExp('%%POS%%', 'g');

    // state vars
    this.stopTimeout = null;
    this.lagTimeout = null;
    this.stepInterval = null;
    this.lastPosition = this.storage.getItemSync(this.name) || 0; // last known position of the blinds, down by default
    this.currentTargetPosition = this.lastPosition;

    // track last command for toggleService; assume known command if position is 0 or 100 otherwise null
    this.lastCommandMoveUp = (this.currentTargetPosition % 100 > 0) ? null : (this.currentTargetPosition === 100);

    if (this.positionURL) {
        this.getCurrentPosition(function() {
            this.currentTargetPosition = this.lastPosition;
            if (this.currentTargetPosition % 100 === 0) {
                this.lastCommandMoveUp = (this.currentTargetPosition === 100);
            }
        }.bind(this));
    }

    // register the service and provide the functions
    this.service = new Service.WindowCovering(this.name);

    // the current position (0-100)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts#L712
    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .on('get', this.getCurrentPosition.bind(this));

    // the target position (0-100)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts#L2781
    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));

    this.service
        .getCharacteristic(Characteristic.PositionState)
        .updateValue(Characteristic.PositionState.STOPPED);

    this.service
        .getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);
}

BlindsHTTPAccessory.prototype.getCurrentPosition = function(callback) {
    if (this.verbose) {
        this.log.info(`Requested CurrentPosition: ${this.lastPosition}%`);
    }

    if (this.positionURL) {
        this.setCurrentPositionByUrl(function(err) {
            if (err) {
                this.log.error(`setCurrentPositionByUrl failed; invalid response (should be 0-100): ${err}`);
            }
            return callback(null, this.lastPosition);
        }.bind(this));
    } else {
        return callback(null, this.lastPosition);
    }
};

BlindsHTTPAccessory.prototype.setCurrentPositionByUrl = function(callback) {
    this.httpRequest(this.positionURL, { method: 'GET' }, function(body, err) {
        if (err || !body) {
            return callback('(missing or error)');
        }

        try {
            // TODO: add more robust handling for JSON
            const json = JSON.parse(body);
            body = Object.values(json)[0];
        } catch (err) {
            // failed JSON parsing
        }

        const pos = parseInt(body, 10);
        if (pos < 0 || pos > 100) { // invalid
            return callback(pos);
        }

        this.lastPosition = pos;
        return callback(null);
    }.bind(this));
};

BlindsHTTPAccessory.prototype.getTargetPosition = function(callback) {
    if (this.verbose) {
        this.log.info(`Requested TargetPosition: ${this.currentTargetPosition}%`);
    }
    return callback(null, this.currentTargetPosition);
};

BlindsHTTPAccessory.prototype.setTargetPosition = function(pos, callback) {
    if (this.stopTimeout != null) clearTimeout(this.stopTimeout);
    if (this.stepInterval != null) clearInterval(this.stepInterval);
    if (this.lagTimeout != null) clearTimeout(this.lagTimeout);

    this.manualStop = false;
    this.currentTargetPosition = pos;
    if (this.currentTargetPosition == this.lastPosition) {
        if (this.currentTargetPosition % 100 > 0) {
            this.log.info(`Already there: ${this.currentTargetPosition}%`);
            return callback(null);
        } else {
            this.log.info(
                `Already there: ${this.currentTargetPosition}%, re-sending request`
            );
        }
    }

    const moveUp =
        this.currentTargetPosition > this.lastPosition ||
        this.currentTargetPosition == 100;
    const moveMessage = `Move ${moveUp ? 'up' : 'down'}`;
    this.log.info(`Requested ${moveMessage} (to ${this.currentTargetPosition}%)`);

    let self = this;

    const startTimestamp = Date.now();
    const moveUrl = moveUp ? this.upURL : this.downURL;
    const useExactPosition = this.exactPosRegex.test(moveUrl);

    if (this.useSameUrlForStop) {
        this.stopURL = moveUrl;
    }

    this.service
        .getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);

    this.service
        .getCharacteristic(Characteristic.PositionState)
        .updateValue(moveUp ? Characteristic.PositionState.INCREASING : Characteristic.PositionState.DECREASING);

    this.httpRequest(useExactPosition ? moveUrl.replace(this.exactPosRegex, this.currentTargetPosition) : moveUrl, this.httpMethod, function(body, err) {
        if (err) {
            this.service
                .getCharacteristic(Characteristic.PositionState)
                .updateValue(Characteristic.PositionState.STOPPED);

            this.service
                .getCharacteristic(Characteristic.ObstructionDetected).updateValue(true);

            return;
        }

        this.lastCommandMoveUp = moveUp;

        this.storage.setItemSync(this.name, this.currentTargetPosition);
        const motionTimeStep = this.motionTime / 100;
        const waitDelay = Math.abs(this.currentTargetPosition - this.lastPosition) * motionTimeStep;

        this.log.info(
            `Move request sent (${Date.now() - startTimestamp} ms), waiting ${Math.round(waitDelay / 100) / 10}s (+ ${Math.round(this.responseLag / 100) / 10}s response lag)...`
        );

        // Send stop command before target position is reached to account for response_lag
        if (useExactPosition) {
            if (this.verbose) {
                self.log.info('Stop command will be skipped; exact position specified');
            }
        } else if (this.stopAtBoundaries || this.currentTargetPosition % 100 > 0) {
            if (this.verbose) {
                self.log.info('Stop command will be requested');
            }
            this.stopTimeout = setTimeout(function() {
                self.sendStopRequest(null, true);
            }, Math.max(waitDelay, 0));
        }

        // Delay for response lag, then track movement of blinds
        this.lagTimeout = setTimeout(function() {
            if (self.verbose) {
                self.log.info('Timeout finished');
            }

            let targetReached = false;

            self.stepInterval = setInterval(function() {
                if (targetReached) {
                    return; // avoid duplicate calls
                }

                if (!self.manualStop) {
                    if (moveUp && self.lastPosition < self.currentTargetPosition) {
                        self.lastPosition += 1;
                        return;
                    } else if (!moveUp && self.lastPosition > self.currentTargetPosition) {
                        self.lastPosition += -1;
                        return;
                    }
                }

                // Reached target
                targetReached = true; // Block subsequent requests while processing

                if (self.positionURL) {
                    self.getCurrentPosition(function() {
                        if (self.manualStop || self.lastPosition == self.currentTargetPosition) {
                            self.endMoveRequest(moveMessage);
                        } else {
                            targetReached = false;
                        }
                    }.bind(self));
                } else {
                    self.endMoveRequest(moveMessage);
                }
            }, motionTimeStep);
        }, Math.max(this.responseLag, 0));
    }.bind(this));

    return callback(null);
};

BlindsHTTPAccessory.prototype.endMoveRequest = function(moveMessage) {
    clearInterval(this.stepInterval);

    this.log.info(
        `End ${moveMessage} to ${this.lastPosition}% (target ${this.currentTargetPosition}%)`
    );

    // In case of overshoot or manual stop
    this.currentTargetPosition = this.lastPosition;

    this.service
        .getCharacteristic(Characteristic.CurrentPosition)
        .updateValue(this.lastPosition);

    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .updateValue(this.currentTargetPosition);

    this.service
        .getCharacteristic(Characteristic.PositionState)
        .updateValue(Characteristic.PositionState.STOPPED);
};

BlindsHTTPAccessory.prototype.sendStopRequest = function(targetService, on, callback) {
    if (on) {
        if (targetService) {
            this.log.info('Requesting manual stop');
            if (this.stopTimeout != null) clearTimeout(this.stopTimeout);
        } else {
            this.log.info('Requesting stop');
        }

        this.service
            .getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);

        this.httpRequest(this.stopURL, this.httpMethod, function(body, err) {
            if (err) {
                this.log.warn('Stop request failed');
                
                this.service
                    .getCharacteristic(Characteristic.ObstructionDetected).updateValue(true);

            } else {
                if (targetService) {
                    this.manualStop = true;
                }
                this.log.info('Stop request sent');
            }
        }.bind(this));

        if (targetService) {
            setTimeout(function() {
                targetService.getCharacteristic(Characteristic.On).updateValue(false);
            }.bind(this), 1000);
        }
    }

    if (targetService) {
        return callback(null);
    }
};

BlindsHTTPAccessory.prototype.sendToggleRequest = function(targetService, on, callback) {
    if (on) {
        if (targetService) {
            this.log.info('Requesting toggle');
            if (this.lastCommandMoveUp !== null) {
                this.service
                    .setCharacteristic(Characteristic.TargetPosition, this.lastCommandMoveUp ? 0 : 100);
            } else {
                this.log.warn('No previously saved command, toggle skipped. Send an up / down request to establish state and enable toggle functionality.');
            }

            setTimeout(function() {
                targetService.getCharacteristic(Characteristic.On).updateValue(false);
            }.bind(this), 1000);
        }
    }

    if (targetService) {
        return callback(null);
    }
};

BlindsHTTPAccessory.prototype.httpRequest = function(url, methods, callback) {
    if (!url) {
        return callback(null, null);
    }

    const options = function() {
        if (typeof url.valueOf() === 'string') {
            // backward compatibility
            if (methods && typeof methods.valueOf() === 'string') {
                methods = { method: methods };
            }

            const urlRetries = {
                url: url,
                maxAttempts: (this.maxHttpAttempts > 1) ? this.maxHttpAttempts : 1,
                retryDelay: (this.retryDelay > 100) ? this.retryDelay : 100,
                retryStrategy: request.RetryStrategies.HTTPOrNetworkError
            };
            return Object.assign(urlRetries, methods);
        } else {
            return url;
        }
    }.bind(this);

    request(options(), function(err, response, body) {
        if (!err && response && this.successCodes.includes(response.statusCode)) {
            if (response.attempts > 1 || this.verbose) {
                this.log.info(
                    `Request succeeded after ${response.attempts} / ${this.maxHttpAttempts} attempt${this.maxHttpAttempts > 1 ? 's' : ''}`
                );
            }

            if (this.verbose) {
                this.log.info(`Body (${response ? response.statusCode : 'not defined'}): ${body}`);
            }

            return callback(body, null);
        } else {
            this.log.error(
                `Error sending request (HTTP status code ${response ? response.statusCode : 'not defined'}): ${err}`
            );
            this.log.error(`${response ? response.attempts : this.maxHttpAttempts} / ${this.maxHttpAttempts} attempt${this.maxHttpAttempts > 1 ? 's' : ''} failed`);
            this.log.error(`Body: ${body}`);

            return callback(body, err);
        }
    }.bind(this));
};

BlindsHTTPAccessory.prototype.getServices = function() {
    this.services = [];

    const informationService = new Service.AccessoryInformation();
    informationService
        .setCharacteristic(Characteristic.Manufacturer, 'homebridge-blinds')
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Model, this.name)
        .setCharacteristic(Characteristic.SerialNumber, 'BlindsHTTPAccessory')
        .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

    this.services.push(informationService);
    this.services.push(this.service);

    if (this.showStopButton && (this.stopURL || this.useSameUrlForStop)) {
        const stopService = new Service.Switch(this.name + ' Stop', 'stop');
        stopService
            .getCharacteristic(Characteristic.On)
            .on('set', this.sendStopRequest.bind(this, stopService));

        this.services.push(stopService);
    }

    if (this.showToggleButton) {
        const toggleService = new Service.Switch(this.name + ' Toggle', 'toggle');
        toggleService
            .getCharacteristic(Characteristic.On)
            .on('set', this.sendToggleRequest.bind(this, toggleService));

        this.services.push(toggleService);
    }

    return this.services;
};
