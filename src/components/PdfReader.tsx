import { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { ChevronLeft, ChevronRight, Highlighter } from "lucide-react";
import { assetUrl, save } from "../lib/db";
import { useLinks } from "../lib/hooks";
import { Busy, ErrorBox } from "./ui";
import type { Asset } from "../types";
GlobalWorkerOptions.workerSrc = worker;
export default function PdfReader({
  asset,
  noteId,
  onQuote,
}: {
  asset: Asset;
  noteId: string;
  onQuote: (s: string) => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [quote, setQuote] = useState(""),
    [rects, setRects] = useState<any[]>([]),
    [loading, setLoading] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null),
    textLayer = useRef<HTMLDivElement>(null),
    paper = useRef<HTMLDivElement>(null);
  const annotations = useLinks(`asset:${asset.hash}`, "asset");
  useEffect(() => {
    let task: ReturnType<typeof getDocument> | undefined;
    let stopped = false;
    void (async () => {
      try {
        const url = await assetUrl(asset);
        if (stopped) return;
        task = getDocument({ url });
        const current = await task.promise;
        if (!stopped) setDoc(current);
      } catch (e) {
        if (!stopped) setError(String(e));
      }
    })();
    return () => {
      stopped = true;
      void task?.destroy();
    };
  }, [asset.hash]);
  useEffect(() => {
    let cancelled = false;
    let renderTask:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    let layer: TextLayer | undefined;
    if (!doc) return;
    setLoading(true);
    setQuote("");
    void (async () => {
      try {
        const pdfPage = await doc.getPage(page);
        if (
          cancelled ||
          !canvas.current ||
          !textLayer.current ||
          !paper.current
        )
          return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(
          1.4,
          (paper.current.parentElement!.clientWidth - 32) / base.width,
        );
        const viewport = pdfPage.getViewport({ scale });
        const c = canvas.current;
        const ratio = window.devicePixelRatio || 1;
        c.width = viewport.width * ratio;
        c.height = viewport.height * ratio;
        c.style.width = `${viewport.width}px`;
        c.style.height = `${viewport.height}px`;
        paper.current.style.width = `${viewport.width}px`;
        paper.current.style.height = `${viewport.height}px`;
        paper.current.style.setProperty("--scale-factor", String(scale));
        renderTask = pdfPage.render({
          canvas: c,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await renderTask.promise;
        if (cancelled) return;
        textLayer.current.innerHTML = "";
        layer = new TextLayer({
          textContentSource: await pdfPage.getTextContent(),
          container: textLayer.current,
          viewport,
        });
        await layer.render();
        setLoading(false);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
      renderTask?.cancel();
      layer?.cancel();
    };
  }, [doc, page]);
  return (
    <div className="pdf-reader">
      <div className="pdf-toolbar">
        <button
          aria-label="上一页"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {page} / {doc?.numPages || "—"}
        </span>
        <button
          aria-label="下一页"
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
        <span className="muted">选择原文即可划线引用</span>
        {loading && <Busy />}
      </div>
      <ErrorBox message={error} />
      <div className="pdf-scroll">
        <div
          className="pdf-paper"
          ref={paper}
          onMouseUp={() => {
            const selection = window.getSelection();
            if (
              !selection?.rangeCount ||
              !paper.current?.contains(selection.anchorNode)
            )
              return;
            setQuote(selection.toString().trim());
            const bound = paper.current!.getBoundingClientRect();
            setRects(
              Array.from(selection.getRangeAt(0).getClientRects()).map((r) => ({
                x: (r.x - bound.x) / bound.width,
                y: (r.y - bound.y) / bound.height,
                w: r.width / bound.width,
                h: r.height / bound.height,
              })),
            );
          }}
        >
          <canvas ref={canvas} />
          <div className="textLayer" ref={textLayer} />
          <div className="pdf-highlights">
            {annotations
              .filter((a) => a.data.page === page)
              .flatMap((a) =>
                (a.data.rects || []).map((r: any, i: number) => (
                  <div
                    key={`${a.id}-${i}`}
                    style={{
                      left: `${r.x * 100}%`,
                      top: `${r.y * 100}%`,
                      width: `${r.w * 100}%`,
                      height: `${r.h * 100}%`,
                    }}
                  />
                )),
              )}
          </div>
        </div>
      </div>
      {quote && (
        <div className="quote-bar">
          <p>{quote}</p>
          <button
            className="primary"
            onClick={async () => {
              await save({
                kind: "annotation",
                title: `${asset.name} · 第 ${page} 页`,
                data: { assetHash: asset.hash, noteId, page, quote, rects },
              });
              onQuote(`${quote} [第 ${page} 页]`);
              setQuote("");
              window.getSelection()?.removeAllRanges();
            }}
          >
            <Highlighter size={16} />
            划线并引用到笔记
          </button>
        </div>
      )}
    </div>
  );
}
