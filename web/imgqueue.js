// The phone serves a picture to the page from its own memory and network, six at a time. A Home draws about two hundred cards at once, so the pictures a person is
// about to look at (the focused card's neighbours, the hero's backdrop) used to wait behind pictures far away. This queue lets only `limit` card pictures load at a
// time and always starts the one closest to the focus first, which leaves the phone free slots for the hero. Pure: nothing runs at import time.

/**
 * @param {number} limit how many card pictures may load at the same time
 * @param {function(object): number} scoreOf the lower, the sooner a picture starts (read when a slot frees up, so it follows the focus)
 */
export function createImageQueue(limit, scoreOf) {
  let waiting = [];
  let loading = 0;
  let epoch = 0;

  function pump() {
    while (loading < limit && waiting.length) {
      let best = 0;
      for (let i = 1; i < waiting.length; i++) {
        if (scoreOf(waiting[i].img) < scoreOf(waiting[best].img)) best = i;
      }
      const job = waiting.splice(best, 1)[0];
      start(job);
    }
  }

  function start(job) {
    loading++;
    const mine = epoch;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      loading--;
      pump();
    };
    job.img.addEventListener('load', release);
    job.img.addEventListener('error', release);
    job.img.src = job.src;
    // A picture that never answers must not hold its slot for ever.
    job.timer = setTimeout(release, 20000);
    job.mine = mine;
  }

  return {
    /** Queues a picture: `img.src` is set when its turn comes. */
    add(img, src) {
      waiting.push({ img: img, src: src });
      pump();
    },
    /** Forgets the pictures that have not started (a new Home was drawn); those already loading finish. */
    clear() {
      waiting = [];
      epoch++;
    },
    pending: () => waiting.length,
    inFlight: () => loading,
  };
}
