import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import type { CaseItem } from "@/lib/cases";
import { countFrame } from "@/lib/count-up";
import { capabilities, homelabLayers, pipelineSteps } from "@/lib/engineering";
import { pad2 } from "@/lib/format";
import type { ResearchTopic } from "@/lib/research";

/**
 * トップと下層ページで共有する部品。見た目は `styles/rdx.css` の `.rdx` 配下。
 * どれも `<main className="rdx">` の内側で使う。
 */

/** セクションの見出し。ページ冒頭では `as="h1"` で同じ形を使う */
export function SectionHead({
  id,
  label,
  title,
  description,
  as: Heading = "h2",
  small = false,
}: {
  id?: string;
  label: string;
  title: string;
  description?: string;
  as?: "h1" | "h2";
  /** 題が長いとき（記事の題など）の小さい版 */
  small?: boolean;
}) {
  return (
    <div className={small ? "rdx-head rdx-head--small" : "rdx-head"} data-rv>
      <p className="rdx-label rdx-mono">{label}</p>
      <Heading id={id} className="rdx-h2">
        <span>{title}</span>
      </Heading>
      {description && <p className="rdx-head-desc">{description}</p>}
    </div>
  );
}

/** 事例を行で並べる一覧 */
export function CaseRows({ items }: { items: CaseItem[] }) {
  return (
    <ul className="rdx-cases" data-rv="stagger">
      {items.map((item) => (
        <li key={item.slug}>
          <Link to="/cases/$slug" params={{ slug: item.slug }} className="rdx-case">
            <div className="rdx-case-main">
              <h3>{item.title}</h3>
              <p className="rdx-case-sum">{item.summary}</p>
            </div>
            <div className="rdx-case-tags rdx-mono">
              {item.tags.slice(0, 3).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <ArrowUpRight className="rdx-case-arrow" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

type HealthProbe =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; status: number; body: string; ms: number }
  | { state: "error"; message: string };

/** このサイトの配信経路。`anchor` を付けると `#pipeline` の行き先になる */
export function Pipeline({ anchor = false }: { anchor?: boolean }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [probe, setProbe] = useState<HealthProbe>({ state: "idle" });
  const panelId = useId();
  const activeStep = activeIndex !== null ? pipelineSteps[activeIndex] : null;

  const runHealthProbe = useCallback(async () => {
    setProbe({ state: "loading" });
    const start = performance.now();
    try {
      const res = await fetch("/healthz", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const text = await res.text();
      const ms = Math.max(1, Math.round(performance.now() - start));
      if (!res.ok) {
        setProbe({ state: "error", message: `HTTP ${res.status}` });
        return;
      }
      setProbe({ state: "ok", status: res.status, body: text, ms });
    } catch {
      setProbe({ state: "error", message: "接続に失敗しました" });
    }
  }, []);

  const selectStep = (index: number) => {
    const next = activeIndex === index ? null : index;
    setActiveIndex(next);
    if (next !== null && pipelineSteps[next]?.isHealthcheck) {
      void runHealthProbe();
    }
  };

  return (
    <div id={anchor ? "pipeline" : undefined} className="rdx-pipe" data-rv>
      <div className="rdx-pipe-title rdx-mono">
        <span>このサイトの配信経路</span>
        <span className="rdx-pipe-hint">ノードを選択して詳細を確認</span>
      </div>
      <ol className="rdx-pipe-steps">
        {pipelineSteps.map((step, i) => {
          const isSelected = activeIndex === i;
          return (
            <li key={step.label} className="rdx-pipe-step" style={{ "--i": i } as React.CSSProperties}>
              <button
                type="button"
                className="rdx-pipe-btn"
                aria-expanded={isSelected}
                aria-controls={isSelected ? panelId : undefined}
                onClick={() => selectStep(i)}
              >
                <span className="rdx-pipe-node" aria-hidden="true" />
                <span className="rdx-pipe-name rdx-mono">{step.label}</span>
                <span className="rdx-pipe-detail rdx-mono"> {step.detail}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {activeStep && (
        <div id={panelId} className="rdx-pipe-drawer" role="region" aria-label={`${activeStep.label} の詳細`}>
          <div className="rdx-pipe-drawer-head">
            <span className="rdx-pipe-drawer-label rdx-mono">
              {pad2((activeIndex ?? 0) + 1)} · {activeStep.label}
            </span>
            <code className="rdx-pipe-drawer-spec rdx-mono">{activeStep.spec}</code>
          </div>
          <p className="rdx-pipe-drawer-summary">{activeStep.summary}</p>
          {activeStep.isHealthcheck && (
            <div className="rdx-pipe-probe">
              <button
                type="button"
                className="rdx-pipe-probe-btn rdx-mono"
                onClick={() => void runHealthProbe()}
                disabled={probe.state === "loading"}
              >
                {probe.state === "loading" ? "計測中..." : "/healthz を再計測"}
              </button>
              <span className="rdx-pipe-probe-result rdx-mono" aria-live="polite">
                {probe.state === "ok" && `HTTP ${probe.status} · ${probe.body} · ${probe.ms}ms`}
                {probe.state === "error" && probe.message}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 自宅基盤の層ごとの構成 */
export function Layers({ wide = false }: { wide?: boolean }) {
  return (
    <dl className={wide ? "rdx-layers rdx-layers--wide" : "rdx-layers"} data-rv="stagger">
      {homelabLayers.map((layer) => (
        <div key={layer.layer} className="rdx-layer">
          <dt className="rdx-mono">{layer.layer}</dt>
          <dd>{layer.items.join(" · ")}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 技術と、それを使った作品・事例の対応 */
export function StackRows() {
  return (
    <ul className="rdx-stack" data-rv="stagger">
      {capabilities.map((capability) => (
        <li key={capability.area} className="rdx-stack-row">
          <span className="rdx-stack-area rdx-mono">{capability.area}</span>
          <span className="rdx-stack-tools">
            {capability.tools.map((tool) => (
              <span key={tool}>{tool}</span>
            ))}
          </span>
          <span className="rdx-stack-ev">
            {capability.evidence.map((evidence) => {
              const [path, hash] = evidence.href.split("#");
              return (
                <Link key={evidence.href} to={path} hash={hash}>
                  {evidence.label}
                </Link>
              );
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 画面に入ったとき、文字列の中の数値だけを 0 から数え上げる（"96/96" "43.2×" "10+"）。
 * サーバーが出す値は最終値のままなので、JS が無くても正しい数字が読める。
 */
export function CountUp({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1400);
          const eased = 1 - Math.pow(1 - t, 4);
          el.textContent = countFrame(value, eased);
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      el.textContent = value;
    };
  }, [value]);

  return (
    <>
      <span className="rdx-sr">{value}</span>
      <span ref={ref} aria-hidden="true">
        {value}
      </span>
    </>
  );
}

/**
 * 研究を「課題・手法・結果」で見せるカードの並び。
 * detailed は /research 用で、進行中の印・タグ・ページ内リンク用の id を足す。
 * 所属や学会名はここには出さない。
 */
export function ResearchPapers({
  topics,
  heading: Heading = "h3",
  detailed = false,
}: {
  topics: ResearchTopic[];
  heading?: "h2" | "h3";
  detailed?: boolean;
}) {
  return (
    <ul className="rdx-research">
      {topics.map((topic, i) => (
        <li
          key={topic.slug}
          id={detailed ? topic.slug : undefined}
          className="rdx-paper"
          data-rv
          style={{ "--rv-delay": `${(i % 2) * 100}ms` } as React.CSSProperties}
        >
          <div className="rdx-paper-head">
            {topic.metric && (
              <>
                <p className="rdx-metric">
                  <CountUp value={topic.metric.value} />
                </p>
                <p className="rdx-metric-label rdx-mono">{topic.metric.label}</p>
              </>
            )}
            {detailed && topic.status !== "completed" && (
              <p className="rdx-paper-status rdx-mono">
                <span className="rdx-pill" data-status={topic.status === "paused" ? "paused" : "demo"}>
                  {topic.status === "paused" ? "保留" : "進行中"}
                </span>
              </p>
            )}
            <Heading>{topic.title}</Heading>
            <p className="rdx-paper-context">{topic.context}</p>
          </div>
          <div className="rdx-paper-body">
            <dl className="rdx-pmr">
              <div>
                <dt className="rdx-mono">課題</dt>
                <dd>{topic.problem}</dd>
              </div>
              <div>
                <dt className="rdx-mono">手法</dt>
                <dd>{topic.method}</dd>
              </div>
              <div>
                <dt className="rdx-mono">結果</dt>
                <dd>{topic.result}</dd>
              </div>
              {detailed && (
                <div>
                  <dt className="rdx-mono">技術</dt>
                  <dd>
                    <ul className="rdx-chips rdx-mono">
                      {topic.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
            {topic.caseSlug && (
              <div className="rdx-paper-links">
                <Link to="/cases/$slug" params={{ slug: topic.caseSlug }} className="rdx-more">
                  進め方を読む
                  <ArrowUpRight aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 1 文字ずつ下からせり上がる。読み上げには親の aria-label を使う */
export function Chars({ text }: { text: string }) {
  return (
    <span className="rdx-chars" aria-hidden="true">
      {Array.from(text).map((char, i) => (
        <span key={i} style={{ "--i": i } as React.CSSProperties}>
          {char}
        </span>
      ))}
    </span>
  );
}
