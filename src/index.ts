// homebridge ships ESM types; import attribute keeps node16 resolution happy
// while we still emit CommonJS.
import type { API } from 'homebridge' with { 'resolution-mode': 'import' };
import { BlindsAccessory } from './accessory';

export = (api: API): void => {
    api.registerAccessory('homebridge-blinds', 'BlindsHTTP', BlindsAccessory);
};
