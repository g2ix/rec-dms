"use client";

import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { useEffect, useState } from "react";
import { BlurLoad } from "@/components/ui/blur-load";

// Monaco comes from our own bundle, not the jsdelivr CDN @monaco-editor/react would fetch by
// default: the content security policy allows scripts and workers from 'self' only.
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") {
      return new Worker(new URL("monaco-editor/language/json/json.worker.js", import.meta.url), { type: "module" });
    }
    return new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), { type: "module" });
  },
};
loader.config({ monaco });

export function SchemaEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
}) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.getAttribute("data-theme") === "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="rec-editor">
      <Editor
        height="100%"
        defaultLanguage="json"
        theme={dark ? "vs-dark" : "vs"}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        loading={
          <BlurLoad state="loading" placeholder={<span className="rec-bar rec-bar--lg" />}>
            {null}
          </BlurLoad>
        }
        options={{
          minimap: { enabled: false },
          readOnly,
          wordWrap: "on",
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
        }}
      />
    </div>
  );
}
