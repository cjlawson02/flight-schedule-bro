import { createWorkerConfig } from "../shared/util/config.js";
import { getErrorMessage } from "../shared/util/errors.js";
import {
  fetchAuth,
  getOperatorId,
  setActiveAuthSession,
} from "../shared/dao/auth.js";
import { runSetup } from "./setup.js";
import { refreshMetadata } from "./metadata.js";
import { getSnapshot } from "./kv.js";
import { runScheduledTask } from "./scheduled.js";
import { releaseWorkerRunLock, tryAcquireWorkerRunLock } from "./runLock.js";
import { initializeWorker } from "./utils.js";
import { createLogger } from "../shared/util/logger.js";
import type { Env } from "./types.js";

const log = createLogger("worker");

/**
 * Main scheduled handler - runs every 30 minutes
 */
export default {
  async scheduled(
    event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await runScheduledTask(env, ctx);
    } catch (error) {
      log.error("Error in scheduled task", {
        message: getErrorMessage(error),
        error,
      });
      throw error;
    }
  },

  /**
   * HTTP handler for setup and health checks
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Setup endpoint
    if (url.pathname === "/setup") {
      return await runSetup(env);
    }

    // Refresh metadata endpoint
    if (url.pathname === "/refresh-metadata") {
      const runId = `refresh-metadata-${Date.now()}`;
      const lockAcquired = await tryAcquireWorkerRunLock(
        env.FSP_AVAILABILITY_KV,
        runId,
      );
      if (!lockAcquired) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Another worker run is in progress. Try again shortly.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }

      try {
        initializeWorker();

        log.info("Refreshing metadata");
        const config = createWorkerConfig(env);

        setActiveAuthSession(await fetchAuth(config.EMAIL, config.PASSWORD));

        const metadata = await refreshMetadata(
          getOperatorId(),
          env.FSP_AVAILABILITY_KV,
        );

        return new Response(
          JSON.stringify({
            success: true,
            message: "Metadata refreshed successfully",
            metadata: {
              instructors: metadata.instructors.length,
              reservationTypes: metadata.reservationTypes.length,
              aircraft: metadata.aircraft.length,
              lastUpdated: metadata.lastUpdated,
            },
          }),
          {
            headers: { "content-type": "application/json" },
          },
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `❌ Refresh failed: ${getErrorMessage(error)}`,
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          },
        );
      } finally {
        setActiveAuthSession(null);
        await releaseWorkerRunLock(env.FSP_AVAILABILITY_KV, runId);
      }
    }

    // Health check endpoint
    if (url.pathname === "/health") {
      const snapshot = await getSnapshot(env);

      return new Response(
        JSON.stringify({
          status: "ok",
          snapshotExists: !!snapshot,
          metadata: snapshot?.metadata ?? null,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Default response
    return new Response(
      JSON.stringify({
        message: "Flight Schedule Bro Worker",
        endpoints: {
          "/setup": "Initialize the availability snapshot",
          "/refresh-metadata":
            "Refresh cached FSP metadata (instructors, aircraft, types)",
          "/health": "Check worker health and snapshot status",
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  },
};
