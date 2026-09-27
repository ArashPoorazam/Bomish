"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, CircleMarker } from "leaflet";
import type { Address } from "@/lib/types";
import { api } from "@/lib/api";
export function AddressMap({
  address,
  onChange,
}: {
  address: Address;
  onChange: (value: Address) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null),
    marker = useRef<CircleMarker | null>(null),
    latest = useRef(address),
    change = useRef(onChange),
    sequence = useRef(0);
  const [point, setPoint] = useState<[number, number] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    latest.current = address;
    change.current = onChange;
  }, [address, onChange]);
  useEffect(() => {
    let cancelled = false;
    import("leaflet")
      .then((L) => {
        if (cancelled || !node.current) return;
        const m = L.map(node.current).setView(
          [address.latitude || 35.6892, address.longitude || 51.389],
          13,
        );
        map.current = m;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(m);
        const select = (lat: number, lng: number) => {
          marker.current?.remove();
          marker.current = L.circleMarker([lat, lng], {
            radius: 10,
            color: "#fff",
            weight: 3,
            fillColor: "#235943",
            fillOpacity: 1,
          }).addTo(m);
          setPoint([lat, lng]);
        };
        if (address.latitude !== undefined && address.longitude !== undefined)
          marker.current = L.circleMarker(
            [address.latitude, address.longitude],
            {
              radius: 10,
              color: "#fff",
              weight: 3,
              fillColor: "#235943",
              fillOpacity: 1,
            },
          ).addTo(m);
        m.on("click", (e) => select(e.latlng.lat, e.latlng.lng));
        m.on("locationfound", (e) => {
          select(e.latlng.lat, e.latlng.lng);
          m.setView(e.latlng, 16);
        });
        m.on("locationerror", () =>
          setError("موقعیت دریافت نشد؛ محل را روی نقشه انتخاب کنید."),
        );
      })
      .catch(() => setError("نقشه بارگذاری نشد؛ نشانی را دستی وارد کنید."));
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    sequence.current++;
    const seq = sequence.current;
    if (!point) return;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      api<
        Pick<Address, "street" | "city" | "province" | "latitude" | "longitude">
      >(`/addresses/reverse?lat=${point[0]}&lng=${point[1]}`)
        .then((v) => {
          if (seq === sequence.current)
            change.current({ ...latest.current, ...v, id: "" });
        })
        .catch((e) => {
          if (seq === sequence.current) {
            setError(e.message);
            change.current({
              ...latest.current,
              latitude: point[0],
              longitude: point[1],
            });
          }
        })
        .finally(() => {
          if (seq === sequence.current) setBusy(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      sequence.current++;
    };
  }, [point]);
  useEffect(() => {
    if (address.latitude !== undefined && address.longitude !== undefined)
      map.current?.panTo([address.latitude, address.longitude]);
    if (address.latitude !== undefined && address.longitude !== undefined)
      marker.current?.setLatLng([address.latitude, address.longitude]);
  }, [address.latitude, address.longitude]);
  return (
    <section className="address-map">
      <div className="between">
        <h3>نشانی را روی نقشه پیدا کنید</h3>
        <button
          className="button secondary"
          type="button"
          onClick={() =>
            map.current?.locate({ setView: false, enableHighAccuracy: true })
          }
        >
          موقعیت من
        </button>
      </div>
      <p className="muted">
        روی محل خانه بزنید؛ نشانی با نشان تکمیل می‌شود. پلاک و واحد را بررسی و
        اضافه کنید.
      </p>
      <div
        ref={node}
        className="map-canvas"
        aria-label="انتخاب محل تحویل روی نقشه"
      />
      <button
        className="button secondary"
        type="button"
        onClick={() => {
          const p = map.current?.getCenter();
          if (p) setPoint([p.lat, p.lng]);
        }}
      >
        انتخاب مرکز نقشه
      </button>
      <p role="status">
        {busy
          ? "در حال دریافت نشانی…"
          : point
            ? "موقعیت انتخاب شد؛ نشانی را بررسی کنید."
            : "یک نقطه روی نقشه انتخاب کنید."}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
