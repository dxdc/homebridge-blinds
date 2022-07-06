'use strict';
const CERT_DAYS = 365;
const CERT_VERSION = 2;
const MS_PER_SECOND = 1000;

const packageJSON = require('./package.json');

const request = require('requestretry');

const auth = require('http-auth');
const fs = require('fs');
const http = require('http');
const https = require('https');
const jsonata = require('jsonata');

const exec = require('child_process').exec;
const url = require('url');

let Service, Characteristic, UUIDGen, HomebridgeAPI;

module.exports = function (homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;
    HomebridgeAPI = homebridge;
    homebridge.registerAccessory('homebridge-blinds', 'BlindsHTTP', BlindsHTTPAccessory);
};

function BlindsHTTPAccessory(log, config) {
    // global vars
    this.log = log;
    if (!config) {
        this.log.info('No configuration found for homebridge-blinds');
        return;
    }

    // configuration and http vars
    this.name = config.name;
    this.upURL = config.up_url || false;
    if (typeof this.upURL === 'object' && !this.upURL.url) {
        this.log.info('No URL found for up_url');
        this.upURL = false;
    }

    this.downURL = config.down_url || false;
    if (typeof this.downURL === 'object' && !this.downURL.url) {
        this.log.info('No URL found for down_url');
        this.downURL = false;
    }

    this.positionURL = config.pos_url || config.position_url || false;
    this.positionJsonata = false;

    const positionJsonata = config.pos_jsonata || config.position_jsonata;
    if (positionJsonata) {
        try {
            this.positionJsonata = jsonata(positionJsonata);
        } catch (err) {
            this.log.error(`Error parsing positionJsonata: ${err.message}`);
        }
    }
    this.positionPollInterval = Math.max(
        parseInt(config.pos_poll_ms, 10) || parseInt(config.position_interval, 10) || 15000,
        5000,
    );
    this.stopURL = config.stop_url || false;
    if (typeof this.stopURL === 'object' && !this.stopURL.url) {
        this.log.info('No URL found for stop_url');
        this.stopURL = false;
    }

    this.mapSendJsonata = false;

    const mapSendJsonata = config.send_pos_jsonata || config.map_send_jsonata;
    if (mapSendJsonata) {
        try {
            this.mapSendJsonata = jsonata(mapSendJsonata);
        } catch (err) {
            this.log.error(`Error parsing mapSendJsonata: ${err.message}`);
        }
    }

    this.successCodes = config.http_success_codes || config.success_codes || [200];

    this.httpOptions = config.http_options || config.http_method || { method: 'POST' }; // deprecated
    this.maxHttpAttempts = parseInt(config.max_http_attempts, 10) || 5; // deprecated
    if (this.maxHttpAttempts < 1) {
        this.maxHttpAttempts = 1;
    }

    this.retryDelay = parseInt(config.retry_delay, 10) || 2000; // deprecated
    if (this.retryDelay < 100) {
        this.retryDelay = 100;
    }

    // webhook vars
    this.webhookPort = parseInt(config.webhook_port, 10) || 0;
    this.httpAuthUser = config.webhook_http_auth_user || false;
    this.httpAuthPass = config.webhook_http_auth_pass || false;
    this.https = config.webhook_https === true;
    this.httpsKeyFile = config.webhook_https_keyfile || false;
    this.httpsCertFile = config.webhook_https_certfile || false;

    // expose additional button vars
    this.showStopButton = config.show_stop_button === true;
    this.showToggleButton = config.show_toggle_button === true;

    // motion time vars
    const motionTimeConfig = parseInt(config.motion_time, 10) || 10000;
    const motionUpTime = parseInt(config.motion_up_time, 10) || motionTimeConfig; // deprecated
    const motionDownTime = parseInt(config.motion_down_time, 10) || motionTimeConfig; // deprecated

    let motionTimeGraph = config.motion_time_graph;
    this.motionTimeGraph = motionTimeGraph || {
        up: [
            { pos: 0, seconds: 0 },
            { pos: 100, seconds: motionUpTime / MS_PER_SECOND },
        ],
        down: [
            { pos: 100, seconds: 0 },
            { pos: 0, seconds: motionDownTime / MS_PER_SECOND },
        ],
    };

    for (const direction of ['up', 'down']) {
        let graph = this.motionTimeGraph[direction];

        if (!graph) {
            this.log.error(`Motion '${direction}' graph is undefined!`);
            continue;
        }

        // sort by position
        graph.sort((a, b) => a.pos - b.pos);

        // remove invalid positions
        graph = graph.filter((step) => {
            if (step.pos < 0 || step.pos > 100) {
                this.log.error(
                    `Motion '${direction}' step was skipped (invalid: pos must be between 0-100): ${JSON.stringify(
                        step,
                    )}`,
                );
                return false;
            }

            return true;
        });

        if (graph.length === 0) {
            this.log.error(`Motion '${direction}' graph has no steps!`);
            continue;
        }

        if (graph[0].pos !== 0 || graph[graph.length - 1].pos !== 100) {
            const availablePos = graph.map((step) => step.pos);
            this.log.error(
                `Motion '${direction}' graph is missing definitions for positions 0 and/or 100: (found: ${availablePos})`,
            );
            continue;
        }

        // calculate motionTimeStep
        for (let i = 1; i < graph.length; i++) {
            const prevStep = graph[i - 1];
            const thisStep = graph[i];

            const deltaSeconds = Math.abs(thisStep.seconds - prevStep.seconds);
            const deltaPos = thisStep.pos - prevStep.pos;
            if (deltaSeconds > 0 && deltaPos > 0) {
                thisStep.motionTimeStep = deltaSeconds / deltaPos;
            } else {
                this.log.error(
                    `Motion '${direction}' step was skipped, ${deltaSeconds} seconds from previous step, +${deltaPos} position from previous step: ${JSON.stringify(
                        thisStep,
                    )}`,
                );
            }
        }
    }

    this.responseLag = parseInt(config.response_lag_ms, 10) || parseInt(config.response_lag, 10) || 0;

    const renamedVars = {
        map_send_jsonata: 'send_pos_jsonata',
        position_interval: 'pos_poll_ms',
        position_jsonata: 'pos_jsonata',
        position_url: 'pos_url',
        response_lag: 'response_lag_ms',
        success_codes: 'http_success_codes',
    };

    for (const key of Object.keys(renamedVars)) {
        if (config[key]) {
            this.log.error(
                `Config parameter '${key}' has been renamed to ${renamedVars[key]}; please update your settings`,
            );
        }
    }

    const deprecatedVars = {
        up_url: this.upURL && typeof this.upURL !== 'object',
        down_url: this.downURL && typeof this.downURL !== 'object',
        stop_url: this.stopURL && typeof this.stopURL !== 'object',
        http_method: config.http_method,
        http_options: config.http_options,
        max_http_attempts: config.max_http_attempts,
        motion_down_time: config.motion_down_time,
        motion_up_time: config.motion_up_time,
        retry_delay: config.retry_delay,
    };

    for (const key of Object.keys(deprecatedVars)) {
        if (deprecatedVars[key]) {
            this.log.error(
                `Config parameter '${key}' is deprecated; please migrate to the current format (see documentation)`,
            );
        }
    }

    // advanced vars
    this.uniqueSerial = config.unique_serial === true;
    this.stopAtBoundaries = config.trigger_stop_at_boundaries === true;
    this.useSameUrlForStop = config.use_same_url_for_stop === true;
    this.verbose = config.verbose === true;

    this.cacheDirectory = HomebridgeAPI.user.persistPath();
    this.storage = require('node-persist');
    this.storage.initSync({
        dir: this.cacheDirectory,
        forgiveParseErrors: true,
    });

    // state vars
    this.stopTimeout = null;
    this.lagTimeout = null;
    this.stepInterval = null;
    this.lastPosition = this.storage.getItemSync(this.name) || 0; // last known position of the blinds, down by default
    this.currentTargetPosition = this.lastPosition;

    // track last command for toggleService; assume known command if position is 0 or 100 otherwise null
    this.lastCommandMoveUp = this.currentTargetPosition % 100 > 0 ? null : this.currentTargetPosition === 100;

    if (this.positionURL) {
        this.updatePositionByUrl();

        this.pollInterval = setInterval(
            function () {
                this.updatePositionByUrl();
            }.bind(this),
            this.positionPollInterval,
        );
    }

    // register the service and provide the functions
    this.service = new Service.WindowCovering(this.name);

    // the current position (0-100)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts#L712
    this.service.getCharacteristic(Characteristic.CurrentPosition).on('get', this.getCurrentPosition.bind(this));

    // the target position (0-100)
    // https://github.com/KhaosT/HAP-NodeJS/blob/master/src/lib/gen/HomeKit.ts#L2781
    this.service
        .getCharacteristic(Characteristic.TargetPosition)
        .on('get', this.getTargetPosition.bind(this))
        .on('set', this.setTargetPosition.bind(this));

    this.service.getCharacteristic(Characteristic.PositionState).updateValue(Characteristic.PositionState.STOPPED);

    this.service.getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);

    if (this.webhookPort > 0) {
        this.configureWebhook();
    }
}

