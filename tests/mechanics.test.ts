import {
  UpgradeManager,
  ComboManager,
  Character,
  Upgrade,
} from "../src/game/mechanics";
import { describe, it, test, expect, beforeEach } from "vitest";

describe("Upgrade and Combo system", () => {
  let character: Character;
  let upgradeManager: UpgradeManager;
  let comboManager: ComboManager;

  beforeEach(() => {
    character = { health: 100, attack: 10, defense: 5 };
    upgradeManager = new UpgradeManager();
    comboManager = new ComboManager(upgradeManager);

    const strength: Upgrade = {
      id: "strength",
      name: "Strength Boost",
      apply: (target) => {
        target.attack += 5;
      },
    };

    const shield: Upgrade = {
      id: "shield",
      name: "Shield Boost",
      apply: (target) => {
        target.defense += 3;
      },
    };

    upgradeManager.addUpgrade(strength);
    upgradeManager.addUpgrade(shield);

    comboManager.addCombo({
      name: "warrior",
      upgradeIds: ["strength", "shield"],
    });
  });

  test("applies single upgrade", () => {
    upgradeManager.applyUpgrade("strength", character);
    expect(character.attack).toBe(15);
    expect(character.defense).toBe(5);
  });

  test("prevents adding duplicate upgrades", () => {
    const duplicate: Upgrade = {
      id: "strength",
      name: "Duplicate",
      apply: () => {},
    };
    expect(() => upgradeManager.addUpgrade(duplicate)).toThrow(
      /already exists/,
    );
  });

  test("removes upgrades", () => {
    upgradeManager.removeUpgrade("strength");
    expect(() => upgradeManager.applyUpgrade("strength", character)).toThrow(
      /not found/,
    );
  });

  test("executes combo", () => {
    comboManager.executeCombo("warrior", character);
    expect(character.attack).toBe(15);
    expect(character.defense).toBe(8);
  });

  test("fails when combo references missing upgrade", () => {
    expect(() =>
      comboManager.addCombo({ name: "bad", upgradeIds: ["missing"] }),
    ).toThrow(/not found/);
  });

  test("removes combos", () => {
    comboManager.removeCombo("warrior");
    expect(() => comboManager.executeCombo("warrior", character)).toThrow(
      /not found/,
    );
  });
});
