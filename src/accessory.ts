import type {
    API,
    AccessoryConfig,
    AccessoryPlugin,
    CharacteristicValue,
    Logger as HbLogger,
    Service,
} from 'homebridge';

import { normalizeConfig } from './config';
import { HttpClient, HttpRequestError } from './http-client';
import { calculateMotionTime } from './motion-graph';
import { applyPositionTemplate } from './url-template';
import { JsonataExpression } from './jsonata-helper';
import { startWebhookServer } from './webhook-server';
import { Storage } from './storage';
import type { BlindsConfig, HttpEndpoint, Logger } from './types';

const POSITION_RETRY_LIMIT = 10;
const TOGGLE_RESET_DELAY_MS = 1000;

/**
 * Direction of a move command. Stored alongside the last issued command so
 * the toggle button knows which way to flip.
 */
type MoveDirection = 'up' | 'down';

/**
 * Main HomeKit accessory implementation. Encapsulates state for a single
 * blind and translates HomeKit `TargetPosition`/`CurrentPosition` events into
 * HTTP requests against the user-supplied endpoints.
 */
export class BlindsAccessory implements AccessoryPlugin {
    private readonly config: BlindsConfig;
    private readonly httpClient: HttpClient;
    private readonly storage: Storage;
    private readonly Service: typeof Service;
    private readonly Characteristic: API['hap']['Characteristic'];
    private readonly UUIDGen: API['hap']['uuid'];

    private readonly windowCovering: Service;
    private readonly informationService: Service;
    private readonly extraServices: Service[] = [];

    /** Last position reported to HomeKit (0-100, in HomeKit semantics). */
    private lastPosition: number;
    /** Target position currently in flight (0-100, in HomeKit semantics). */
    private currentTargetPosition: number;
    /** Direction of the last move; `null` until inferable from state. */
    private lastCommandMoveUp: boolean | null;
    /** Set by a manual stop so the step interval terminates motion early. */
    private manualStop = false;

    private stopTimeout: NodeJS.Timeout | null = null;
    private lagTimeout: NodeJS.Timeout | null = null;
    private stepInterval: NodeJS.Timeout | null = null;
    private pollInterval: NodeJS.Timeout | null = null;
    private batteryPollInterval: NodeJS.Timeout | null = null;

    /** Pending debounced TargetPosition request; only the most recent wins. */
    private debounceTimer: NodeJS.Timeout | null = null;
    private pendingTargetValue: CharacteristicValue | undefined;

    /** Cached battery service; created on demand when battery_url is set. */
    private batteryService: Service | null = null;
    private batteryJsonataExpr: JsonataExpression | null = null;

    private readonly positionJsonata: JsonataExpression | null;
    private readonly sendPositionJsonata: JsonataExpression | null;

    /** Reset on success; trips `ObstructionDetected` once it hits `obstructionThreshold`. */
    private consecutiveFailures = 0;