BlindsHTTPAccessory.prototype.configureWebhook = function () {
    // Configure basic authentication
    let basicAuth = false;
    if (this.httpAuthUser && this.httpAuthPass) {
        basicAuth = auth.basic(
            {
                realm: 'Authorization required',
            },
            function (username, password, callback) {
                callback(username === this.httpAuthUser && password === this.httpAuthPass);
            }.bind(this),
        );
    }

    // Webhook callback
    let createServerCallback = function (request, response) {
        const q = url.parse(request.url, true);
        let body = [];

        request
            .on(
                'error',
                function (err) {
                    this.log.error(`Error: ${err}`);
                }.bind(this),
            )
            .on('data', function (chunk) {
                body.push(chunk);
            })
            .on(
                'end',
                function () {
                    body = Buffer.concat(body).toString();

                    response.on('error', function (err) {
                        this.log.error(`Error: ${err}`);
                    });

                    response.setHeader('Content-Type', 'application/json');
                    const pos = q.query.pos ? parseInt(q.query.pos, 10) : NaN;

                    if (isNaN(pos) || pos < 0 || pos > 100) {
                        this.log.error('Invalid position specified in request.');
                        response.statusCode = 404;
                        response.write(JSON.stringify({ success: false }));
                        response.end();
                        return;
                    }

                    if (this.stepInterval === null) {
                        // still moving
                        if (this.stopTimeout !== null) {
                            clearTimeout(this.stopTimeout);
                            this.stopTimeout = null;
                        }
                        if (this.lagTimeout !== null) {
                            clearTimeout(this.lagTimeout);
                            this.lagTimeout = null;
                        }

                        this.currentTargetPosition = pos;
                        this.service
                            .getCharacteristic(Characteristic.TargetPosition)
                            .updateValue(this.currentTargetPosition);

                        this.log.info(`Current target updated by webhook: ${pos}`);
                    }

                    this.lastPosition = pos;
                    this.service.getCharacteristic(Characteristic.CurrentPosition).updateValue(this.lastPosition);
                    this.log.info(`Current position updated by webhook: ${pos}`);

                    response.statusCode = 200;
                    response.write(JSON.stringify({ success: true }));
                    response.end();
                }.bind(this),
            );
    }.bind(this);

    // SSL
    let sslServerOptions = {};
    if (this.https) {
        if (!this.httpsKeyFile || !this.httpsCertFile) {
            this.log('Using automatically generated self-signed SSL certificate');
            let cachedSSLCert = this.storage.getItemSync('homebridge-blinds-webhook-ssl-cert');
            if (cachedSSLCert) {
                const certVersion = cachedSSLCert.certVersion;
                const timestamp = Date.now() - cachedSSLCert.timestamp;
                const diffInDays = timestamp / 1000 / 60 / 60 / 24;
                if (diffInDays > CERT_DAYS - 1 || certVersion !== CERT_VERSION) {
                    cachedSSLCert = null;
                }
            }
            if (!cachedSSLCert) {
                this.log('Generating new SSL self-signed certificate');
                let selfsigned = require('selfsigned');
                const certAttrs = [
                    {
                        name: 'commonName',
                        value: 'localhost',
                    },
                ];
                var certOpts = {
                    days: CERT_DAYS,
                };

                const pems = selfsigned.generate(certAttrs, certOpts);
                cachedSSLCert = pems;
                cachedSSLCert.timestamp = Date.now();
                cachedSSLCert.certVersion = CERT_VERSION;
                this.storage.setItemSync('homebridge-blinds-webhook-ssl-cert', cachedSSLCert);
            }

            sslServerOptions = {
                key: cachedSSLCert.private,
                cert: cachedSSLCert.cert,
            };
        } else {
            this.log(`Using SSL certificate from ${this.httpsKeyFile}`);
            sslServerOptions = {
                key: fs.readFileSync(this.httpsKeyFile),
                cert: fs.readFileSync(this.httpsCertFile),
            };
        }

        if (basicAuth) {
            https.createServer(basicAuth, sslServerOptions, createServerCallback).listen(this.webhookPort, '0.0.0.0');
        } else {
            https.createServer(sslServerOptions, createServerCallback).listen(this.webhookPort, '0.0.0.0');
        }

        this.log.info(`Started HTTPS server for webhook on port ${this.webhookPort}`);
        return;
    }

    if (basicAuth) {
        http.createServer(basicAuth, createServerCallback).listen(this.webhookPort, '0.0.0.0');
    } else {
        http.createServer(createServerCallback).listen(this.webhookPort, '0.0.0.0');
    }

    this.log.info(`Started HTTP server for webhook on port ${this.webhookPort}`);
};

