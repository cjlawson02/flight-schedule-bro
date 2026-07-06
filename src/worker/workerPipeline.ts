import { SchedulerBLO } from "../shared/blo/scheduler.js";
import {
  executeWorkerAvailabilitySearch,
  type WorkerAvailabilitySearchResult,
} from "../shared/blo/workerAvailabilitySearch.js";
import type { FspMetadata } from "../shared/blo/fspMetadata.js";
import {
  createWorkerConfig,
  type WorkerConfigType,
} from "../shared/util/config.js";
import { startOfOperatorDay } from "../shared/util/flightTime.js";
import {
  fetchAuth,
  setActiveAuthSession,
  type AuthSession,
} from "../shared/dao/auth.js";
import { getOrFetchMetadata } from "./metadata.js";
import { initializeWorker } from "./utils.js";
import type { SubrequestBudget } from "../shared/util/subrequestBudget.js";
import type { Env } from "./types.js";

export interface WorkerBootstrap {
  config: WorkerConfigType;
  session: AuthSession;
}

export async function bootstrapWorker(env: Env): Promise<WorkerBootstrap> {
  initializeWorker();

  const config = createWorkerConfig(env);
  const session = await fetchAuth(config.EMAIL, config.PASSWORD);
  setActiveAuthSession(session);

  return { config, session };
}

export async function loadWorkerMetadata(
  session: AuthSession,
  kv: KVNamespace,
  options: { allowApiRefresh?: boolean } = {},
): Promise<FspMetadata> {
  return getOrFetchMetadata(session.operatorId, kv, options);
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
  config: WorkerConfigType;
  session: AuthSession;
  fspMetadata: FspMetadata;
  scheduler: SchedulerBLO;
  budget: SubrequestBudget;
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
    budget: options.budget,
    today,
    failFast: options.failFast,
  });
}
