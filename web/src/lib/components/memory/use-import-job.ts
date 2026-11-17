import { useEffect, useRef, useState } from "react";
import { createLatestGate, settingsRequest } from "$lib/settings-api";
import { restorableJob } from "./import-job-view";
import type { GroupImportRequest, ImportJob } from "./import-types";

const ACTIVE = ["running", "cancelling", "preparing", "queued"];

/**
 * The one import job the server owns: load it on mount, poll it while it runs,
 * start a new one, and cancel it. A late reply from an older request never
 * replaces the job a newer request set.
 */
export function useImportJob() {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  const jobReplies = useRef(createLatestGate());
  const running = ACTIVE.includes(job?.state ?? "");

  /** `onLoad` drops a job that already ended, so a reload does not bring its results back. */
  function refreshJob(onLoad = false) {
    const isCurrent = jobReplies.current.begin();
    return settingsRequest<{ job: ImportJob | null }>("/api/settings/imports/current").then(
      (value) => {
        if (mounted.current && isCurrent()) setJob(onLoad ? restorableJob(value.job) : value.job);
      }
    );
  }

  useEffect(() => {
    mounted.current = true;
    void refreshJob(true).catch(() => {});
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (submitting.current) return;
      void refreshJob().catch((cause: Error) => {
        if (mounted.current) setError(cause.message);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running]);

  /**
   * Start a preview or an import. `build` runs inside the guard, so an invalid
   * draft throws like a refused request. Resolves with the new job, or throws
   * the reason. A refused start reconnects to the job that is running.
   */
  async function post(build: () => GroupImportRequest): Promise<ImportJob> {
    submitting.current = true;
    jobReplies.current.begin();
    setBusy(true);
    try {
      const response = await settingsRequest<ImportJob>("/api/settings/imports", {
        method: "POST",
        body: JSON.stringify(build()),
      });
      if (mounted.current) setJob(response);
      return response;
    } catch (cause) {
      // The competing job stays server-owned. Reconnect instead of retrying the request.
      void refreshJob().catch(() => {});
      throw cause;
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function cancel() {
    if (submitting.current) return;
    submitting.current = true;
    jobReplies.current.begin();
    try {
      const response = await settingsRequest<{ job: ImportJob }>(
        "/api/settings/imports/current/cancel",
        { method: "POST", body: "{}" }
      );
      if (mounted.current) setJob(response.job);
    } catch (cause) {
      if (mounted.current) setError((cause as Error).message);
    } finally {
      submitting.current = false;
    }
  }

  return { job, running, busy, error, setError, submitting, mounted, refreshJob, post, cancel };
}

export type ImportJobState = ReturnType<typeof useImportJob>;
