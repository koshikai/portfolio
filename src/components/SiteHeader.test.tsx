import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteHeader } from "./SiteHeader";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    ...props
  }: {
    to: string;
    children: ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useLocation: ({ select }: { select: (loc: { pathname: string }) => string }) =>
    select({ pathname: "/" }),
}));

let matchesDesktop = false;
let changeListener: ((e: MediaQueryListEvent) => void) | null = null;

function installMatchMedia() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      get matches() {
        return query.includes("min-width: 768px") ? matchesDesktop : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
        if (query.includes("min-width: 768px")) changeListener = cb;
      },
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("SiteHeader", () => {
  let showModalSpy: ReturnType<typeof vi.fn<() => void>>;
  let closeSpy: ReturnType<typeof vi.fn<(returnValue?: string) => void>>;

  beforeEach(() => {
    matchesDesktop = false;
    changeListener = null;
    installMatchMedia();

    showModalSpy = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    closeSpy = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    });
    HTMLDialogElement.prototype.showModal = showModalSpy as () => void;
    HTMLDialogElement.prototype.close = closeSpy as (returnValue?: string) => void;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens and closes the mobile menu using native dialog showModal/close", async () => {
    render(<SiteHeader />);

    const openBtn = screen.getByRole("button", { name: "メニューを開く" });
    expect(openBtn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(openBtn);
    await waitFor(() => expect(showModalSpy).toHaveBeenCalledTimes(1));
    expect(openBtn).toHaveAttribute("aria-expanded", "true");

    const dialog = document.getElementById("site-menu") as HTMLDialogElement;
    const closeBtn = within(dialog).getByRole("button", { name: "メニューを閉じる" });
    fireEvent.click(closeBtn);
    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    expect(openBtn).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the dialog on cancel event (Escape)", async () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    await waitFor(() => expect(showModalSpy).toHaveBeenCalledTimes(1));

    const dialog = document.getElementById("site-menu") as HTMLDialogElement;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
  });

  it("closes the dialog when viewport grows to desktop width", async () => {
    render(<SiteHeader />);

    fireEvent.click(screen.getByRole("button", { name: "メニューを開く" }));
    await waitFor(() => expect(showModalSpy).toHaveBeenCalledTimes(1));

    matchesDesktop = true;
    act(() => {
      changeListener?.({ matches: true } as MediaQueryListEvent);
    });

    await waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
  });
});