BlindsHTTPAccessory.prototype.getCurrentPosition = function (callback) {
    if (this.positionURL) {
        this.setCurrentPositionByUrl(
            function (err) {
                if (err) {
                    this.log.error(`setCurrentPositionByUrl failed; invalid response (should be 0-100): ${err}`);
                }
                return callback(null, this.lastPosition);
            }.bind(this),
        );
    } else {
        if (this.verbose) {
            this.log.info(`Requested CurrentPosition: ${this.lastPosition}%`);
        }
        return callback(null, this.lastPosition);
    }
};

BlindsHTTPAccessory.prototype.setCurrentPositionByUrl = function (callback) {
    this.httpRequest(
        this.positionURL,
        { method: 'GET' },
        function (body, requestTime, err) {
            if (err || !body) {
                return callback('(missing or error)');
            }

            try {
                const json = JSON.parse(body);
                if (this.positionJsonata) {
                    body = this.positionJsonata.evaluate(json);
                } else if (typeof json === 'object') {
                    body = Object.values(json).filter(function (val) {
                        return !isNaN(val);
                    })[0];
                }
            } catch (err) {
                if (this.verbose) {
                    this.log.error(`Error parsing JSON: ${err.message}`);
                }
            }

            const pos = parseInt(body, 10);
            if (isNaN(pos) || pos < 0 || pos > 100) {
                return callback(pos); // invalid response
            }

            this.lastPosition = pos;
            if (this.verbose) {
                this.log.info(`Requested setCurrentPositionByUrl: ${this.lastPosition}`);
            }
            return callback(null);
        }.bind(this),
    );
};

