import { SupplyDemandTracker } from '../../../packages/zones/supply-demand.tracker';
import { ZoneManager } from '../../../packages/zones/zone.manager';

class SurgeWorker {
    async start(): Promise<void> {
        console.log('Surge Pricing Worker started');
        
        // Initialize zones
        await ZoneManager.initializeZones();
        
        // Start supply/demand tracking
        await SupplyDemandTracker.startTracking();
        
        console.log('Surge pricing system active - updating every minute');
    }
}

const worker = new SurgeWorker();
worker.start().catch(console.error);