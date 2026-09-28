const examples = [
  {
    title: "تیترها",
    syntax:
      "# Heading 1\n## Heading 2\n### Heading 3\n#### Heading 4\n##### Heading 5\n###### Heading 6",
    help: "بعد از # فاصله بگذارید. عنوان مقاله جداگانه نمایش داده می‌شود؛ بخش‌های متن را معمولاً با ## شروع کنید و سطح‌ها را به‌ترتیب ادامه دهید.",
  },
  {
    title: "روش دیگر نوشتن تیتر",
    syntax: "Heading 1\n===\n\nHeading 2\n---",
    help: "خط زیر متن، آن را به تیتر تبدیل می‌کند. برای جلوگیری از اشتباه با خط جداکننده، روش # ساده‌تر است.",
  },
  {
    title: "پاراگراف و رفتن به خط بعد",
    syntax:
      "First paragraph.\n\nSecond paragraph.\n\nFirst line\\\nSecond line",
    help: "بین پاراگراف‌ها یک خط خالی بگذارید. برای شکستن خط در همان پاراگراف، انتهای خط دو فاصله یا یک بک‌اسلش (\\) بگذارید؛ Enter به‌تنهایی لزوماً خط جدید نمایش نمی‌دهد.",
  },
  {
    title: "پررنگ، مورب و خط‌خورده",
    syntax:
      "**Bold text**\n*Italic text*\n***Bold and italic***\n~~Strikethrough~~",
    help: "به‌جای ** و * می‌توانید از __ و _ استفاده کنید. بین علامت‌ها و ابتدا یا انتهای متن فاصله نگذارید. قالب‌ها را می‌توان با هم ترکیب کرد.",
  },
  {
    title: "فهرست بدون شماره",
    syntax:
      "- First item\n- Second item\n  - Nested item\n  - Another nested item",
    help: "از -، * یا + و سپس یک فاصله استفاده کنید. زیرمجموعه را با تورفتگی بنویسید و نوع علامت را در هر فهرست یکسان نگه دارید.",
  },
  {
    title: "فهرست شماره‌دار",
    syntax:
      "1. First step\n2. Second step\n   - A note about this step\n3. Third step",
    help: "شماره، نقطه و فاصله را در ابتدای سطر بگذارید. برای محتوای ادامه‌دار یا زیرمجموعه، ابتدای متن را با متن مورد بالایی هم‌تراز کنید. شماره‌گذاری از شماره اولین مورد شروع می‌شود.",
  },
  {
    title: "فهرست کارها",
    syntax: "- [ ] Write the draft\n- [x] Choose a cover image",
    help: "داخل کروشه برای مورد خالی یک فاصله و برای مورد انجام‌شده x بگذارید. این علامت‌ها وضعیت را در مقاله نمایش می‌دهند؛ فرم تعاملی برای خواننده نیستند.",
  },
  {
    title: "نقل‌قول",
    syntax:
      "> A quoted sentence.\n>\n> Another paragraph in the quote.\n>> A nested quote.",
    help: "ابتدای هر سطر > بگذارید. داخل نقل‌قول می‌توانید تیتر، فهرست و متن پررنگ هم بنویسید.",
  },
  {
    title: "خط جداکننده",
    syntax: "First section\n\n---\n\nNext section",
    help: "سه یا چند خط تیره، ستاره یا زیرخط در یک سطر جدا بنویسید (---، *** یا ___). قبل و بعد آن یک خط خالی بگذارید.",
  },
  {
    title: "پیوند",
    syntax:
      '[Browse products](/products)\n[Website](https://example.com "Link title")\n[Email us](mailto:hello@example.com)',
    help: "متن قابل کلیک داخل [] و نشانی داخل () قرار می‌گیرد. توضیح داخل گیومه اختیاری است. برای صفحات همین فروشگاه از نشانی شروع‌شونده با / و برای سایت‌های دیگر از https:// استفاده کنید.",
  },
  {
    title: "پیوند مستقیم و ارجاعی",
    syntax:
      "<https://example.com>\nhttps://example.com\n\n[Read more][source]\n\n[source]: https://example.com",
    help: "نشانی کامل به‌صورت خودکار پیوند می‌شود. در روش ارجاعی، تعریف نشانی را در سطر جدا قرار دهید و همان شناسه را برای چند پیوند تکرار کنید.",
  },
  {
    title: "جدول",
    syntax:
      "| Product | Feature | Amount |\n| :--- | :---: | ---: |\n| Almonds | Fresh | 100 |\n| Walnuts | **Special** | 200 |",
    help: "سطر اول عنوان ستون‌ها و سطر دوم جداکننده ضروری است. :--- چپ‌چین، :---: وسط‌چین و ---: راست‌چین است. در خانه‌ها می‌توانید پیوند و قالب‌بندی متن داشته باشید. برای نوشتن | داخل خانه از \\| استفاده کنید.",
  },
  {
    title: "کد یا عبارت بدون قالب‌بندی",
    syntax:
      "Use `**literal asterisks**` inline.\n\n```text\nPlain text on multiple lines.\n  Indentation is preserved.\n```",
    help: "برای عبارت کوتاه یک بک‌تیک در دو طرف و برای چند خط سه بک‌تیک در سطر قبل و بعد بگذارید. نام زبان بعد از بک‌تیک‌های اول اختیاری است. ~~~ هم برای بلوک چندخطی قابل استفاده است؛ تورفتگی چهار فاصله نیز بلوک کد می‌سازد.",
  },
  {
    title: "نمایش خود علامت‌های Markdown",
    syntax:
      "\\*Literal asterisks\\*\n\\# This is not a heading\n\\[Literal brackets\\]\n\n``Text containing a ` backtick``",
    help: "برای نمایش علامت به‌جای اجرای قالب‌بندی، قبل از آن \\ بگذارید. برای عبارت دارای بک‌تیک از دو بک‌تیک در دو طرف استفاده کنید؛ برای نمایش بلوک سه‌بک‌تیکی آن را داخل بلوک چهاربک‌تیکی قرار دهید.",
  },
  {
    title: "پاورقی",
    syntax:
      "This sentence has a footnote.[^1]\n\n[^1]: Additional information goes here.",
    help: "شناسه پاورقی را با [^شناسه] در متن و تعریف آن را با همان شناسه و : در سطر جدا بنویسید. شناسه‌ها را یکتا نگه دارید؛ پاورقی‌ها در انتهای متن نمایش داده می‌شوند.",
  },
  {
    title: "نویسه‌های ویژه",
    syntax: "&copy;\n&reg;\n&amp;\n&nbsp;",
    help: "به‌ترتیب برای ©، ®، & و فاصله نشکن هستند. می‌توانید نویسه‌ها و ایموجی‌ها را مستقیم هم در متن بنویسید؛ کدهایی مانند :smile: به‌صورت خودکار به ایموجی تبدیل نمی‌شوند.",
  },
];

