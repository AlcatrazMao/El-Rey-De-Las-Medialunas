import type { UnitType } from "../types/enums";

export const UNIT_LABELS: Record<UnitType, { singular: string; plural: string; abbreviation: string }> = {
  unit: { singular: "unidad", plural: "unidades", abbreviation: "u" },
  kg: { singular: "kilogramo", plural: "kilogramos", abbreviation: "kg" },
  g: { singular: "gramo", plural: "gramos", abbreviation: "g" },
  l: { singular: "litro", plural: "litros", abbreviation: "L" },
  ml: { singular: "mililitro", plural: "mililitros", abbreviation: "ml" },
  dozen: { singular: "docena", plural: "docenas", abbreviation: "doc" },
  pack: { singular: "pack", plural: "packs", abbreviation: "pack" },
};

export const UNIT_LIST: UnitType[] = ["unit", "kg", "g", "l", "ml", "dozen", "pack"];

export function formatUnit(quantity: number, unit: UnitType): string {
  const info = UNIT_LABELS[unit];
  const label = quantity === 1 ? info.singular : info.plural;
  return `${quantity} ${label}`;
}
