package app

import (
	"net/http"

	"bomish/internal/httpx"
)

func (a *App) Handler() http.Handler {
	m := http.NewServeMux()
	a.publicRoutes(m)
	a.identityRoutes(m)
	a.customerRoutes(m)
	a.staffCatalogRoutes(m)
	a.pricingRoutes(m)
	a.fulfillmentRoutes(m)
	a.shippingRoutes(m)
	a.requestRoutes(m)
	a.omnisireRoutes(m)
	if a.UploadHandler != nil {
		m.Handle("GET /uploads/", a.UploadHandler)
	}
	return httpx.Observe(a.middleware(m), m)
}

func (a *App) publicRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/health", func(w http.ResponseWriter, r *http.Request) {
		if e := a.Pool.Ping(r.Context()); e != nil {
			httpx.Error(w, 503, "پایگاه داده در دسترس نیست")
			return
		}
		httpx.JSON(w, 200, map[string]string{"status": "ok"})
	})
	m.HandleFunc("GET /api/v1/settings", a.publicSettings)
	m.HandleFunc("GET /api/v1/categories", a.categories)
	m.HandleFunc("GET /api/v1/products", a.products)
	m.HandleFunc("GET /api/v1/products/{slug}", a.product)
	m.HandleFunc("GET /api/v1/articles", a.articles)
	m.HandleFunc("GET /api/v1/articles/{slug}", a.article)
	m.HandleFunc("GET /api/v1/home/slides", a.homeSlides)
}

func (a *App) identityRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/session", a.sessionInfo)
	m.HandleFunc("POST /api/v1/logout", a.logout)
	m.HandleFunc("POST /api/v1/auth/request", a.requestOTP)
	m.HandleFunc("POST /api/v1/auth/verify", a.verifyOTP)
	m.HandleFunc("POST /api/v1/staff/login", a.staffLogin)
	m.HandleFunc("POST /api/v1/staff/password", a.changeStaffPassword)
	m.HandleFunc("POST /api/v1/omnisire/unlock", a.unlockOmnisire)
}

func (a *App) customerRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/addresses/reverse", a.reverseAddress)
	m.HandleFunc("GET /api/v1/orders/{id}", a.getOrder)
	m.HandleFunc("POST /api/v1/events", a.recordEvent)
	m.HandleFunc("GET /api/v1/cart", a.getCart)
	m.HandleFunc("PUT /api/v1/cart/items/{id}", a.setCartItem)
	m.HandleFunc("DELETE /api/v1/cart/items/{id}", a.removeCartItem)
	m.HandleFunc("GET /api/v1/addresses", a.addresses)
	m.HandleFunc("POST /api/v1/addresses", a.saveAddress)
	m.HandleFunc("PUT /api/v1/addresses/{id}", a.updateAddress)
	m.HandleFunc("DELETE /api/v1/addresses/{id}", a.deleteAddress)
	m.HandleFunc("POST /api/v1/checkout/quote", a.quote)
	m.HandleFunc("POST /api/v1/checkout", a.checkout)
	m.HandleFunc("GET /api/v1/orders", a.orders)
	m.HandleFunc("POST /api/v1/orders/{id}/cancel", a.cancelOrder)
	m.HandleFunc("POST /api/v1/orders/{id}/simulate", a.simulatePayment)
	m.HandleFunc("POST /api/v1/referral", a.captureReferral)
}

func (a *App) staffCatalogRoutes(m *http.ServeMux) {
	m.HandleFunc("DELETE /api/v1/staff/categories/{id}", withPermission(a.deleteCategory, "categories.delete"))
	m.HandleFunc("GET /api/v1/staff/products", withPermission(a.staffProducts, "products"))
	m.HandleFunc("GET /api/v1/staff/product-packaging", withAnyPermission(a.productPackaging, "packaging", "products"))
	m.HandleFunc("PUT /api/v1/staff/product-packaging/{id}", withAnyPermission(a.saveProductPackaging, "packaging.create", "packaging.edit"))
	m.HandleFunc("PUT /api/v1/staff/products/{id}", withAnyPermission(a.saveProduct, "products.create", "products.edit"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/publish", withPermission(a.publishProduct, "products.edit"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/archive", withPermission(a.archiveProduct, "products.delete"))
	m.HandleFunc("POST /api/v1/staff/products/{id}/availability", withPermission(a.setAvailability, "products.edit"))
	m.HandleFunc("PUT /api/v1/staff/categories/{id}", withAnyPermission(a.saveCategory, "categories.create", "categories.edit"))
	m.HandleFunc("GET /api/v1/staff/articles", withPermission(a.staffArticles, "articles"))
	m.HandleFunc("PUT /api/v1/staff/articles/{id}", withAnyPermission(a.saveArticle, "articles.create", "articles.edit", "articles.delete"))
	m.HandleFunc("POST /api/v1/staff/uploads", withAnyPermission(a.upload, "products.create", "products.edit", "articles.create", "articles.edit", "home.edit"))
	m.HandleFunc("GET /api/v1/staff/home/slides", withPermission(a.homeSlides, "home"))
	m.HandleFunc("PUT /api/v1/staff/home/slides", withPermission(a.saveHomeSlides, "home.edit"))
	m.HandleFunc("GET /api/v1/staff/suggestions", withPermission(a.suggestions, "home"))
	m.HandleFunc("PUT /api/v1/staff/suggestions", withPermission(a.saveSuggestions, "home.edit"))
	m.HandleFunc("GET /api/v1/staff/product-options", a.productOptions)
	m.HandleFunc("GET /api/v1/staff/category-counts", withPermission(a.categoryCounts, "categories"))
}

func (a *App) pricingRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/staff/product-discounts", withPermission(a.listProductDiscounts, "pricing"))
	m.HandleFunc("POST /api/v1/staff/product-discounts", withPermission(a.createProductDiscount, "pricing.create"))
	m.HandleFunc("PATCH /api/v1/staff/product-discounts/{id}", withPermission(a.changeProductDiscount, "pricing.edit"))
	m.HandleFunc("DELETE /api/v1/staff/product-discounts/{id}", withPermission(a.changeProductDiscount, "pricing.delete"))
	m.HandleFunc("DELETE /api/v1/staff/discount-codes/{code}", withPermission(a.deleteDiscountCode, "pricing.delete"))
	m.HandleFunc("POST /api/v1/staff/pricing", withPermission(a.adjustPrices, "pricing.edit"))
	m.HandleFunc("GET /api/v1/staff/discount-codes", withPermission(a.listDiscountCodes, "pricing"))
	m.HandleFunc("POST /api/v1/staff/discount-codes", withPermission(a.createDiscountCode, "pricing.create"))
	m.HandleFunc("PATCH /api/v1/staff/discount-codes/{code}", withPermission(a.toggleDiscountCode, "pricing.edit"))
}

func (a *App) fulfillmentRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/staff/orders", withPermission(a.staffOrders, "orders"))
	m.HandleFunc("GET /api/v1/staff/orders/{id}", withPermission(a.staffOrder, "orders"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}/packing", withPermission(a.packOrderItem, "orders.edit"))
	m.HandleFunc("PATCH /api/v1/staff/orders/{id}", withPermission(a.updateOrder, "orders.edit"))
	m.HandleFunc("GET /api/v1/staff/shipping", withPermission(a.shippingSettings, "shipping"))
	m.HandleFunc("PUT /api/v1/staff/shipping", withPermission(a.saveShipping, "shipping.edit"))
	m.HandleFunc("GET /api/v1/staff/sales", withPermission(a.personalSales, "sales"))
}