BlindsHTTPAccessory.prototype.updatePositionByUrl = function () {
    if (this.stopTimeout !== null || this.stepInterval !== null || this.lagTimeout !== null) {
        if (this.verbose) {
            this.log.info(
                `Polling skipped (updatePositionByUrl); stopTimeout: ${this.stopTimeout}, stepInterval: ${this.stepInterval}, lagTimeout: ${this.lagTimeout}`,
            );
        }
        return; // blinds in motion by plugin
    }

    if (this.verbose) {
        this.log.info('Polling started (updatePositionByUrl)');
    }

    this.getCurrentPosition(
        function () {
            this.currentTargetPosition = this.lastPosition;
            if (this.currentTargetPosition % 100 === 0) {
                this.lastCommandMoveUp = this.currentTargetPosition === 100;
            }
            if (this.verbose) {
                this.log.info('Polling finished (updatePositionByUrl)');
            }
        }.bind(this),
    );
};

BlindsHTTPAccessory.prototype.getTargetPosition = function (callback) {
    if (this.verbose) {
        this.log.info(`Requested TargetPosition: ${this.currentTargetPosition}%`);
    }
    return callback(null, this.currentTargetPosition);
};

BlindsHTTPAccessory.prototype.replaceUrlPosition = function (url, pos) {
    const exp = RegExp('%%POS%%|"%%POSINT%%"', 'g');

    if (this.mapSendJsonata) {
        pos = this.mapSendJsonata.evaluate(pos);
    }

    if (typeof url.valueOf() === 'string') {
        return exp.test(url) ? url.replace(exp, pos) : false;
    }

    if (!Object.prototype.hasOwnProperty.call(url, 'url') || typeof url.url.valueOf() !== 'string') {
        this.log.error(`Missing url property or non-string property for: ${url}`);
        return false;
    }

    let shallowObj = Object.assign({}, url);
    const exactPosUrl = exp.test(shallowObj.url);
    if (exactPosUrl) {
        shallowObj.url = shallowObj.url.replace(exp, pos);
    }

    let exactPosBody = false;
    if (shallowObj.body) {
        if (typeof shallowObj.body === 'string') {
            exactPosBody = exp.test(shallowObj.body);
            if (exactPosBody) {
                shallowObj.body = shallowObj.body.replace(exp, pos);
            }
        } else {
            const body = JSON.stringify(shallowObj.body);
            exactPosBody = exp.test(body);
            if (exactPosBody) {
                shallowObj.body = JSON.parse(body.replace(exp, pos));
            }
        }
    }

    return exactPosUrl || exactPosBody ? shallowObj : false;
};