export function ArticleMarkdownHelp() {
  return (
    <details className="article-format-help">
      <summary>راهنمای قالب‌بندی متن</summary>
      <div className="markdown-cheatsheet">
        <p>
          نمونه‌ها را در متن مقاله کپی کنید و نتیجه را در «پیش‌نمایش» ببینید.
          علامت‌های Markdown را با صفحه‌کلید انگلیسی بنویسید؛ متن می‌تواند فارسی
          باشد.
        </p>
        {examples.map(({ title, syntax, help }) => (
          <section key={title} className="markdown-help-example">
            <h4>{title}</h4>
            <pre dir="ltr" lang="en">
              <code>{syntax}</code>
            </pre>
            <p>{help}</p>
          </section>
        ))}
        <section className="markdown-help-example">
          <h4>امکانات این ویرایشگر</h4>
          <p>
            تصویر را از بخش «تصویر اصلی» اضافه کنید؛ تصویرهای داخل متن با دستور
            Markdown نمایش داده نمی‌شوند. کد HTML، رنگ و اندازه دلخواه فونت،
            ویدئو و محتوای تعبیه‌شده پشتیبانی نمی‌شوند. فرمول‌های LaTeX و
            نمودارهای Mermaid هم در این ویرایشگر فعال نیستند. برای برجسته‌سازی
            از تیتر، متن پررنگ و نقل‌قول استفاده کنید.
          </p>
        </section>
      </div>
    </details>
  );
}
