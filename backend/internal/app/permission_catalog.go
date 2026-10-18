package app

import "net/http"

type permissionSection struct {
	Key     string   `json:"key"`
	Label   string   `json:"label"`
	Actions []string `json:"actions"`
}

var permissionSections = []permissionSection{
	{"products", "محصولات", []string{"create", "edit", "delete"}},
	{"articles", "مجله", []string{"create", "edit", "delete"}},
	{"categories", "دسته‌بندی‌ها", []string{"create", "edit", "delete"}},
	{"pricing", "قیمت و تخفیف", []string{"create", "edit", "delete"}},
	{"orders", "سفارش‌ها", []string{"edit", "manage"}},
	{"support", "گفتگو با مشتری", []string{"edit"}},
	{"custom", "سفارش‌های اختصاصی", []string{"edit"}},
	{"home", "مدیریت خانه", []string{"edit"}},
	{"shipping", "ارسال", []string{"edit"}},
	{"sales", "فروش من", []string{}},
	{"overview", "نمای کلی", []string{}},
	{"members", "همکاران و حساب‌ها", []string{"create", "edit", "delete"}},
	{"analytics", "تحلیل داده‌ها", []string{"export"}},
	{"events", "رویدادها", []string{}},
}

var roleSections = map[string][]string{
	"manager":     {"products", "articles", "categories", "pricing", "orders", "support", "custom", "home", "shipping", "sales"},
	"editor":      {"products", "articles", "categories", "pricing", "home", "sales"},
	"operator":    {"orders", "support", "custom", "sales"},
	"salesperson": {"sales"},
	"courier":     {"sales"},
}

func validPermission(key string) bool {
	for _, section := range permissionSections {
		if key == section.Key {
			return true
		}
		for _, action := range section.Actions {
			if key == section.Key+"."+action {
				return true
			}
		}
	}
	return false
}

func (a *App) permissionOptions(w http.ResponseWriter, r *http.Request) {
	defaults := map[string][]string{}
	for role := range roleSections {
		defaults[role] = effectivePermissions(role, nil)
	}
	write(w, 200, map[string]any{"sections": permissionSections, "defaults": defaults})
}
