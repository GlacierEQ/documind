import { describe, expect, test, beforeEach } from "vitest";
import { UpgradeManager, Character } from "../src/game/mechanics";
import { optimizeCombo } from "../src/game/optimizer";

describe("optimizeCombo", () => {
  let character: Character;
  let upgradeManager: UpgradeManager;

  beforeEach(() => {
    character = { health: 100, attack: 10, defense: 5 };
    upgradeManager = new UpgradeManager();
    upgradeManager.addUpgrade({
      id: "strength",
      name: "Strength Boost",
      apply: (c) => {
        c.attack += 5;
      },
    });
    upgradeManager.addUpgrade({
      id: "shield",
      name: "Shield Boost",
      apply: (c) => {
        c.defense += 3;
      },
    });
  });

  test("finds a combo improving stats", () => {
    const combo = optimizeCombo(character, upgradeManager, 8, 5, 1);
    expect(combo.length).toBeGreaterThan(0);
    const clone = { ...character };
    combo.forEach((id) => upgradeManager.applyUpgrade(id, clone));
    expect(clone.attack + clone.defense).toBeGreaterThan(
      character.attack + character.defense,
    );
  });
});