    constructor(
        private readonly log: HbLogger,
        rawConfig: AccessoryConfig,
        api: API,
    ) {
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;
        this.UUIDGen = api.hap.uuid;

        const logger: Logger = {
            info: (msg, ...rest) => this.log.info(msg, ...rest),
            warn: (msg, ...rest) => this.log.warn(msg, ...rest),
            error: (msg, ...rest) => this.log.error(msg, ...rest),
            debug: (msg, ...rest) => this.log.debug(msg, ...rest),
            log: (msg, ...rest) => this.log.info(msg, ...rest),
        };

        this.config = normalizeConfig(rawConfig as unknown as Record<string, unknown>, logger);

        this.httpClient = new HttpClient(
            {
                timeout: this.config.requestTimeout,
                maxAttempts: this.config.maxHttpAttempts,
                retryDelay: this.config.retryDelay,
                successCodes: this.config.successCodes,
            },
            logger,
            this.config.verbose,
        );

        this.positionJsonata = JsonataExpression.compile(this.config.positionJsonata, 'positionJsonata', logger);
        this.sendPositionJsonata = JsonataExpression.compile(this.config.sendPositionJsonata, 'mapSendJsonata', logger);

        this.storage = new Storage(api.user.persistPath());

        const persisted = this.storage.getItemSync<number>(this.config.name);
        this.lastPosition = typeof persisted === 'number' ? persisted : 0;
        this.currentTargetPosition = this.lastPosition;
        this.lastCommandMoveUp = this.currentTargetPosition % 100 > 0 ? null : this.currentTargetPosition === 100;

        this.windowCovering = this.buildWindowCoveringService();

        this.informationService = new this.Service.AccessoryInformation()
            .setCharacteristic(this.Characteristic.Manufacturer, 'homebridge-blinds')
            .setCharacteristic(this.Characteristic.Name, this.config.name)
            .setCharacteristic(
                this.Characteristic.Model,
                this.config.uniqueSerial ? `BlindsHTTPAccessory-${this.config.name}` : this.config.name,
            )
            .setCharacteristic(
                this.Characteristic.SerialNumber,
                this.config.uniqueSerial
                    ? `BlindsHTTPAccessory-${this.UUIDGen.generate(this.config.name)}`
                    : 'BlindsHTTPAccessory',
            )
            .setCharacteristic(this.Characteristic.FirmwareRevision, getPackageVersion());

        this.buildExtraServices();

        if (this.config.positionUrl) {
            // Defer the first poll to the next tick so construction finishes first.
            setImmediate(() => this.pollPosition());
            this.pollInterval = setInterval(() => this.pollPosition(), this.config.positionPollInterval);
            this.pollInterval.unref?.();
        }

        if (this.config.batteryUrl) {
            this.buildBatteryService(logger);
            setImmediate(() => this.pollBattery());
            this.batteryPollInterval = setInterval(() => this.pollBattery(), this.config.batteryPollInterval);
            this.batteryPollInterval.unref?.();
        }

        if (this.config.webhookPort > 0) {
            startWebhookServer({
                port: this.config.webhookPort,
                https: this.config.webhookHttps,
                httpsKeyFile: this.config.webhookHttpsKeyFile,
                httpsCertFile: this.config.webhookHttpsCertFile,
                authUser: this.config.webhookHttpAuthUser,
                authPass: this.config.webhookHttpAuthPass,
                storage: this.storage,
                log: logger,
                onPosition: (pos) => this.handleWebhookPosition(pos),
                onTarget: (target) => this.handleWebhookTarget(target),
            });
        }
    }

    getServices(): Service[] {
        const services = [this.informationService, this.windowCovering, ...this.extraServices];
        if (this.batteryService) services.push(this.batteryService);
        return services;
    }

    // --- HomeKit characteristic handlers ----------------------------------

    /**
     * Return the cached `lastPosition` synchronously. Blocking on the
     * network here would freeze Homebridge when the device is unreachable.
     * Polling runs independently in the background.
     */
    private handleCurrentPositionGet(): CharacteristicValue {
        if (this.config.verbose) {
            this.log.info(`Requested CurrentPosition: ${this.toHomeKit(this.lastPosition)}%`);
        }
        return this.toHomeKit(this.lastPosition);
    }

    private handleTargetPositionGet(): CharacteristicValue {
        if (this.config.verbose) {
            this.log.info(`Requested TargetPosition: ${this.toHomeKit(this.currentTargetPosition)}%`);
        }
        return this.toHomeKit(this.currentTargetPosition);
    }