BlindsHTTPAccessory.prototype.setTargetPosition = function (pos, callback) {
    clearTimeout(this.stopTimeout);
    this.stopTimeout = null;

    clearInterval(this.stepInterval);
    this.stepInterval = null;

    clearTimeout(this.lagTimeout);
    this.lagTimeout = null;

    this.manualStop = false;
    this.currentTargetPosition = pos;
    if (this.currentTargetPosition == this.lastPosition) {
        if (this.currentTargetPosition % 100 > 0) {
            this.log.info(`Already there: ${this.currentTargetPosition}%`);
            return callback(null);
        } else {
            this.log.info(`Already there: ${this.currentTargetPosition}%, re-sending request`);
        }
    }

    const moveUp = this.currentTargetPosition > this.lastPosition || this.currentTargetPosition == 100;
    const moveMessage = `Move ${moveUp ? 'up' : 'down'}`;
    this.log.info(`Requested ${moveMessage} (to ${this.currentTargetPosition}%)`);

    let self = this;

    const moveUrl = moveUp ? this.upURL : this.downURL;
    const exactPositionUrl = this.replaceUrlPosition(moveUrl, this.currentTargetPosition);

    if (this.useSameUrlForStop) {
        this.stopURL = moveUrl;
    }

    this.service.getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);

    this.service
        .getCharacteristic(Characteristic.PositionState)
        .updateValue(moveUp ? Characteristic.PositionState.INCREASING : Characteristic.PositionState.DECREASING);

    this.httpRequest(
        exactPositionUrl || moveUrl,
        this.httpOptions,
        function (body, requestTime, err) {
            if (err) {
                this.service
                    .getCharacteristic(Characteristic.PositionState)
                    .updateValue(Characteristic.PositionState.STOPPED);

                this.service.getCharacteristic(Characteristic.ObstructionDetected).updateValue(true);

                return;
            }

            this.lastCommandMoveUp = moveUp;
            this.storage.setItemSync(this.name, this.currentTargetPosition);

            const calcMotionTime = (startPos, endPos, moveUp) => {
                if (startPos === endPos) {
                    if (this.verbose) {
                        this.log.info(`Nothing to do: ${startPos} is equal to ${endPos}`);
                    }
                    return 0;
                }

                // for simplicity:
                // standardize the calculation in a single direction
                const blind = {
                    steps: moveUp ? this.motionTimeGraph.up : this.motionTimeGraph.down,
                    current: moveUp ? startPos : endPos,
                    target: moveUp ? endPos : startPos,
                };

                // iterate through each time step and compute sum
                const motionTime = blind.steps
                    .map((step) => {
                        if (!step.motionTimeStep || blind.current === blind.target || step.pos <= blind.current) {
                            return 0;
                        }

                        const stepTarget = Math.min(step.pos, blind.target);
                        const stepTime = (stepTarget - blind.current) * step.motionTimeStep * MS_PER_SECOND;
                        // this.log.debug(`Step time between ${blind.current} and ${stepTarget}: ${stepTime} ms`);

                        blind.current = stepTarget;
                        return stepTime;
                    })
                    .reduce((partialSum, a) => partialSum + a, 0);

                if (this.verbose) {
                    this.log.info(`Calculated time to move from ${startPos} to ${endPos}: ${motionTime} ms`);
                }

                return motionTime;
            };

            const waitDelay = calcMotionTime(this.lastPosition, this.currentTargetPosition, moveUp);
            const motionTimeStep = waitDelay / Math.abs(this.currentTargetPosition - this.lastPosition); // averaged over the total amount
            this.log.info(
                `Move request sent (${requestTime} ms), waiting ${Math.round(waitDelay / 100) / 10}s (+ ${
                    Math.round(this.responseLag / 100) / 10
                }s response lag)...`,
            );

            // Send stop command before target position is reached to account for response_lag
            if (exactPositionUrl !== false) {
                if (this.verbose) {
                    self.log.info('Stop command will be skipped; exact position specified');
                }
            } else if (this.stopAtBoundaries || this.currentTargetPosition % 100 > 0) {
                if (this.verbose) {
                    self.log.info('Stop command will be requested');
                }
                this.stopTimeout = setTimeout(function () {
                    self.sendStopRequest(null, true);
                }, Math.max(waitDelay, 0));
            }

            // Delay for response lag, then track movement of blinds
            this.lagTimeout = setTimeout(function () {
                if (self.verbose) {
                    self.log.info('Timeout finished');
                }

                let targetReached = false;
                let positionRetries = 0;

                let intervalsToSkip = 0;
                let lastIntervalPosition = -1;

                self.stepInterval = setInterval(function () {
                    if (targetReached) {
                        if (intervalsToSkip > 1) {
                            --intervalsToSkip;
                        } else if (intervalsToSkip === 1) {
                            intervalsToSkip = 0;
                            targetReached = false;
                        }

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
                        self.getCurrentPosition(
                            function () {
                                if (self.manualStop || self.lastPosition === self.currentTargetPosition) {
                                    if (self.verbose) {
                                        self.log.info(
                                            `Reached target: ${self.currentTargetPosition}, currentPosition: ${
                                                self.lastPosition
                                            }, manualStop: ${self.manualStop ? 'Y' : 'N'}`,
                                        );
                                    }
                                    self.endMoveRequest(moveMessage);
                                } else {
                                    ++positionRetries;
                                    if (positionRetries > 10) {
                                        self.log.error(`Didn't reach target after ${positionRetries} tries`);
                                        self.manualStop = true;
                                    } else if (self.lastPosition === lastIntervalPosition) {
                                        if (self.verbose) {
                                            self.log.info(
                                                `Blinds position didn't change: skipping ${positionRetries} cycle${
                                                    positionRetries > 1 ? 's' : ''
                                                }`,
                                            );
                                        }
                                        intervalsToSkip = positionRetries;
                                        return;
                                    }

                                    lastIntervalPosition = self.lastPosition;
                                    targetReached = false;
                                }
                            }.bind(self),
                        );
                    } else {
                        self.endMoveRequest(moveMessage);
                    }
                }, motionTimeStep);
            }, Math.max(this.responseLag, 0));
        }.bind(this),
    );

    return callback(null);
};

