import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceDrawer } from "./SourceDrawer";

describe("SourceDrawer", () => {
  it("does not render when closed", () => {
    const { container } = render(
      <SourceDrawer
        isOpen={false}
        onClose={() => {}}
        linkText="(Test, 2024)"
        href="notes.xhtml#note-1"
      />
    );
    expect(container.querySelector(".source-drawer")).not.toBeInTheDocument();
  });

  it("renders when open with link text and href", () => {
    render(
      <SourceDrawer
        isOpen={true}
        onClose={() => {}}
        linkText="(Test, 2024)"
        href="notes.xhtml#note-1"
      />
    );
    expect(screen.getByText("(Test, 2024)")).toBeInTheDocument();
    expect(screen.getByText("notes.xhtml#note-1")).toBeInTheDocument();
  });

  it("renders resolved content when provided", () => {
    render(
      <SourceDrawer
        isOpen={true}
        onClose={() => {}}
        linkText="1"
        href="notes.xhtml#note-1"
        resolvedContent="<p>This is the note content.</p>"
      />
    );
    expect(screen.getByText("This is the note content.")).toBeInTheDocument();
  });

  it("renders error message when provided", () => {
    render(
      <SourceDrawer
        isOpen={true}
        onClose={() => {}}
        linkText="1"
        href="notes.xhtml#note-1"
        error="Couldn't load the note."
      />
    );
    expect(screen.getByText("Couldn't load the note.")).toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SourceDrawer
        isOpen={true}
        onClose={onClose}
        linkText="1"
        href="notes.xhtml#note-1"
      />
    );
    const closeButton = screen.getByLabelText("Close drawer");
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { container } = render(
      <SourceDrawer
        isOpen={true}
        onClose={onClose}
        linkText="1"
        href="notes.xhtml#note-1"
      />
    );
    const backdrop = container.querySelector(".source-drawer-backdrop");
    if (backdrop) {
      await user.click(backdrop);
      expect(onClose).toHaveBeenCalledTimes(1);
    }
  });

  it("calls onClose when Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SourceDrawer
        isOpen={true}
        onClose={onClose}
        linkText="1"
        href="notes.xhtml#note-1"
      />
    );
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