    /** Coalesces slider-drag bursts into one move when `set_debounce_ms > 0`. */
    private async handleTargetPositionSet(value: CharacteristicValue): Promise<void> {
        if (this.config.setDebounceMs <= 0) {
            return this.executeTargetPositionSet(value);
        }
        // Coalesce: only the most recent value will be applied when the
        // quiet period elapses.
        this.pendingTargetValue = value;
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            const pending = this.pendingTargetValue;
            this.pendingTargetValue = undefined;
            if (pending !== undefined) {
                void this.executeTargetPositionSet(pending);
            }
        }, this.config.setDebounceMs);
        this.debounceTimer.unref?.();
    }

    private async executeTargetPositionSet(value: CharacteristicValue): Promise<void> {
        const homeKitTarget = Number(value);
        const target = this.fromHomeKit(homeKitTarget);

        this.clearMotionTimers();
        this.manualStop = false;
        this.currentTargetPosition = target;

        if (target === this.lastPosition) {
            if (target % 100 > 0) {
                this.log.info(`Already there: ${homeKitTarget}%`);
                return;
            }
            this.log.info(`Already there: ${homeKitTarget}%, re-sending request`);
        }

        const moveUp = target > this.lastPosition || target === 100;
        const direction: MoveDirection = moveUp ? 'up' : 'down';
        this.log.info(`Requested Move ${direction} (to ${homeKitTarget}%)`);

        const moveUrl = moveUp ? this.config.upUrl : this.config.downUrl;
        if (!moveUrl) {
            this.log.error(`No ${direction}_url configured; cannot move blinds`);
            return;
        }

        const exactEndpoint = await this.applyPositionToEndpoint(moveUrl, target);
        const requestEndpoint = exactEndpoint ?? moveUrl;
        const stopEndpoint = this.config.useSameUrlForStop ? moveUrl : this.config.stopUrl;

        this.windowCovering.getCharacteristic(this.Characteristic.ObstructionDetected).updateValue(false);
        this.windowCovering
            .getCharacteristic(this.Characteristic.PositionState)
            .updateValue(
                moveUp ? this.Characteristic.PositionState.INCREASING : this.Characteristic.PositionState.DECREASING,
            );

        let lastResult;
        try {
            for (let i = 0; i < this.config.commandRepeatCount; i++) {
                lastResult = await this.httpClient.request(requestEndpoint, this.config.httpOptions);
            }
        } catch (err) {
            this.handleRequestFailure(err);
            return;
        }

        this.consecutiveFailures = 0;
        this.lastCommandMoveUp = moveUp;
        this.storage.setItemSync(this.config.name, this.currentTargetPosition);

        const waitDelay = calculateMotionTime(
            this.config.motionTimeGraph,
            this.lastPosition,
            this.currentTargetPosition,
            moveUp,
        );
        const positionDelta = Math.abs(this.currentTargetPosition - this.lastPosition);
        const motionTimeStep = positionDelta > 0 ? waitDelay / positionDelta : 0;
        const requestTime = lastResult?.requestTime ?? 0;

        this.log.info(
            `Move request sent (${requestTime} ms), waiting ${Math.round(waitDelay / 100) / 10}s ` +
                `(+ ${Math.round(this.config.responseLag / 100) / 10}s response lag)...`,
        );

        // Skip the stop request when the move URL templated an exact
        // position (the device will stop on its own at target).
        if (exactEndpoint) {
            if (this.config.verbose) {
                this.log.info('Stop command will be skipped; exact position specified');
            }
        } else if (this.config.triggerStopAtBoundaries || target % 100 > 0) {
            if (this.config.verbose) {
                this.log.info('Stop command will be requested');
            }
            this.stopTimeout = setTimeout(
                () => {
                    void this.sendStopRequestInternal(stopEndpoint, false);
                },
                Math.max(waitDelay, 0),
            );
        }

        this.lagTimeout = setTimeout(
            () => {
                if (this.config.verbose) {
                    this.log.info('Timeout finished');
                }
                this.beginMotionEmulation(direction, motionTimeStep);
            },
            Math.max(this.config.responseLag, 0),
        );
    }

    /** Emulate motion toward `currentTargetPosition` via a fixed-cadence ticker. */
    private beginMotionEmulation(direction: MoveDirection, motionTimeStep: number): void {
        let targetReached = false;
        let positionRetries = 0;
        let intervalsToSkip = 0;
        let lastIntervalPosition = -1;

        const tick = (): void => {
            if (targetReached) {
                if (intervalsToSkip > 1) {
                    --intervalsToSkip;
                } else if (intervalsToSkip === 1) {
                    intervalsToSkip = 0;
                    targetReached = false;
                }
                return;
            }

            if (!this.manualStop) {
                if (direction === 'up' && this.lastPosition < this.currentTargetPosition) {
                    this.lastPosition += 1;
                    return;
                }
                if (direction === 'down' && this.lastPosition > this.currentTargetPosition) {
                    this.lastPosition -= 1;
                    return;
                }
            }

            // Re-poll once at target so the real-world value gets to settle
            // before we declare the move complete.
            targetReached = true;

            if (this.config.positionUrl) {
                void this.fetchAndUpdatePosition().finally(() => {
                    if (this.manualStop || this.lastPosition === this.currentTargetPosition) {
                        if (this.config.verbose) {
                            this.log.info(
                                `Reached target: ${this.currentTargetPosition}, currentPosition: ${this.lastPosition}, manualStop: ${this.manualStop ? 'Y' : 'N'}`,
                            );
                        }
                        this.endMoveRequest(direction);
                        return;
                    }
                    ++positionRetries;
                    if (positionRetries > POSITION_RETRY_LIMIT) {
                        this.log.error(`Didn't reach target after ${positionRetries} tries`);
                        this.manualStop = true;
                    } else if (this.lastPosition === lastIntervalPosition) {
                        if (this.config.verbose) {
                            this.log.info(
                                `Blinds position didn't change: skipping ${positionRetries} cycle${
                                    positionRetries > 1 ? 's' : ''
                                }`,
                            );
                        }
                        intervalsToSkip = positionRetries;
                        return;
                    }
                    lastIntervalPosition = this.lastPosition;
                    targetReached = false;
                });
            } else {
                this.endMoveRequest(direction);
            }
        };

        // 1ms floor guards against zero/negative cadence from a bad graph.
        const cadence = Math.max(motionTimeStep, 1);
        this.stepInterval = setInterval(tick, cadence);
    }

    private endMoveRequest(direction: MoveDirection): void {
        this.clearMotionTimers();
        this.log.info(
            `End Move ${direction} to ${this.toHomeKit(this.lastPosition)}% (target ${this.toHomeKit(this.currentTargetPosition)}%)`,
        );

        // Snap target to actual: HomeKit reports the blind as still moving
        // when CurrentPosition and TargetPosition disagree.
        this.currentTargetPosition = this.lastPosition;
        this.windowCovering
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .updateValue(this.toHomeKit(this.lastPosition));
        this.windowCovering
            .getCharacteristic(this.Characteristic.TargetPosition)
            .updateValue(this.toHomeKit(this.currentTargetPosition));
        this.windowCovering
            .getCharacteristic(this.Characteristic.PositionState)
            .updateValue(this.Characteristic.PositionState.STOPPED);
    }

    // --- Stop / toggle / favorite buttons ---------------------------------

    private async sendStopRequestInternal(stopEndpoint: HttpEndpoint | false, manual: boolean): Promise<void> {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        this.log.info(manual ? 'Requesting manual stop' : 'Requesting stop');
        this.windowCovering.getCharacteristic(this.Characteristic.ObstructionDetected).updateValue(false);
        try {
            await this.httpClient.request(stopEndpoint, this.config.httpOptions);
            if (manual) this.manualStop = true;
            this.consecutiveFailures = 0;
            this.log.info('Stop request sent');
        } catch (err) {
            this.log.warn(`Stop request failed: ${err instanceof Error ? err.message : String(err)}`);
            this.windowCovering.getCharacteristic(this.Characteristic.ObstructionDetected).updateValue(true);
        }
    }

    // --- Position polling ------------------------------------------------

    /** Periodic poll of `positionUrl`; skipped while emulating motion. */
    private pollPosition(): void {
        if (this.stopTimeout || this.stepInterval || this.lagTimeout) {
            if (this.config.verbose) {
                this.log.info('Polling skipped (move in progress)');
            }
            return;
        }
        if (this.config.verbose) {
            this.log.info('Polling started');
        }
        void this.fetchAndUpdatePosition().then(() => {
            this.currentTargetPosition = this.lastPosition;
            if (this.currentTargetPosition % 100 === 0) {
                this.lastCommandMoveUp = this.currentTargetPosition === 100;
            }
            // Push the polled value to HomeKit so external changes (a
            // physical remote, etc.) appear without re-opening the tile.
            this.windowCovering
                .getCharacteristic(this.Characteristic.CurrentPosition)
                .updateValue(this.toHomeKit(this.lastPosition));
            this.windowCovering
                .getCharacteristic(this.Characteristic.TargetPosition)
                .updateValue(this.toHomeKit(this.currentTargetPosition));
            if (this.config.verbose) {
                this.log.info('Polling finished');
            }
        });
    }

    private async fetchAndUpdatePosition(): Promise<void> {
        if (!this.config.positionUrl) return;
        try {
            const result = await this.httpClient.request(this.config.positionUrl, { method: 'GET' });
            this.consecutiveFailures = 0;
            if (!result.body) {
                if (this.config.verbose) {
                    this.log.error('setCurrentPositionByUrl failed; missing body');
                }
                return;
            }

            let value: unknown = result.body;
            try {
                const json = JSON.parse(result.body);
                if (this.positionJsonata) {
                    value = await this.positionJsonata.evaluate(json);
                } else if (typeof json === 'object' && json !== null) {
                    value = Object.values(json).find((v) => !Number.isNaN(Number(v)));
                } else {
                    value = json;
                }
            } catch (err) {
                if (this.config.verbose) {
                    this.log.error(`Error parsing JSON: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            const pos = parseInt(String(value), 10);
            if (Number.isNaN(pos) || pos < 0 || pos > 100) {
                this.log.warn(
                    `Position poll returned a value outside 0-100 (got: ${JSON.stringify(value)}). ` +
                        `Raw body: ${truncate(result.body)}. ` +
                        `${this.config.positionJsonata ? `pos_jsonata: '${this.config.positionJsonata}'.` : 'No pos_jsonata configured.'}`,
                );
                return;
            }
            this.lastPosition = pos;
            if (this.config.verbose) {
                this.log.info(`Polled position: ${this.toHomeKit(this.lastPosition)}`);
            }
        } catch (err) {
            this.handleRequestFailure(err);
        }
    }

    private handleWebhookPosition(pos: number): void {
        // Don't overwrite an in-flight move with the webhook value.
        if (this.stepInterval === null) {
            if (this.stopTimeout) {
                clearTimeout(this.stopTimeout);
                this.stopTimeout = null;
            }
            if (this.lagTimeout) {
                clearTimeout(this.lagTimeout);
                this.lagTimeout = null;
            }
            this.currentTargetPosition = pos;
            this.windowCovering
                .getCharacteristic(this.Characteristic.TargetPosition)
                .updateValue(this.toHomeKit(this.currentTargetPosition));
            this.log.info(`Current target updated by webhook: ${this.toHomeKit(pos)}`);
        }

        this.lastPosition = pos;
        this.windowCovering
            .getCharacteristic(this.Characteristic.CurrentPosition)
            .updateValue(this.toHomeKit(this.lastPosition));
        this.log.info(`Current position updated by webhook: ${this.toHomeKit(pos)}`);
    }

    /** Webhook `?target=N` updates the HomeKit target without sending a move. */
    private handleWebhookTarget(target: number): void {
        if (this.stepInterval !== null) {
            this.log.info(`Webhook target ignored — move in progress (got ${target})`);
            return;
        }
        this.currentTargetPosition = target;
        this.windowCovering
            .getCharacteristic(this.Characteristic.TargetPosition)
            .updateValue(this.toHomeKit(this.currentTargetPosition));
        this.log.info(`Target updated by webhook (no move issued): ${this.toHomeKit(target)}`);
    }

    // --- Helpers ---------------------------------------------------------

    /** Run `send_pos_jsonata` (if any) then apply the URL/body template. */
    private async applyPositionToEndpoint(endpoint: HttpEndpoint, pos: number): Promise<HttpEndpoint | null> {
        let mapped: number | string = pos;
        if (this.sendPositionJsonata) {
            try {
                const result = await this.sendPositionJsonata.evaluate(pos);
                if (result !== undefined && result !== null) {
                    mapped = result as number | string;
                }
            } catch (err) {
                this.log.error(
                    `Error evaluating send_pos_jsonata: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }
        return applyPositionTemplate(endpoint, mapped as number);
    }

    private clearMotionTimers(): void {
        if (this.stopTimeout) {
            clearTimeout(this.stopTimeout);
            this.stopTimeout = null;
        }
        if (this.lagTimeout) {
            clearTimeout(this.lagTimeout);
            this.lagTimeout = null;
        }
        if (this.stepInterval) {
            clearInterval(this.stepInterval);
            this.stepInterval = null;
        }
    }

    private handleRequestFailure(err: unknown): void {
        const message = err instanceof Error ? err.message : String(err);
        const attempts = err instanceof HttpRequestError ? err.attempts : 0;
        this.log.error(`Request failed${attempts ? ` after ${attempts} attempt(s)` : ''}: ${message}`);
        this.consecutiveFailures++;
        this.windowCovering
            .getCharacteristic(this.Characteristic.PositionState)
            .updateValue(this.Characteristic.PositionState.STOPPED);
        if (this.consecutiveFailures >= this.config.obstructionThreshold) {
            this.windowCovering.getCharacteristic(this.Characteristic.ObstructionDetected).updateValue(true);
        }
    }

    /** Internal position → HomeKit-facing (flip at the boundary if inverted). */
    private toHomeKit(internal: number): number {
        return this.config.invertPosition ? 100 - internal : internal;
    }

    /** Inverse of `toHomeKit`. */
    private fromHomeKit(homeKit: number): number {
        return this.config.invertPosition ? 100 - homeKit : homeKit;
    }

    // --- Battery polling -------------------------------------------------

    private buildBatteryService(logger: Logger): void {
        this.batteryJsonataExpr = JsonataExpression.compile(this.config.batteryJsonata, 'battery_jsonata', logger);
        const ServiceCtor = (this.Service as unknown as { Battery?: new (name: string) => Service }).Battery;
        if (!ServiceCtor) {
            this.log.warn('Battery service unavailable in this Homebridge build; skipping battery polling');
            return;
        }
        this.batteryService = new ServiceCtor(`${this.config.name} Battery`);
        const charging = (this.Characteristic as unknown as Record<string, unknown>).ChargingState as
            | { NOT_CHARGEABLE?: number }
            | undefined;
        this.batteryService
            .getCharacteristic((this.Characteristic as unknown as Record<string, unknown>).BatteryLevel as never)
            .updateValue(100);
        this.batteryService
            .getCharacteristic((this.Characteristic as unknown as Record<string, unknown>).StatusLowBattery as never)
            .updateValue(0);
        if (charging?.NOT_CHARGEABLE !== undefined) {
            this.batteryService
                .getCharacteristic((this.Characteristic as unknown as Record<string, unknown>).ChargingState as never)
                .updateValue(charging.NOT_CHARGEABLE);
        }
    }

    private async pollBattery(): Promise<void> {
        if (!this.config.batteryUrl || !this.batteryService) return;
        try {
            const result = await this.httpClient.request(this.config.batteryUrl, { method: 'GET' });
            if (!result.body) {
                if (this.config.verbose) this.log.warn('Battery poll returned empty body');
                return;
            }
            let value: unknown = result.body;
            try {
                const json = JSON.parse(result.body);
                if (this.batteryJsonataExpr) {
                    value = await this.batteryJsonataExpr.evaluate(json);
                } else if (typeof json === 'object' && json !== null) {
                    value = Object.values(json).find((v) => !Number.isNaN(Number(v)));
                } else {
                    value = json;
                }
            } catch (err) {
                if (this.config.verbose) {
                    this.log.warn(
                        `Battery poll: error parsing JSON: ${err instanceof Error ? err.message : String(err)}`,
                    );
                }
            }
            const level = parseInt(String(value), 10);
            if (Number.isNaN(level) || level < 0 || level > 100) {
                this.log.warn(
                    `Battery poll returned a value outside 0-100 (got: ${JSON.stringify(value)}). ` +
                        `Raw body: ${truncate(result.body)}. ` +
                        `${this.config.batteryJsonata ? `battery_jsonata: '${this.config.batteryJsonata}'.` : 'No battery_jsonata configured.'}`,
                );
                return;
            }
            const lowBattery = level <= this.config.batteryLowThreshold ? 1 : 0;
            this.batteryService
                .getCharacteristic((this.Characteristic as unknown as Record<string, unknown>).BatteryLevel as never)
                .updateValue(level);
            this.batteryService
                .getCharacteristic(
                    (this.Characteristic as unknown as Record<string, unknown>).StatusLowBattery as never,
                )
                .updateValue(lowBattery);
            if (this.config.verbose) {
                this.log.info(`Battery polled: ${level}% (low: ${lowBattery ? 'yes' : 'no'})`);
            }
        } catch (err) {
            // Battery poll failure does not trip ObstructionDetected.
            const message = err instanceof Error ? err.message : String(err);
            this.log.warn(`Battery poll failed: ${message}`);
        }
    }

    private buildWindowCoveringService(): Service {
        const C = this.Characteristic;
        const service = new this.Service.WindowCovering(this.config.name);

        service.getCharacteristic(C.CurrentPosition).onGet(() => this.handleCurrentPositionGet());
        service
            .getCharacteristic(C.TargetPosition)
            .onGet(() => this.handleTargetPositionGet())
            .onSet((value) => this.handleTargetPositionSet(value));
        service.getCharacteristic(C.PositionState).updateValue(C.PositionState.STOPPED);
        service.getCharacteristic(C.ObstructionDetected).updateValue(false);

        // Older HAP builds omit HoldPosition; guard with a presence check.
        const holdChar = (C as unknown as Record<string, unknown>).HoldPosition;
        if (holdChar) {
            service.getCharacteristic(holdChar as never).onSet(async (value) => {
                if (!value) return;
                const stopEndpoint = this.config.useSameUrlForStop
                    ? this.lastCommandMoveUp
                        ? this.config.upUrl
                        : this.config.downUrl
                    : this.config.stopUrl;
                await this.sendStopRequestInternal(stopEndpoint, true);
            });
        }

        return service;
    }

    private buildExtraServices(): void {
        if (this.config.showStopButton && (this.config.stopUrl || this.config.useSameUrlForStop)) {
            const stopService = new this.Service.Switch(`${this.config.name} Stop`, 'stop');
            stopService.getCharacteristic(this.Characteristic.On).onSet(async (value) => {
                if (!value) return;
                const stopEndpoint = this.config.useSameUrlForStop
                    ? this.lastCommandMoveUp
                        ? this.config.upUrl
                        : this.config.downUrl
                    : this.config.stopUrl;
                await this.sendStopRequestInternal(stopEndpoint, true);
                setTimeout(() => {
                    stopService.getCharacteristic(this.Characteristic.On).updateValue(false);
                }, TOGGLE_RESET_DELAY_MS);
            });
            this.extraServices.push(stopService);
        }

        if (this.config.showToggleButton) {
            const toggleService = new this.Service.Switch(`${this.config.name} Toggle`, 'toggle');
            toggleService.getCharacteristic(this.Characteristic.On).onSet((value) => {
                if (!value) return;
                if (this.lastCommandMoveUp !== null) {
                    this.windowCovering.setCharacteristic(
                        this.Characteristic.TargetPosition,
                        this.toHomeKit(this.lastCommandMoveUp ? 0 : 100),
                    );
                } else {
                    this.log.warn(
                        'No previously saved command, toggle skipped. Send an up / down request to establish state and enable toggle functionality.',
                    );
                }
                setTimeout(() => {
                    toggleService.getCharacteristic(this.Characteristic.On).updateValue(false);
                }, TOGGLE_RESET_DELAY_MS);
            });
            this.extraServices.push(toggleService);
        }

        for (const favoritePos of this.config.showFavoriteButtons) {
            const favoriteService = new this.Service.Switch(
                `${this.config.name} ${favoritePos}% Shortcut`,
                `favorite_${favoritePos}`,
            );
            favoriteService.getCharacteristic(this.Characteristic.On).onSet((value) => {
                if (!value) return;
                this.log.info(`Requesting favorite position: ${favoritePos}`);
                this.windowCovering.setCharacteristic(this.Characteristic.TargetPosition, favoritePos);
                setTimeout(() => {
                    favoriteService.getCharacteristic(this.Characteristic.On).updateValue(false);
                }, TOGGLE_RESET_DELAY_MS);
            });
            this.extraServices.push(favoriteService);
        }
    }
}

function getPackageVersion(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require('../package.json') as { version: string };
        return pkg.version;
    } catch {
        return '0.0.0';
    }
}

/** Trim a string for log output so a noisy device payload doesn't drown the log. */
function truncate(s: string, max = 200): string {
    return s.length <= max ? s : `${s.slice(0, max)}…(${s.length} bytes)`;
}
