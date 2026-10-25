package app

import "net/http"

func (a *App) requestRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/requests/{id}/messages/{message}/image", func(w http.ResponseWriter, r *http.Request) { a.messageImage(w, r, false) })
	m.HandleFunc("GET /api/v1/staff/requests/{id}/messages/{message}/image", a.permitRequest(func(w http.ResponseWriter, r *http.Request) { a.messageImage(w, r, true) }))
	m.HandleFunc("GET /api/v1/staff/requests/{id}/orders", a.permitRequest(a.requestOrders))
	m.HandleFunc("GET /api/v1/requests", a.customerRequests)
	m.HandleFunc("POST /api/v1/requests", a.createRequest)
	m.HandleFunc("GET /api/v1/requests/{id}/messages", a.customerMessages)
	m.HandleFunc("POST /api/v1/requests/{id}/messages", a.customerMessage)
	m.HandleFunc("GET /api/v1/staff/requests", a.permitRequest(a.staffRequests))
	m.HandleFunc("GET /api/v1/staff/requests/{id}", a.permitRequest(a.staffRequest))
	m.HandleFunc("PATCH /api/v1/staff/requests/{id}", a.permitRequest(a.decideRequest))
	m.HandleFunc("GET /api/v1/staff/requests/{id}/messages", a.permitRequest(a.staffMessages))
	m.HandleFunc("POST /api/v1/staff/requests/{id}/messages", a.permitRequest(a.staffMessage))
	m.HandleFunc("POST /api/v1/staff/requests/{id}/read", a.permitRequest(a.readRequest))
	m.HandleFunc("GET /api/v1/staff/notifications", withAnyPermission(a.requestNotifications, "requests", "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/read", withPermission(a.readOrder, "orders"))
}
