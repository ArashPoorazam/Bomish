package app

import "net/http"

type permissionSection struct {
	Key       string   `json:"key"`
	Label     string   `json:"label"`
	Actions   []string `json:"actions"`
	OwnerOnly bool     `json:"-"`
}

var permissionSections = []permissionSection{
	{"products", "محصولات", []string{"create", "edit", "delete"}, false},
	{"articles", "مجله", []string{"create", "edit", "delete"}, false},
	{"categories", "دسته‌بندی‌ها", []string{"create", "edit", "delete"}, false},
	{"pricing", "قیمت و تخفیف", []string{"create", "edit", "delete"}, false},
	{"orders", "سفارش‌ها", []string{"edit", "manage"}, false},
	{"support", "گفتگو با مشتری", []string{"edit"}, false},
	{"custom", "سفارش‌های اختصاصی", []string{"edit"}, false},
	{"home", "مدیریت خانه", []string{"edit"}, false},
	{"shipping", "ارسال", []string{"edit"}, false},
	{"sales", "فروش من", []string{}, false},
	{"overview", "نمای کلی", []string{}, true},
	{"members", "همکاران و حساب‌ها", []string{"create", "edit", "delete"}, true},
	{"analytics", "تحلیل داده‌ها", []string{"export"}, true},
	{"events", "رویدادها", []string{}, true},
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
		if section.OwnerOnly {
			continue
		}
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
	sections := []permissionSection{}
	for _, section := range permissionSections {
		if !section.OwnerOnly {
			sections = append(sections, section)
		}
	}
	write(w, 200, map[string]any{"sections": sections, "defaults": defaults})
}
