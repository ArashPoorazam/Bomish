import { test, expect } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../../src/components/rich-text";

const render = (text: string) =>
  renderToStaticMarkup(createElement(RichText, { text }));

test("static Markdown preserves the documented authoring features", () => {
  const html = render(`## عنوان

**پررنگ** and ~~removed~~

- [x] Done
- [ ] Pending

| Name | Value |
| --- | --- |
| Spice | 10 |

A note[^1].

[^1]: Footnote text.

[Products](/products) and [Email](mailto:hello@example.com)`);
  expect(html).toContain("<h2>عنوان</h2>");
  expect(html).toContain("<strong>پررنگ</strong>");
  expect(html).toContain("<del>removed</del>");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain('class="prose-table"><table>');
  expect(html).toContain("Footnote text.");
  expect(html).toContain('href="/products"');
  expect(html).toContain('href="mailto:hello@example.com"');
});

test("raw HTML, inline images and unsafe URLs cannot render active content", () => {
  const html = render(`![image](https://example.com/tracker.png)

<script>alert(1)</script>

<iframe src="https://example.com"></iframe>

[Unsafe](javascript:alert%281%29)
[Data](data:text/html,unsafe)
[External](//example.com)
[Safe](https://example.com)
[Section](#section)`);
  expect(html).not.toMatch(/<(?:img|script|iframe)\b/);
  expect(html).not.toMatch(/href="(?:javascript:|data:|\/\/)/);
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('href="#section"');
});

test("unfinished Markdown is preserved instead of repaired as a stream", () => {
  expect(render("An unfinished **draft")).toContain("An unfinished **draft");
});
