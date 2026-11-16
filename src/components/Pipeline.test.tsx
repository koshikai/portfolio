import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Pipeline } from "./rdx";

describe("Pipeline", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands and collapses step details on click", () => {
    render(<Pipeline />);

    const pushBtn = screen.getByRole("button", { name: /git push/ });
    expect(pushBtn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(pushBtn);
    expect(pushBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: "git push の詳細" })).toBeInTheDocument();

    fireEvent.click(pushBtn);
    expect(pushBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "git push の詳細" })).not.toBeInTheDocument();
  });

  it("probes /healthz when the healthcheck node is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<Pipeline />);

    const healthBtn = screen.getByRole("button", { name: /\/healthz/ });
    fireEvent.click(healthBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/healthz",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText(/HTTP 200 · \{"ok":true\}/)).toBeInTheDocument();
    });
  });
});
