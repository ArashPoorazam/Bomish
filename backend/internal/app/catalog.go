package app

import (
	"bomish/internal/db"
	"bomish/internal/domain"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func productFrom(p db.Product, outOfStock bool) domain.Product {
	var out domain.Product
	_ = json.Unmarshal(p.Content, &out)
	out.ID = p.ID
	out.Slug = p.Slug
	out.Name = p.Name
	out.CategoryID = p.CategoryID
	out.Status = p.Status
	out.PriceRials = p.PriceRials
	out.MinGrams = p.MinGrams
	out.StepGrams = p.StepGrams
	out.MaxGrams = p.MaxGrams
	out.OutOfStock = outOfStock
	if out.Images == nil {
		out.Images = []string{}
	}
	if out.Tags == nil {
		out.Tags = []string{}
	}
	if out.RelatedIDs == nil {
		out.RelatedIDs = []string{}
	}
	if out.Aliases == nil {
		out.Aliases = []string{}
	}
	if out.Nutrients == nil {
		out.Nutrients = []domain.Nutrient{}
	}
	if out.Sections == nil {
		out.Sections = []domain.Section{}
	}
	out.EnsurePackages()
	return out
}
func (a *App) categories(w http.ResponseWriter, r *http.Request) {
	v, e := a.Queries.ListCategories(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	if v == nil {
		v = []db.Category{}
	}
	write(w, 200, v)
}
func (a *App) products(w http.ResponseWriter, r *http.Request) { a.catalogPage(w, r, false) }
func (a *App) product(w http.ResponseWriter, r *http.Request) {
	p, e := a.Queries.GetPublicProduct(r.Context(), r.PathValue("slug"))
	if e != nil {
		fail(w, 404, "محصول پیدا نشد")
		return
	}
	write(w, 200, productFrom(db.Product{ID: p.ID, Slug: p.Slug, Name: p.Name, CategoryID: p.CategoryID, Status: p.Status, PriceRials: p.PriceRials, MinGrams: p.MinGrams, StepGrams: p.StepGrams, MaxGrams: p.MaxGrams, Content: p.Content}, p.OutOfStock))
}
func articleFrom(p db.Article) domain.Article {
	var v domain.Article
	_ = json.Unmarshal(p.Content, &v)
	v.ID = p.ID
	v.Slug = p.Slug
	v.Title = p.Title
	v.Status = p.Status
	v.UpdatedAt = p.UpdatedAt.Time.Format(time.RFC3339)
	if v.ProductIDs == nil {
		v.ProductIDs = []string{}
	}
	return v
}
func (a *App) articles(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Queries.ListPublicArticles(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	v := []domain.Article{}
	for _, p := range rows {
		v = append(v, articleFrom(p))
	}
	write(w, 200, v)
}
func (a *App) article(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Queries.ListPublicArticles(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	for _, p := range rows {
		if p.Slug == r.PathValue("slug") {
			write(w, 200, articleFrom(p))
			return
		}
	}
	fail(w, 404, "مقاله پیدا نشد")
}
func searchText(p domain.Product) string {
	return domain.Normalize(strings.Join(append([]string{p.Name}, append(p.Aliases, p.Tags...)...), " "))
}
