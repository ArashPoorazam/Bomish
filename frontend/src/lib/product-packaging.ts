import type { Package, ProductPackaging } from "./types";

export function withProductPackaging(
  pack: Package,
  packaging: ProductPackaging,
): Package {
  const { usedByProducts: _usage, ...definition } = packaging;
  const netGrams =
    pack.unit === "g"
      ? Math.round(pack.amount)
      : pack.unit === "kg"
        ? Math.round(pack.amount * 1000)
        : (pack.netGrams ?? 0);
  return {
    ...pack,
    packagingId: packaging.id,
    packaging: definition,
    netGrams,
    shippingGrams: netGrams + packaging.emptyGrams,
    lengthMm: packaging.lengthMm,
    widthMm: packaging.widthMm,
    heightMm: packaging.heightMm,
    shippingVerified:
      netGrams > 0 && netGrams + packaging.emptyGrams <= 1000000,
  };
}
