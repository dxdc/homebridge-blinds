/** Canonical shape produced by `normalizeConfig`. */
export interface BlindsConfig {
    name: string;

    // Movement endpoints
    upUrl: HttpEndpoint | false;
    downUrl: HttpEndpoint | false;
    stopUrl: HttpEndpoint | false;

    // Position polling
    positionUrl: HttpEndpoint | false;
    positionPollInterval: number;
    positionJsonata: string | false;

    // Battery polling (optional)
    batteryUrl: HttpEndpoint | false;
    batteryPollInterval: number;
    batteryJsonata: string | false;
    /** Percentage at or below which the BatteryLevel triggers a low alert. */
    batteryLowThreshold: number;

    // Outbound position mapping (target -> wire format)
    sendPositionJsonata: string | false;

    // HTTP client tuning
    successCodes: number[];
    httpOptions: Partial<HttpEndpoint>;
    maxHttpAttempts: number;
    retryDelay: number;
    requestTimeout: number;
    commandRepeatCount: number;
    obstructionThreshold: number;
    setDebounceMs: number;

    // Webhook listener
    webhookPort: number;
    webhookHttps: boolean;
    webhookHttpsKeyFile: string | false;
    webhookHttpsCertFile: string | false;
    webhookHttpAuthUser: string | false;
    webhookHttpAuthPass: string | false;

    // HomeKit buttons
    showStopButton: boolean;
    showToggleButton: boolean;
    showFavoriteButtons: number[];

    // Motion calibration
    motionTimeGraph: MotionTimeGraph;
    responseLag: number;

    // Behavior toggles
    invertPosition: boolean;
    uniqueSerial: boolean;
    triggerStopAtBoundaries: boolean;
    useSameUrlForStop: boolean;
    verbose: boolean;
}

export interface HttpEndpoint {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string | Record<string, unknown>;
    maxAttempts?: number;
    retryDelay?: number;
    timeout?: number;
    time?: boolean;
}

export interface MotionStep {
    pos: number;
    seconds: number;
    /** Precomputed seconds-per-position-unit from the previous step. */
    motionTimeStep?: number;
}

export interface MotionTimeGraph {
    up: MotionStep[];
    down: MotionStep[];
}

export interface Logger {
    info(message: string, ...params: unknown[]): void;
    warn(message: string, ...params: unknown[]): void;
    error(message: string, ...params: unknown[]): void;
    debug(message: string, ...params: unknown[]): void;
    log?(message: string, ...params: unknown[]): void;
}
