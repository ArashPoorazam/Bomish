package architecture

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Keep infrastructure and read models independent of application workflows.
// A new dependency needs an explicit architecture decision, not an accidental
// import of the application's session, environment, or transaction machinery.
func TestPackageBoundaries(t *testing.T) {
	allowed := map[string][]string{
		"access": {}, "security": {}, "server": {}, "storage": {}, "runtimeconfig": {}, "database": {}, "db": {}, "packing": {},
		"domain": {"packing"}, "carrier": {"domain", "packing"}, "httpx": {"security"},
		"orderquery": {"database", "domain"}, "reporting": {"database", "domain", "httpx"},
	}
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		owner := filepath.Base(filepath.Dir(path))
		dependencies, check := allowed[owner]
		if !check {
			return nil
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		for _, imp := range file.Imports {
			name, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				return err
			}
			if dependency, ok := strings.CutPrefix(name, "bomish/internal/"); ok && !slices.Contains(dependencies, dependency) {
				t.Errorf("%s imports %s outside its documented boundary", path, name)
			}
			if slices.Contains([]string{"access", "security", "packing", "domain"}, owner) && (strings.HasPrefix(name, "net/http") || strings.HasPrefix(name, "github.com/jackc/pgx")) {
				t.Errorf("pure package %s imports transport/persistence %s", owner, name)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
