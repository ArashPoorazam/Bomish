import type { ShippingBox } from "@/lib/types";

// Explicit development fixtures, never supplier specifications or live provider contracts.
export function simulationBox(): ShippingBox {
  return {
    id: crypto.randomUUID(),
    name: "کارتن آزمایشی ۳۰ سانتی‌متری",
    simulated: true,
    inside: { lengthMm: 300, widthMm: 300, heightMm: 300 },
    outside: { lengthMm: 310, widthMm: 310, heightMm: 310 },
    emptyGrams: 100,
    fillerGrams: 20,
    insetMm: 5,
    maxGrams: 10000,
    postalSizeId: "sim-box",
    active: true,
    verified: true,
  };
}
