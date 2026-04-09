/** Simple frame-rate counter. Call tick() each frame. */
export function createFpsCounter(intervalMs = 500) {
  let frames = 0;
  let lastUpdate = performance.now();
  let current = 0;

  return {
    tick(now: number) {
      frames++;
      if (now - lastUpdate >= intervalMs) {
        current = (frames * 1000) / (now - lastUpdate);
        frames = 0;
        lastUpdate = now;
      }
      return current;
    },
    get value() {
      return current;
    },
  };
}
