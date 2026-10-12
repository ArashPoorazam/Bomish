import type { ShippingBox, ShippingConfig } from "@/lib/types";

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
export function simulationSetup(v: ShippingConfig): ShippingConfig {
  if (!v.simulated) return v;
  const tehran = v.localities.find(
    (l) => l.city === "تهران" && l.province === "تهران",
  );
  const cityId = tehran?.id ?? "sim-tehran";
  const localities = tehran
    ? v.localities
    : [
        ...v.localities,
        {
          id: cityId,
          provinceId: "sim-tehran-province",
          province: "تهران",
          city: "تهران",
          tapinProvince: "sim-province",
          tapinCity: "sim-city",
          verified: true,
        },
      ];
  return {
    ...v,
    localities,
    boxes: v.boxes.some((b) => b.active)
      ? v.boxes
      : [...v.boxes, simulationBox()],
    snapp: {
      enabled: true,
      verified: true,
      service: "sim-bike",
      shopId: "",
      currency: "rial",
      cityId,
      area: [
        [35.5, 51.1],
        [35.9, 51.1],
        [35.9, 51.7],
        [35.5, 51.7],
      ],
      maxGrams: 10000,
      maxVolumeCm3: 100000,
      maxParcels: 4,
      maxSize: { lengthMm: 500, widthMm: 500, heightMm: 500 },
    },
    tapin: {
      enabled: true,
      verified: true,
      service: "sim-post",
      shopId: "sim-shop",
      currency: "rial",
      cityId: "",
      area: [],
      maxGrams: 30000,
      maxVolumeCm3: 0,
      maxParcels: 20,
      maxSize: { lengthMm: 1000, widthMm: 1000, heightMm: 1000 },
    },
  };
}
