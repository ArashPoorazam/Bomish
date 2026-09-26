// Deliberately support a small, safe Markdown subset. HTML and executable links are never interpreted.
export function RichText({ text }: { text: string }) {
  return (
    <div className="prose">
      {text
        .split(/\n\s*\n/)
        .filter(Boolean)
        .map((block, i) =>
          block.startsWith("## ") ? (
            <section key={i}>
              <h3>{block.split("\n")[0].slice(3)}</h3>
              {block
                .split("\n")
                .slice(1)
                .map((line, j) => (
                  <p key={j}>{line}</p>
                ))}
            </section>
          ) : (
            <p key={i}>{block}</p>
          ),
        )}
    </div>
  );
}
