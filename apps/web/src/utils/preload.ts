const PRELOAD_TIMEOUT_MS = 6000;
const PRELOAD_BLOCKING_ATTEMPTS = 2;

type PreloadTarget = {
  type: "image" | "audio" | "video";
  url: string;
};

type PreloadOutcome = {
  loaded: boolean;
  forced: boolean;
  retried: boolean;
};

export type PreloadSummary = {
  total: number;
  loaded: number;
  forced: number;
  retried: number;
};

function fireAndForget(target: PreloadTarget) {
  if (typeof window === "undefined") {
    return;
  }

  if (target.type === "image") {
    const image = new Image();
    image.src = target.url;
    return;
  }

  const element = document.createElement(
    target.type === "audio" ? "audio" : "video",
  );
  element.preload = "auto";
  element.src = target.url;
  element.load();
}

function preloadOnce(target: PreloadTarget) {
  if (typeof window === "undefined") {
    return Promise.resolve(true);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (result: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timer);
      resolve(result);
    };

    const timer = window.setTimeout(() => finish(false), PRELOAD_TIMEOUT_MS);

    if (target.type === "image") {
      const image = new Image();
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = target.url;
      return;
    }

    const element = document.createElement(
      target.type === "audio" ? "audio" : "video",
    );
    element.preload = "auto";
    element.onloadeddata = () => finish(true);
    element.oncanplaythrough = () => finish(true);
    element.onerror = () => finish(false);
    element.src = target.url;
    element.load();
  });
}

async function preloadTarget(target: PreloadTarget): Promise<PreloadOutcome> {
  for (let attempt = 0; attempt < PRELOAD_BLOCKING_ATTEMPTS; attempt += 1) {
    const loaded = await preloadOnce(target);
    if (loaded) {
      return {
        loaded: true,
        forced: false,
        retried: attempt > 0,
      };
    }
  }

  fireAndForget(target);
  return {
    loaded: false,
    forced: true,
    retried: true,
  };
}

async function preloadTargets(
  targets: PreloadTarget[],
): Promise<PreloadSummary> {
  const validTargets = targets.filter((target) => target.url.trim().length > 0);
  if (validTargets.length === 0) {
    return { total: 0, loaded: 0, forced: 0, retried: 0 };
  }

  const results = await Promise.all(
    validTargets.map((target) => preloadTarget(target)),
  );
  return {
    total: validTargets.length,
    loaded: results.filter((item) => item.loaded).length,
    forced: results.filter((item) => item.forced).length,
    retried: results.filter((item) => item.retried).length,
  };
}

export function preloadImages(urls: string[]) {
  return preloadTargets(urls.map((url) => ({ type: "image" as const, url })));
}

export function preloadMediaAssets(targets: PreloadTarget[]) {
  return preloadTargets(targets);
}