BlindsHTTPAccessory.prototype.endMoveRequest = function (moveMessage) {
    clearInterval(this.stepInterval);
    this.stepInterval = null;
    clearTimeout(this.lagTimeout);
    this.lagTimeout = null;

    this.log.info(`End ${moveMessage} to ${this.lastPosition}% (target ${this.currentTargetPosition}%)`);

    // In case of overshoot or manual stop
    this.currentTargetPosition = this.lastPosition;

    this.service.getCharacteristic(Characteristic.CurrentPosition).updateValue(this.lastPosition);

    this.service.getCharacteristic(Characteristic.TargetPosition).updateValue(this.currentTargetPosition);

    this.service.getCharacteristic(Characteristic.PositionState).updateValue(Characteristic.PositionState.STOPPED);
};

BlindsHTTPAccessory.prototype.sendStopRequest = function (targetService, on, callback) {
    if (on) {
        clearTimeout(this.stopTimeout);
        this.stopTimeout = null;

        if (targetService) {
            this.log.info('Requesting manual stop');
        } else {
            this.log.info('Requesting stop');
        }

        this.service.getCharacteristic(Characteristic.ObstructionDetected).updateValue(false);

        this.httpRequest(
            this.stopURL,
            this.httpOptions,
            function (body, requestTime, err) {
                if (err) {
                    this.log.warn('Stop request failed');

                    this.service.getCharacteristic(Characteristic.ObstructionDetected).updateValue(true);
                } else {
                    if (targetService) {
                        this.manualStop = true;
                    }
                    this.log.info('Stop request sent');
                }
            }.bind(this),
        );

        if (targetService) {
            setTimeout(
                function () {
                    targetService.getCharacteristic(Characteristic.On).updateValue(false);
                }.bind(this),
                1000,
            );
        }
    }

    if (targetService) {
        return callback(null);
    }
};

