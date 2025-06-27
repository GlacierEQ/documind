export interface Character {
  health: number;
  attack: number;
  defense: number;
}

export interface Upgrade {
  id: string;
  name: string;
  apply(character: Character): void;
}

export interface Combo {
  name: string;
  upgradeIds: string[];
}

export class UpgradeManager {
  private upgrades: Map<string, Upgrade> = new Map();

  addUpgrade(upgrade: Upgrade): void {
    if (this.upgrades.has(upgrade.id)) {
      throw new Error(`Upgrade ${upgrade.id} already exists`);
    }
    this.upgrades.set(upgrade.id, upgrade);
  }

  removeUpgrade(id: string): void {
    if (!this.upgrades.delete(id)) {
      throw new Error(`Upgrade ${id} not found`);
    }
  }

  getUpgrade(id: string): Upgrade | undefined {
    return this.upgrades.get(id);
  }

  hasUpgrade(id: string): boolean {
    return this.upgrades.has(id);
  }

  applyUpgrade(id: string, character: Character): void {
    const upgrade = this.upgrades.get(id);
    if (!upgrade) {
      throw new Error(`Upgrade ${id} not found`);
    }
    upgrade.apply(character);
  }

  listUpgrades(): string[] {
    return Array.from(this.upgrades.keys());
  }
}

export class ComboManager {
  private combos: Map<string, Combo> = new Map();

  constructor(private upgradeManager: UpgradeManager) {}

  addCombo(combo: Combo): void {
    if (this.combos.has(combo.name)) {
      throw new Error(`Combo ${combo.name} already exists`);
    }
    combo.upgradeIds.forEach((id) => {
      if (!this.upgradeManager.hasUpgrade(id)) {
        throw new Error(`Upgrade ${id} not found for combo ${combo.name}`);
      }
    });
    this.combos.set(combo.name, combo);
  }

  executeCombo(name: string, character: Character): void {
    const combo = this.combos.get(name);
    if (!combo) {
      throw new Error(`Combo ${name} not found`);
    }
    combo.upgradeIds.forEach((id) =>
      this.upgradeManager.applyUpgrade(id, character),
    );
  }

  removeCombo(name: string): void {
    if (!this.combos.delete(name)) {
      throw new Error(`Combo ${name} not found`);
    }
  }
}
