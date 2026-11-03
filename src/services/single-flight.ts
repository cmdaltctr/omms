/** Like setInterval, but skips a tick while the previous run of the task is still pending. */
export function setSingleFlightInterval(task: () => Promise<void>, ms: number): NodeJS.Timeout {
  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    void task().finally(() => {
      running = false;
    });
  }, ms);
}
