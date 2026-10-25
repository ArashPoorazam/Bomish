package reporting

import (
	"net/url"
	"strings"
	"testing"
)

func TestBuildQueryValidatesAndParameterizes(t *testing.T) {
	for _, query := range []string{
		"section=unknown", "from=invalid", "from=2026-10-25&to=2026-10-24",
		"from=2020-01-01&to=2026-01-01", "q=" + strings.Repeat("x", 501),
	} {
		values, _ := url.ParseQuery(query)
		if _, err := BuildQuery(values); err == nil {
			t.Fatalf("accepted %q", query)
		}
	}
	values := url.Values{"section": {"products"}, "q": {"'; DROP TABLE products; --"}, "sort": {"id; DROP TABLE products"}, "from": {"2026-10-01"}, "to": {"2026-10-25"}}
	plan, err := BuildQuery(values)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(plan.SQL, "DROP TABLE") || strings.Contains(plan.Sort, "DROP TABLE") {
		t.Fatal("untrusted SQL identifier")
	}
	if len(plan.Args) != 3 || !strings.Contains(plan.Args[2].(string), "drop table") {
		t.Fatal("search is not a bound argument")
	}
	plan.Columns[0].Label = "changed"
	fresh, err := BuildQuery(values)
	if err != nil || fresh.Columns[0].Label == "changed" {
		t.Fatal("caller mutated report catalog")
	}
}
