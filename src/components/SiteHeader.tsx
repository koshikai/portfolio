import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";
import { isNavActive, primaryNav } from "@/lib/navigation";
import { pad2 } from "@/lib/format";

let supportsDisplayTransition: boolean | undefined;

function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === "undefined" || !window.CSS?.supports?.("transition-behavior", "allow-discrete") || !document.body) {
    return false;
  }
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.appendChild(probe);
  void getComputedStyle(probe).display;
  probe.style.display = "none";
  supportsDisplayTransition = getComputedStyle(probe).display === "block";
  probe.remove();
  return supportsDisplayTransition;
}

function supportsTopLayerExit(): boolean {
  return typeof window !== "undefined" && Boolean(window.CSS?.supports?.("overlay", "auto")) && canTransitionDisplay();
}

async function closeTopLayerDialog(dialog: HTMLDialogElement) {
  if (!dialog.open) return;
  if (!supportsTopLayerExit() && typeof dialog.getAnimations === "function") {
    dialog.setAttribute("data-closing", "");
    const animations = dialog.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise((r) => setTimeout(r, 400)),
      ]);
    }
    if (!dialog.hasAttribute("data-closing")) return;
    dialog.removeAttribute("data-closing");
  }
  if (dialog.open && typeof dialog.close === "function") {
    dialog.close();
  }
}

/**
 * 全ページ共通のヘッダー。上端から浮かせた小さなバーで、
 * 狭い画面では行き先を全画面のモーダルメニュー（<dialog>）にまとめる。
 * 見た目は `styles/site-chrome.css`。
 */
export function SiteHeader() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // 下へ読み進めている間はバーを引っ込め、少しでも戻ったら出す
  useEffect(() => {
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        if (Math.abs(y - last) > 8) {
          setHidden(y > last && y > 160);
          last = y;
        }
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 画面幅が 768px 以上になったらモバイルメニューを閉じる
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setOpen(false);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  // ネイティブ <dialog> の showModal / close と React state を同期する
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      dialog.removeAttribute("data-closing");
      if (!dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
      }
    } else if (dialog.open) {
      void closeTopLayerDialog(dialog);
    }
  }, [open]);

  return (
    <>
      <header className="site-nav" data-hidden={hidden && !open}>
        <Link to="/" className="site-nav-brand" onClick={() => setOpen(false)}>
          koshikai
        </Link>
        <nav aria-label="グローバルナビゲーション" className="site-nav-links">
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              aria-current={isNavActive(pathname, item.href) ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle className="site-nav-btn" />
        <button
          type="button"
          className="site-nav-btn site-nav-menu-btn"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? "メニューを閉じる" : "メニューを開く"}
        >
          <span className="site-nav-burger" aria-hidden="true" />
        </button>
      </header>

      <dialog
        ref={dialogRef}
        id="site-menu"
        aria-label="メニュー"
        className="site-menu"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialogRef.current && navRef.current && !navRef.current.contains(event.target as Node)) {
            setOpen(false);
          }
        }}
      >
        <button
          type="button"
          className="site-nav-btn site-menu-close"
          onClick={() => setOpen(false)}
          aria-label="メニューを閉じる"
          autoFocus
        >
          <span className="site-nav-burger site-nav-burger--open" aria-hidden="true" />
        </button>
        <nav ref={navRef} aria-label="モバイルナビゲーション" className="site-menu-nav">
          {primaryNav.map((item, i) => (
            <Link
              key={item.href}
              to={item.href}
              aria-current={isNavActive(pathname, item.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
              style={{ "--i": i } as React.CSSProperties}
            >
              <span>{pad2(i + 1)}</span>
              {item.label}
            </Link>
          ))}
        </nav>
      </dialog>
    </>
  );
}
