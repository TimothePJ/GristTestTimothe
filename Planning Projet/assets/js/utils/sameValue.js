// Deux valeurs ont-elles le même contenu ? Module pur. Valeurs simples, dates (même instant),
// listes (même ordre) et objets simples (mêmes champs), en profondeur. Sert à ne pas refaire un
// dessin ou un calcul quand ce qu'on vient de relire est ce qu'on a déjà.
export function sameValue(left, right) {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object") {
    // NaN n'est égal à rien, pas même à lui-même : ici, deux NaN sont le même contenu.
    return left !== left && right !== right;
  }
  if (left === null || right === null) return false;
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && sameValue(left.getTime(), right.getTime());
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => sameValue(item, right[index]));
  }
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
}
