export interface RestaurantETAConfig {
  avgServiceTimeMins: number;
  serviceCapacityUnits: number;
  etaBufferMins: number;
  almostYourTurnThreshold: number;
}

export interface ETAResult {
  estimatedWaitMins: number | null;
  formattedETA: string;
  isAlmostYourTurn: boolean;
  peopleAhead: number;
}

export class ETAService {
  /**
   * Deterministic, explainable ETA calculation formula.
   * formula: Math.ceil((peopleAhead * avgServiceTimeMins) / serviceCapacityUnits) + etaBufferMins
   */
  static calculateETA(
    position: number | null,
    config: RestaurantETAConfig = {
      avgServiceTimeMins: 15,
      serviceCapacityUnits: 3,
      etaBufferMins: 5,
      almostYourTurnThreshold: 3,
    }
  ): ETAResult {
    if (position === null || position <= 0) {
      return {
        estimatedWaitMins: null,
        formattedETA: 'Wait time unavailable',
        isAlmostYourTurn: false,
        peopleAhead: 0,
      };
    }

    const peopleAhead = Math.max(0, position - 1);
    const capacity = Math.max(1, config.serviceCapacityUnits);
    const avgTime = Math.max(1, config.avgServiceTimeMins);
    const buffer = Math.max(0, config.etaBufferMins);
    const threshold = Math.max(1, config.almostYourTurnThreshold);

    if (peopleAhead === 0) {
      return {
        estimatedWaitMins: buffer,
        formattedETA: 'You are next in line!',
        isAlmostYourTurn: true,
        peopleAhead: 0,
      };
    }

    const rawWait = Math.ceil((peopleAhead * avgTime) / capacity) + buffer;
    const isAlmostYourTurn = peopleAhead <= threshold;

    return {
      estimatedWaitMins: rawWait,
      formattedETA: `~${rawWait} mins`,
      isAlmostYourTurn,
      peopleAhead,
    };
  }
}
