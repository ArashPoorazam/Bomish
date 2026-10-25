package reporting

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

func xmlText(s string) string {
	var b bytes.Buffer
	_ = xml.EscapeText(&b, []byte(s))
	return b.String()
}

func excelColumn(n int) string {
	s := ""
	for n++; n > 0; n = (n - 1) / 26 {
		s = string(rune('A'+(n-1)%26)) + s
	}
	return s
}

func cell(w io.Writer, row, col int, v any, kind string) {
	ref := excelColumn(col) + strconv.Itoa(row)
	if v == nil {
		fmt.Fprintf(w, `<c r="%s"/>`, ref)
		return
	}
	if kind == "number" || kind == "money" {
		text := fmt.Sprint(v)
		n, e := strconv.ParseFloat(text, 64)
		if e == nil {
			if kind == "money" {
				n /= 10
			}
			fmt.Fprintf(w, `<c r="%s"><v>%s</v></c>`, ref, strconv.FormatFloat(n, 'f', -1, 64))
			return
		}
	}
	if t, ok := v.(time.Time); ok {
		zone := tehran()
		v = t.In(zone).Format("2006-01-02 15:04:05")
	}
	fmt.Fprintf(w, `<c r="%s" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`, ref, xmlText(fmt.Sprint(v)))
}

func (s *Service) BuildWorkbook(ctx context.Context, id string, raw []byte) ([]byte, error) {
	var params map[string]string
	if e := json.Unmarshal(raw, &params); e != nil {
		return nil, e
	}
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	plan, err := BuildQuery(q)
	if err != nil {
		return nil, err
	}
	sql, args, sort := plan.SQL, plan.Args, plan.Sort
	tx, e := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if e != nil {
		return nil, e
	}
	defer tx.Rollback(ctx)
	var total int64
	if e = tx.QueryRow(ctx, "SELECT count(*) FROM ("+sql+") x", args...).Scan(&total); e != nil {
		return nil, e
	}
	rows, e := tx.Query(ctx, sql+" ORDER BY "+sort, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	files := map[string]string{
		"[Content_Types].xml":        `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
		"_rels/.rels":                `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
		"xl/workbook.xml":            `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="گزارش امنیسایر" sheetId="1" r:id="rId1"/></sheets></workbook>`,
		"xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
	}
	for name, body := range files {
		f, err := z.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = io.WriteString(f, body); err != nil {
			return nil, err
		}
	}
	f, e := z.Create("xl/worksheets/sheet1.xml")
	if e != nil {
		return nil, e
	}
	io.WriteString(f, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="3" topLeftCell="A4" state="frozen"/></sheetView></sheetViews><sheetData>`)
	fmt.Fprint(f, `<row r="1">`)
	cell(f, 1, 0, "Omnisire · مبالغ به تومان · زمان تهران", "text")
	fmt.Fprint(f, `</row><row r="2">`)
	cell(f, 2, 0, q.Encode(), "text")
	fmt.Fprint(f, `</row><row r="3">`)
	for i, c := range plan.Columns {
		cell(f, 3, i, c.Label, "text")
	}
	fmt.Fprint(f, `</row>`)
	fields := rows.FieldDescriptions()
	// Resolve result columns once, rather than allocate a map for every row.
	indexes := make([]int, len(plan.Columns))
	for i, column := range plan.Columns {
		indexes[i] = -1
		for j, field := range fields {
			if field.Name == column.Key {
				indexes[i] = j
				break
			}
		}
	}
	count := 0
	for rows.Next() {
		count++
		if count > 1048573 {
			return nil, fmt.Errorf("report exceeds worksheet capacity; narrow filters")
		}
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		fmt.Fprintf(f, `<row r="%d">`, count+3)
		for i, c := range plan.Columns {
			var value any
			if indexes[i] >= 0 {
				value = vals[indexes[i]]
			}
			cell(f, count+3, i, value, c.Kind)
		}
		fmt.Fprint(f, `</row>`)
		if count%1000 == 0 && total > 0 {
			_, _ = s.Pool.Exec(ctx, "UPDATE report_exports SET progress=$2,updated_at=now() WHERE id=$1", id, int64(count)*95/total)
		}
	}
	if e = rows.Err(); e != nil {
		return nil, e
	}
	io.WriteString(f, `</sheetData></worksheet>`)
	if e = z.Close(); e != nil {
		return nil, e
	}
	return buf.Bytes(), nil
}
