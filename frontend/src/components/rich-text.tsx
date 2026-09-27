"use client";
import { Streamdown } from "streamdown";
export function RichText({ text }: { text: string }) {
  return (
    <div className="prose">
      <Streamdown
        mode="streaming"
        controls={false}
        skipHtml
        rehypePlugins={[]}
        urlTransform={(url) =>
          /^(https?:|mailto:|\/|#)/i.test(url) && !url.startsWith("//")
            ? url
            : ""
        }
        components={{ img: () => null }}
      >
        {text}
      </Streamdown>
    </div>
  );
}
