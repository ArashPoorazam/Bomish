package app

import (
	"net/http"
	"os"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/orderquery"
)

func (a *App) orders(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	v, e := orderquery.Load(r.Context(), a.Pool, orderquery.Filter{CustomerID: current(r).UserID, TrackingTemplate: os.Getenv("POST_TRACKING_URL_TEMPLATE")})
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, v)
}

func (a *App) getOrder(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	orders, e := orderquery.Load(r.Context(), a.Pool, orderquery.Filter{CustomerID: current(r).UserID, ID: r.PathValue("id"), Limit: 1, TrackingTemplate: os.Getenv("POST_TRACKING_URL_TEMPLATE")})
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	for _, o := range orders {
		if o.ID == r.PathValue("id") {
			trackingURL := ""
			if o.Shipping == nil && domain.ValidPostalTracking(o.Tracking) {
				trackingURL = domain.PostalTrackingURL(o.Tracking, os.Getenv("POST_TRACKING_URL_TEMPLATE"))
			}
			httpx.JSON(w, 200, map[string]any{"order": o, "trackingUrl": trackingURL})
			return
		}
	}
	httpx.Error(w, 404, "سفارش پیدا نشد")
}
