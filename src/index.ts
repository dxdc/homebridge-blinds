import type { API } from 'homebridge';
import { BlindsAccessory } from './accessory';

export = (api: API): void => {
    api.registerAccessory('homebridge-blinds', 'BlindsHTTP', BlindsAccessory);
};