BlindsHTTPAccessory.prototype.sendToggleRequest = function (targetService, on, callback) {
    if (on) {
        if (targetService) {
            this.log.info('Requesting toggle');
            if (this.lastCommandMoveUp !== null) {
                this.service.setCharacteristic(Characteristic.TargetPosition, this.lastCommandMoveUp ? 0 : 100);
            } else {
                this.log.warn(
                    'No previously saved command, toggle skipped. Send an up / down request to establish state and enable toggle functionality.',
                );
            }

            setTimeout(
                function () {
                    targetService.getCharacteristic(Characteristic.On).updateValue(false);
                }.bind(this),
                1000,
            );
        }
    }

    if (targetService) {
        return callback(null);
    }
};

BlindsHTTPAccessory.prototype.httpRequest = function (url, methods, callback) {
    if (!url) {
        return callback(null, null);
    }

    const options = function () {
        const retryStrategy = {
            maxAttempts: 5,
            retryDelay: this.retryDelay,
            retryStrategy: request.RetryStrategies.HTTPOrNetworkError,
        };

        if (typeof url.valueOf() === 'string') {
            if (methods && typeof methods.valueOf() === 'string') {
                methods = { method: methods }; // backward compatibility
            }

            const urlRetries = {
                url: url,
            };
            return Object.assign(urlRetries, retryStrategy, methods);
        } else {
            return Object.assign(retryStrategy, url);
        }
    }.bind(this);

    const startTimestamp = Date.now();
    const cmdMatch = options().url.match(/(?:file:\/\/)(.*)/i);

    // handling for file
    if (cmdMatch !== null) {
        exec(
            cmdMatch[1],
            function (err, stdout, stderr) {
                const requestTime = Date.now() - startTimestamp;

                if (!err) {
                    if (this.verbose) {
                        this.log.info(`Command succeeded in ${requestTime} ms`);
                    }

                    if (this.verbose) {
                        this.log.info(`Stdout: ${stdout}`);
                        if (stderr) {
                            this.log.info(`Stderr: ${stderr}`);
                        }
                    }

                    return callback(stdout, requestTime, null);
                } else {
                    this.log.error(`Error running command: ${stderr}`);
                    this.log.info(`Stdout: ${stdout}`);

                    return callback(stdout, requestTime, err);
                }
            }.bind(this),
        );

        return;
    }

    // handling for http
    request(
        options(),
        function (err, response, body) {
            const requestTime = Date.now() - startTimestamp;

            if (response && response.timingPhases) {
                // use `time: true` as request option for profiling
                this.log.info(`Request profiling: ${JSON.stringify(response.timingPhases)}`);
            }

            if (!err && response && this.successCodes.includes(response.statusCode)) {
                if (response.attempts > 1 || this.verbose) {
                    this.log.info(
                        `Request succeeded in ${requestTime} ms after ${response.attempts} / ${
                            this.maxHttpAttempts
                        } attempt${this.maxHttpAttempts > 1 ? 's' : ''}`,
                    );
                }

                if (this.verbose) {
                    this.log.info(`Body (${response ? response.statusCode : 'not defined'}): ${body}`);
                }

                return callback(body, requestTime, null);
            } else {
                this.log.error(
                    `Error sending request (HTTP status code ${
                        response ? response.statusCode : 'not defined'
                    }): ${err}`,
                );
                this.log.error(
                    `${response ? response.attempts : this.maxHttpAttempts} / ${this.maxHttpAttempts} attempt${
                        this.maxHttpAttempts > 1 ? 's' : ''
                    } failed after ${requestTime} ms`,
                );
                this.log.error(`Body: ${body}`);

                return callback(body, requestTime, err);
            }
        }.bind(this),
    );
};

