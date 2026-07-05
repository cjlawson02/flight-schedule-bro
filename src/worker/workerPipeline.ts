import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  executeWorkerAvailabilitySearch,
  type WorkerAvailabilitySearchResult,
} from "../shared/blo/workerAvailabilitySearch.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import { createWorkerConfig, type ConfigType } from "../shared/util/config.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import { fetchAuth, type AuthSession } from "../shared/dao/auth.js";
import { getOrFetchMetadata } from "./metadata.js";
import { initializeWorker } from "./utils.js";
import type { Env } from "./types.js";

export interface WorkerBootstrap {
  config: ConfigType;
  session: AuthSession;
}

export async function bootstrapWorker(env: Env): Promise<WorkerBootstrap> {
  initializeWorker();

  const config = createWorkerConfig(env);
  const session = await fetchAuth(config.EMAIL, config.PASSWORD);

  return { config, session };
}

export async function loadWorkerMetadata(
  session: AuthSession,
  kv: KVNamespace,
): Promise<FspMetadata> {
  return getOrFetchMetadata(session.operatorId, kv);
}

export function createHydratedScheduler(
  session: AuthSession,
  fspMetadata: FspMetadata,
  timeZone: string,
): SchedulerBLO {
  const scheduler = new SchedulerBLO(session.operatorId, timeZone);
  scheduler.hydrateFromMetadata(fspMetadata);
  return scheduler;
}

export async function runWorkerAvailabilitySearchFlow(options: {
  config: ConfigType;
  session: AuthSession;
  fspMetadata: FspMetadata;
  scheduler: SchedulerBLO;
  today?: Date;
  failFast?: boolean;
}): Promise<WorkerAvailabilitySearchResult> {
  const today =
    options.today ?? startOfOperatorDay(new Date(), options.config.TIMEZONE);

  return executeWorkerAvailabilitySearch({
    config: options.config,
    fspMetadata: options.fspMetadata,
    scheduler: options.scheduler,
    auth: {
      locationId: options.session.defaultLocationId,
    },
    today,
    failFast: options.failFast,
  });
}
