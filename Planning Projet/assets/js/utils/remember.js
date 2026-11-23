// Garde le dernier résultat d'un calcul tant que ses sources sont les mêmes. Module pur.
// Les sources sont comparées par identité (le même objet, la même liste), pas par contenu : une
// source modifiée sur place passerait inaperçue. Il faut donc ne jamais modifier une source ni un
// résultat gardé — chaque changement doit en faire un nouvel objet. Seul le dernier résultat est gardé.
export function remember(compute) {
  let known = false;
  let lastSources = [];
  let lastValue;
  return (...sources) => {
    const same = known && sources.length === lastSources.length
      && sources.every((source, index) => Object.is(source, lastSources[index]));
    if (!same) {
      lastValue = compute(...sources);
      lastSources = sources;
      known = true;
    }
    return lastValue;
  };
}
