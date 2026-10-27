import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// This module stays server-renderable; client editors can reuse the same policy.
const plugins = [remarkGfm];
const components = {
  img: () => null,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="prose-table">
      <table>{children}</table>
    </div>
  ),
};

export function RichText({ text }: { text: string }) {
  return (
    <div className="prose">
      <Markdown
        skipHtml
        remarkPlugins={plugins}
        urlTransform={(url) =>
          /^(https?:|mailto:|\/|#)/i.test(url) &&
          !url.startsWith("//") &&
          !url.includes("\\")
            ? url
            : ""
        }
        components={components}
      >
        {text}
      </Markdown>
    </div>
  );
}
