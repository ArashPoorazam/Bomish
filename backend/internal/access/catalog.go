package access

import (
	"iter"
	"maps"
	"slices"
)

type Section struct {
	Key       string   `json:"key"`
	Label     string   `json:"label"`
	Actions   []string `json:"actions"`
	OwnerOnly bool     `json:"-"`
}

var sections = []Section{
	{"products", "محصولات", []string{"create", "edit", "delete"}, false},
	{"articles", "مجله", []string{"create", "edit", "delete"}, false},
	{"packaging", "بسته‌بندی‌ها", []string{"create", "edit"}, false},
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
	{"monitoring", "پایش سرور", []string{}, true},
}

var roleSections = map[string][]string{
	"manager":     {"products", "articles", "packaging", "categories", "pricing", "orders", "support", "custom", "home", "shipping", "sales"},
	"editor":      {"products", "articles", "packaging", "categories", "pricing", "home", "sales"},
	"operator":    {"orders", "support", "custom", "sales"},
	"salesperson": {"sales"},
	"courier":     {"sales"},
}

func Valid(key string) bool {
	for _, section := range sections {
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

// Sections returns an independent catalog so callers cannot mutate policy.
func Sections() []Section {
	out := slices.Clone(sections)
	for i := range out {
		out[i].Actions = slices.Clone(out[i].Actions)
	}
	return out
}

// Roles enumerates the staff roles; owners are protected independently.
func Roles() iter.Seq[string] { return maps.Keys(roleSections) }

// ValidLegacySection accepts persisted restriction keys during account edits.
func ValidLegacySection(section string) bool { return slices.Contains(staffSections, section) }
