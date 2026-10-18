package app

import "net/http"

func (a *App) shippingRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/staff/shipping/couriers", a.permit(a.shippingCouriers, "orders", "edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/own-courier", a.permit(a.dispatchOwnCourier, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/own-courier/delivered", a.permit(a.deliverOwnCourier, "orders"))
	m.HandleFunc("GET /api/v1/shipping/localities", a.localities)
	m.HandleFunc("POST /api/v1/staff/shipping/providers/{provider}/check", a.permit(a.checkShippingProvider, "shipping"))
	m.HandleFunc("POST /api/v1/staff/shipping/preview", a.permit(a.shippingPreview, "shipping"))
	m.HandleFunc("GET /api/v1/staff/orders/{id}/delivery", a.permit(a.staffDelivery, "orders"))
	m.HandleFunc("PUT /api/v1/staff/orders/{id}/parcels", a.permit(a.correctParcels, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/ready", a.permit(a.readyOrder, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/dispatch-quote", a.permit(a.dispatchQuote, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments", a.permit(a.bookShipment, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/refresh", a.permit(a.refreshShipment, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/{shipmentId}/cancel", a.permit(a.cancelShipment, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/resolve", a.permit(a.resolveShipment, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/delivery-method", a.permit(a.changeDeliveryMethod, "orders"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}/parcels/{parcelId}", a.permit(a.postalParcel, "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/simulate", a.permit(a.simulateShipment, "orders"))
	m.HandleFunc("POST /api/v1/webhooks/snapp", a.snappWebhook)
}
