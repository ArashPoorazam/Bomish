package access

import (
	"slices"
)

var staffSections = []string{"products", "articles", "categories", "pricing", "orders", "requests", "shipping", "sales"}

// Bare keys grant viewing; action keys never grant access to a denied section.
// Legacy restrictions remain effective until the member is edited or reset.
func Effective(role string, restrictions []string, overrides ...map[string]bool) []string {
	allowed := []string{}
	defaults, known := roleSections[role]
	if !known && role != "owner" {
		return allowed
	}
	custom := map[string]bool{}
	if len(overrides) > 0 && overrides[0] != nil {
		custom = overrides[0]
	}
	for _, section := range sections {
		// Old saved overrides cannot delegate the independently protected owner workspace.
		if section.OwnerOnly && role != "owner" {
			continue
		}
		inherited := slices.Contains(defaults, section.Key)
		legacy := section.Key
		if legacy == "support" || legacy == "custom" {
			legacy = "requests"
		}
		if legacy == "home" || legacy == "packaging" {
			legacy = "products"
		}
		restricted := slices.Contains(restrictions, legacy)
		view := inherited && !restricted
		if value, ok := custom[section.Key]; ok {
			view = value
		}
		if role == "owner" {
			view = true
		}
		if !view {
			continue
		}
		allowed = append(allowed, section.Key)
		for _, action := range section.Actions {
			key := section.Key + "." + action
			enabled := inherited && !restricted
			if key == "orders.manage" {
				enabled = role == "manager" && !restricted
			}
			if value, ok := custom[key]; ok {
				enabled = value
			}
			if enabled || role == "owner" {
				allowed = append(allowed, key)
			}
		}
	}
	// Compatibility for clients that use the old combined requests capability.
	if slices.Contains(allowed, "support") || slices.Contains(allowed, "custom") {
		allowed = append(allowed, "requests")
	}
	if role == "owner" {
		allowed = append(allowed, "omnisire")
	}
	return allowed
}
