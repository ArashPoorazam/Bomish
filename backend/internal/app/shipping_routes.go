package app

import "net/http"

func (a *App) shippingRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/staff/shipping/couriers", withPermission(a.shippingCouriers, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/own-courier", withPermission(a.dispatchOwnCourier, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/own-courier/delivered", withPermission(a.deliverOwnCourier, "orders.edit"))
	m.HandleFunc("GET /api/v1/shipping/localities", a.localities)
	m.HandleFunc("POST /api/v1/staff/shipping/providers/{provider}/check", withPermission(a.checkShippingProvider, "shipping.edit"))
	m.HandleFunc("POST /api/v1/staff/shipping/preview", withPermission(a.shippingPreview, "shipping.edit"))
	m.HandleFunc("GET /api/v1/staff/orders/{id}/delivery", withPermission(a.staffDelivery, "orders"))
	m.HandleFunc("PUT /api/v1/staff/orders/{id}/parcels", withPermission(a.correctParcels, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/ready", withPermission(a.readyOrder, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/dispatch-quote", withPermission(a.dispatchQuote, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments", withPermission(a.bookShipment, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/refresh", withPermission(a.refreshShipment, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/{shipmentId}/cancel", withPermission(a.cancelShipment, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/resolve", withPermission(a.resolveShipment, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/delivery-method", withPermission(a.changeDeliveryMethod, "orders.edit"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}/parcels/{parcelId}", withPermission(a.postalParcel, "orders.edit"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/shipments/simulate", withPermission(a.simulateShipment, "orders.edit"))
	m.HandleFunc("POST /api/v1/webhooks/snapp", a.snappWebhook)
}
