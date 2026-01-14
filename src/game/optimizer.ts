import { Character, UpgradeManager } from "./mechanics";

function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function optimizeCombo(
  base: Character,
  manager: UpgradeManager,
  populationSize = 10,
  generations = 10,
  seed = 1,
): string[] {
  const upgradeIds = manager.listUpgrades();
  if (upgradeIds.length === 0) {
    throw new Error("No upgrades available");
  }
  const rand = mulberry32(seed);

  const randomCombo = () => {
    const len = Math.max(1, Math.floor(rand() * upgradeIds.length));
    const shuffled = [...upgradeIds].sort(() => rand() - 0.5);
    return shuffled.slice(0, len);
  };

  const evaluate = (ids: string[]) => {
    const clone: Character = { ...base };
    ids.forEach((id) => manager.applyUpgrade(id, clone));
    return clone.attack + clone.defense;
  };

  let population: string[][] = Array.from(
    { length: populationSize },
    randomCombo,
  );

  for (let g = 0; g < generations; g++) {
    population.sort((a, b) => evaluate(b) - evaluate(a));
    population = population.slice(0, Math.max(1, populationSize / 2));
    while (population.length < populationSize) {
      const p1 = population[Math.floor(rand() * population.length)];
      const p2 = population[Math.floor(rand() * population.length)];
      const cut = Math.floor(rand() * p1.length);
      let child = [...p1.slice(0, cut), ...p2.slice(cut)];
      if (rand() < 0.3) {
        if (rand() < 0.5 && child.length > 1) {
          child.splice(Math.floor(rand() * child.length), 1);
        } else {
          const add = upgradeIds[Math.floor(rand() * upgradeIds.length)];
          if (!child.includes(add)) child.push(add);
        }
      }
      population.push(child);
    }
  }

  population.sort((a, b) => evaluate(b) - evaluate(a));
  return population[0];
}
