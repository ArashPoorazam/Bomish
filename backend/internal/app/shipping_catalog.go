package app

import (
	_ "embed"
	"encoding/json"

	"bomish/internal/packing"
)

type boxCatalogEntry struct {
	ID             string       `json:"id"`
	Version        string       `json:"version"`
	Name           string       `json:"name"`
	SourceURL      string       `json:"sourceUrl"`
	NominalOutside packing.Size `json:"nominalOutside"`
	Note           string       `json:"note"`
}

//go:embed shipping_box_catalog.json
var boxCatalogJSON []byte

func shippingBoxCatalog() []boxCatalogEntry {
	var entries []boxCatalogEntry
	if err := json.Unmarshal(boxCatalogJSON, &entries); err != nil {
		panic(err)
	}
	return entries
}