BlindsHTTPAccessory.prototype.getServices = function () {
    this.services = [];

    let customName = '';
    let customSerial = '';

    if (this.uniqueSerial) {
        customName = 'BlindsHTTPAccessory-';
        customSerial = '-' + UUIDGen.generate(this.name);
    }

    const informationService = new Service.AccessoryInformation();
    informationService
        .setCharacteristic(Characteristic.Manufacturer, 'homebridge-blinds')
        .setCharacteristic(Characteristic.Name, this.name)
        .setCharacteristic(Characteristic.Model, customName + this.name)
        .setCharacteristic(Characteristic.SerialNumber, 'BlindsHTTPAccessory' + customSerial)
        .setCharacteristic(Characteristic.FirmwareRevision, packageJSON.version);

    this.services.push(informationService);
    this.services.push(this.service);

    if (this.showStopButton && (this.stopURL || this.useSameUrlForStop)) {
        const stopService = new Service.Switch(this.name + ' Stop', 'stop');
        stopService.getCharacteristic(Characteristic.On).on('set', this.sendStopRequest.bind(this, stopService));

        this.services.push(stopService);
    }

    if (this.showToggleButton) {
        const toggleService = new Service.Switch(this.name + ' Toggle', 'toggle');
        toggleService.getCharacteristic(Characteristic.On).on('set', this.sendToggleRequest.bind(this, toggleService));

        this.services.push(toggleService);
    }

    return this.services;
};
