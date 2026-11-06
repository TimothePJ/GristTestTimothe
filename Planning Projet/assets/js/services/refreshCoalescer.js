// Regroupe les demandes de rechargement qui arrivent pendant qu'un rechargement est en cours.
// - Une demande identique ou plus faible que celle en cours réutilise sa promesse.
// - Une demande plus forte (un indicateur de plus à vrai) déclenche UN rechargement de suite, une
//   fois le premier terminé, avec les options fusionnées (OU des indicateurs) ; toutes les demandes
//   plus fortes arrivées pendant le même vol partagent ce rechargement.
// `flags` liste les options booléennes qui « demandent plus » lorsqu'elles sont vraies.
export function createRefreshCoalescer(run, flags) {
  let inFlight = null; // { options, promise }
  let pending = null; // { options, promise }

  const covers = (have, want) => flags.every((flag) => !want[flag] || have[flag]);
  const merge = (a, b) => {
    const merged = { ...a, ...b };
    for (const flag of flags) merged[flag] = Boolean(a[flag] || b[flag]);
    return merged;
  };

  function start(options) {
    const entry = { options, promise: null };
    entry.promise = Promise.resolve().then(() => run(options));
    inFlight = entry;
    const release = () => {
      if (inFlight === entry) inFlight = null;
    };
    entry.promise.then(release, release);
    return entry.promise;
  }

  return function request(options = {}) {
    if (!inFlight) return start(options);
    if (covers(inFlight.options, options)) return inFlight.promise;
    if (pending) {
      pending.options = merge(pending.options, options);
      return pending.promise;
    }
    const entry = { options, promise: null };
    const settled = inFlight.promise.then(() => {}, () => {});
    entry.promise = settled.then(() => {
      pending = null;
      return start(entry.options);
    });
    pending = entry;
    return entry.promise;
  };
}
